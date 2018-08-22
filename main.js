/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */

'use strict';

const utils = require(__dirname + '/lib/utils');
const Telnet = require(__dirname + '/lib/telnet');

const adapter = utils.Adapter('fhem');

// Telnet sessions
let telnetOut = null; // read config and write values
let telnetIn = null; // receive events

let connected = false;
const queue = [];
const queueL = [];
const fhemObjects = {};

let iobroker = false;
let lastNameQueue;
let firstRun = true;
let synchro = true;
const ignorePossibleSets = ['getConfig', 'getRegRaw', 'regBulk', 'regSet', 'deviceMsg', 'CommandAccepted'];
const ignoreReadings = ['getConfig', 'getRegRaw', 'regBulk', 'regSet', 'deviceMsg', 'CommandAccepted'];
const allowedAttributes = ['alias', 'disable', 'comment'];
const allowedInternals = ['TYPE', 'NAME', 'PORT', 'manufacturername', 'modelid', 'swversion'];
const dimPossibleSets = ['pct', 'brightness', 'dim'];
const volumePossibleSets = ['Volume', 'volume', 'GroupVolume'];
const ts_update = new Date().getTime();

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', callback => {
    try {
        adapter.setState('info.connection', false, true);
        if (telnetOut) {
            telnetOut.destroy();
            telnetOut = null;
        }
        if (telnetIn) {
            telnetIn.destroy();
            telnetIn = null;
        }
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed state changes
adapter.on('stateChange', (id, state) => {
    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        if (!connected) {
            adapter.log.warn('Cannot send command to "' + id + '", because not connected');
            return;
        }
        if (id === adapter.namespace + '.' + '.info.resync') {
            queue.push({
                command: 'resync'
            });
            processQueue();
        } else if (fhemObjects[id]) {
            queue.push({
                command: 'write',
                id: id,
                val: state.val
            });
            processQueue();
        }
    }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', obj => {
    if (typeof obj === 'object' && obj.message) {
        if (obj.command === 'send') {
            // e.g. send email or pushover or whatever
            console.log('send command');

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', main);

//========================================================================================================================================== start
function getUnit(name) {
    name = name.toLowerCase();
    if (name.indexOf('temperature') !== -1) {
        return '°C';
    } else if (name.indexOf('measured-temp') !== -1) {
        return '°C';
    } else if (name.indexOf('desired-temp') !== -1) {
        return '°C';
    } else if (name.indexOf('humidity') !== -1) {
        return '%';
    } else if (name.indexOf('pressure') !== -1) {
        return 'hPa';
    } else if (name.indexOf('degrees') !== -1) {
        return '°';
    } else if (name.indexOf('speed') !== -1) {
        return 'kmh';
    }
    return undefined;
}

//--------------------------------------------------------------------------------------
function parseEvent(event) {
    //2016-02-26 10:19:07 TRX_WEATHER Energie statEnergy_total: Hour: 0.2625 Day: 7.5566 Month: 432.0465 Year: 871.7210 (since: 2016-01-09 )
    //HTTPMOD wetter_prenzelberg dewpointTemperature: 17.4
    //Global global ATTR HM_3093C1_Clima alias Schlafzimmer Heizung
    if (!event) return;

    let ts = undefined;
    if (event[4] === '-' && event[7] === '-') {
        ts = new Date(event.substring(0, 19)).getTime();
        event = event.substring(20);
    }

    let name;
    let id;
    let parts;
    let val;
    const pos = event.indexOf(':');

    // Global global ATTR ?
    if (event.indexOf('Global global ATTR') !== -1) {
        parts = event.split(' ');
        adapter.log.debug('[parseEvent] event FHEM(0): ' + event);
        queue.push({
            command: 'meta',
            name: parts[3],
            attr: 'state',
            val: parts[4],
            event: event
        });
        processQueue();
        lastNameQueue = parts[3];
        return;
    }

    // state?
    if (pos === -1) {
        name = event;
        parts = name.split(' ');
        val = convertFhemValue(name.substring(parts[0].length + parts[1].length + 2));
        id = adapter.namespace + '.' + parts[1].replace(/\./g, '_') + '.state';
        if (fhemObjects[id]) {
            adapter.setForeignState(id, {
                val: val,
                ack: true,
                ts: ts
            });
            adapter.log.debug('[parseEvent] event FHEM(1): "' + event + '" > ' + id + '  ' + val);
        } else {
            adapter.log.debug('[parseEvent] no object(1): "' + event + '" > ' + id + ' = ' + val);
            if (parts[1] !== lastNameQueue) {
                queue.push({
                    command: 'meta',
                    name: parts[1],
                    attr: 'state',
                    val: val,
                    event: event
                });
                processQueue();
                lastNameQueue = parts[1];
            }
        }
        // special for ZWave dim
        if (parts[0] === 'ZWave' && parts[2] === 'dim') {
            val = parts[3].replace(/\./g, '_');
            id = adapter.namespace + '.' + parts[1].replace(/\./g, '_') + '.' + parts[2].replace(/\./g, '_');
            if (fhemObjects[id]) {
                adapter.setForeignState(id, {
                    val: val,
                    ack: true,
                    ts: ts
                });
                adapter.log.debug('[parseEvent] event FHEM(s): "' + event + '" > ' + id + ' = ' + val);
            } else {
                adapter.log.debug('[parseEvent] no object(s): "' + event + '" > ' + id + ' = ' + val);
                if (parts[1] !== lastNameQueue) {
                    queue.push({
                        command: 'meta',
                        name: parts[1],
                        attr: parts[2],
                        val: val,
                        event: event
                    });
                    processQueue();
                    lastNameQueue = parts[1];
                }
            }
        }
        return;
    }

    // reading or state?
    if (pos !== -1) {
        name = event.substring(0, pos);
        val = convertFhemValue(event.substring(pos + 2));
        parts = name.split(' ');
        id = adapter.namespace + '.' + parts[1].replace(/\./g, '_') + '.' + parts[2].replace(/\./g, '_');
        if (fhemObjects[id]) {
            // rgb? insert #
            if (parts[2] === 'rgb') val = '#' + val;
            adapter.setForeignState(id, {
                val: val,
                ack: true,
                ts: ts
            });
            adapter.log.debug('[parseEvent] event FHEM(2): "' + event + '" > ' + id + ' = ' + val);
        } else {
            adapter.log.debug('[parseEvent] no object(2): "' + event + '" > ' + id + ' = ' + val);
            if (parts[1] !== lastNameQueue) {
                queue.push({
                    command: 'meta',
                    name: parts[1],
                    attr: parts[2],
                    val: val,
                    event: event
                });
                processQueue();
                lastNameQueue = parts[1];
            }
        }
    }
}

//--------------------------------------------------------------------------------------
function syncStates(states, cb) {
    if (!states || !states.length) {
        cb();
        return;
    }
    const state = states.shift();
    const id = state.id;
    delete state.id;

    adapter.setForeignState(id, state, err => {
        if (err) adapter.log.error('[syncStates] ' + err);
        setImmediate(syncStates, states, cb);
    });
}

//--------------------------------------------------------------------------------------
function syncObjects(objects, cb) {
    if (!objects || !objects.length) {
        cb();
        return;
    }
    const obj = objects.shift();
    fhemObjects[obj._id] = obj;
    adapter.getForeignObject(obj._id, (err, oldObj) => {
        if (err) adapter.log.error('[syncObjects] ' + err);

        if (!oldObj) {
            adapter.log.debug('[syncObjects] create ' + obj.type + ' "' + obj._id + '"');
            if (obj.type === 'channel') adapter.log.info('Create channel ' + obj._id);
            adapter.setForeignObject(obj._id, obj, err => {
                if (err) adapter.log.error('[syncObjects] ' + err);

                setImmediate(syncObjects, objects, cb);
            });
        } else {
            if (JSON.stringify(obj.native) !== JSON.stringify(oldObj.native)) {
                oldObj.native = obj.native;
                adapter.log.debug('[syncObjects] update ' + obj.type + ' "' + obj._id + '"');
                if (obj.type === 'channel') adapter.log.info('Update channel ' + obj._id);
                adapter.setForeignObject(obj._id, oldObj, err => {
                    if (err) adapter.log.error('[syncObjects] ' + err);
                    setImmediate(syncObjects, objects, cb);
                });
            } else {
                setImmediate(syncObjects, objects, cb);
            }
        }
    });

}

//--------------------------------------------------------------------------------------
function syncRoom(room, members, cb) {
    adapter.getForeignObject('enum.rooms.' + room, (err, obj) => {
        if (!obj) {
            obj = {
                _id: 'enum.rooms.' + room,
                type: 'enum',
                common: {
                    name: room,
                    members: members
                },
                native: {}
            };
            adapter.log.debug('Update' + obj._id + '"');
            adapter.setForeignObject(obj._id, obj, err => {
                if (err) adapter.log.error('[syncRoom] ' + err);
                cb();
            });
        } else {
            obj.common = obj.common || {};
            obj.common.members = obj.common.members || [];
            let changed = false;
            for (let m = 0; m < members.length; m++) {
                if (obj.common.members.indexOf(members[m]) === -1) {
                    changed = true;
                    obj.common.members.push(members[m]);
                }
            }
            if (changed) {
                adapter.log.debug('Update "' + obj._id + '"');
                adapter.setForeignObject(obj._id, obj, err => {
                    if (err) adapter.log.error(err);
                    cb();
                });
            } else {
                cb();
            }
        }
    });
}

//--------------------------------------------------------------------------------------
function syncRooms(rooms, cb) {
    for (const r in rooms) {
        if (!rooms.hasOwnProperty(r)) continue;
        if (rooms[r]) {
            syncRoom(r, rooms[r], () => setImmediate(syncRooms, rooms, cb));
            rooms[r] = null;
            return;
        }
    }

    if (cb) cb();
}

//--------------------------------------------------------------------------------------
function parseObjects(objs, cb) {
    const rooms = {};
    const objects = [];
    const states = [];
    let id;
    let obj;
    let name;
    let suche = 'nix';

    if (firstRun) {
        adapter.log.info('last update: 06.05.18 LausiD ');
        adapter.log.info('Settings: ignored PossibleSets: ' + ignorePossibleSets);
        adapter.log.info('Settings: role button PossibleSets: noArg');
        adapter.log.info('Settings: role level.xxx PossibleSets: slider');
        adapter.log.info('Settings: role level.temperature PossibleSets: desired-temp');
        adapter.log.info('Settings: role level.volume PossibleSets: ' + volumePossibleSets);
        adapter.log.info('Settings: role level.dimmer PossibleSets: ' + dimPossibleSets);
        adapter.log.info('Settings: ignored Readings: ' + ignoreReadings);
        adapter.log.info('Settings: allowed Internals: ' + allowedInternals);
        adapter.log.info('Settings: allowed attributes: ' + allowedAttributes);
        adapter.log.info('Settings: channels found = ' + objs.length);
        for (let i = 0; i < objs.length; i++) {
            try {
                if (objs[i].Attributes.room) {
                    suche = objs[i].Attributes.room;
                }
                if (suche.indexOf('ioBroker') !== -1) {
                    iobroker = true;
                }
            } catch (err) {
                adapter.log.error('[parseObjects] Cannot check room of object: ' + JSON.stringify(objs[i]));
                adapter.log.error('[parseObjects] Cannot check room of object: ' + err);
            }
        }
        adapter.log.info('Settings: room ioBroker = ' + iobroker);
    }

    for (let i = 0; i < objs.length; i++) {
        try {
            name = objs[i].Name.replace(/\./g, '_');
            let searchRoom = 'no';
            if (objs[i].Attributes.room) {
                searchRoom = objs[i].Attributes.room;
            }
            if (objs[i].Attributes && objs[i].Attributes.room === 'hidden' || searchRoom.indexOf('ioBroker') === -1 && iobroker === true) {
                if (!synchro) unusedObjects(name + '.*', cb);
                continue;
            }
            if (firstRun) adapter.log.info('Check channel ' + adapter.namespace + '.' + name + ' | room: ' + objs[i].Attributes.room + ' [' + (i + 1) + '/' + objs.length + ']');

            id = adapter.namespace + '.' + name;

            objects.push({
                _id: id,
                type: 'channel',
                common: {
                    name: objs[i].Name
                },
                native: objs[i]

            });

            //-----------------------------------------
            if (objs[i].Attributes && objs[i].Attributes.room) {
                const rrr = objs[i].Attributes.room.split(',');
                for (let r = 0; r < rrr.length; r++) {
                    rrr[r] = rrr[r].trim();
                    rooms[rrr[r]] = rooms[rrr[r]] || [];
                    rooms[rrr[r]].push(adapter.namespace + '.' + name);
                }
            }

            //-----------------------------------------
            //         if (objs[i].PossibleAttrs) {

            //-----------------------------------------

            let isOn = false;
            let isOff = false;
            let setStates = {};
            //-----------------------------------------
            if (objs[i].Attributes) {
                let alias = name;
                for (const attr in objs[i].Attributes) {
                    // only allowed Attributes
                    if (!objs[i].Attributes.hasOwnProperty(attr) || allowedAttributes.indexOf(attr) === -1) continue;
                    id = adapter.namespace + '.' + name + '.' + 'Attributes.' + attr.replace(/\./g, '_');
                    const val = objs[i].Attributes[attr];
                    if (attr === 'alias') {
                        alias = val;
                    }

                    obj = {
                        _id: id,
                        type: 'state',
                        common: {
                            name: objs[i].Name + ' ' + attr,
                            type: 'string',
                            read: true,
                            write: true,
                            role: 'state.' + attr
                        },
                        native: {
                            Name: objs[i].Name,
                            Attribute: attr,
                            Attributes: true
                        }
                    };
                    obj.native.ts = new Date().getTime();
                    objects.push(obj);
                    states.push({
                        id: obj._id,
                        val: val,
                        ts: new Date().getTime(),
                        //ts: objs[i].Readings[attr].Time ? new Date(objs[i].Readings[attr].Time).getTime() : new Date().getTime(),
                        ack: true
                    });
                    adapter.log.debug('[parseObjects] Attributes: ' + obj._id + ' = ' + val);
                }
            }

            //-----------------------------------------
            if (objs[i].Internals) {
                for (const attr in objs[i].Internals) {
                    // only allowed Internals
                    if (!objs[i].Internals.hasOwnProperty(attr) || allowedInternals.indexOf(attr) === -1) continue;
                    id = adapter.namespace + '.' + name + '.' + 'Internals.' + attr.replace(/\./g, '_');
                    const val = objs[i].Internals[attr];
                    obj = {
                        _id: id,
                        type: 'state',
                        common: {
                            name: objs[i].Name + ' ' + attr,
                            type: 'string',
                            read: true,
                            write: false,
                            role: 'value' + '.' + attr
                        },
                        native: {
                            Name: objs[i].Name,
                            Attribute: attr,
                            Internals: true
                        }
                    };
                    obj.native.ts = new Date().getTime();
                    objects.push(obj);
                    states.push({
                        id: obj._id,
                        val: val,
                        ts: new Date().getTime(),
                        //ts: objs[i].Readings[attr].Time ? new Date(objs[i].Readings[attr].Time).getTime() : new Date().getTime(),
                        ack: true
                    });
                    adapter.log.debug('[parseObjects] Internals: ' + obj._id + ' = ' + val);
                }
            }

            //-----------------------------------------
            if (objs[i].PossibleSets && objs[i].PossibleSets.length > 1) {
                const attrs = objs[i].PossibleSets.split(' ');
                for (let a = 0; a < attrs.length; a++) {
                    if (!attrs[a]) continue;
                    const parts = attrs[a].split(':');
                    // ignore some useless "sets"
                    if (ignorePossibleSets.indexOf(parts[0]) !== -1) continue;
                    const stateName = parts[0].replace(/\./g, '_');
                    id = adapter.namespace + '.' + name + '.' + stateName;

                    if (parts[0] === 'off') isOff = true;
                    if (parts[0] === 'on') isOn = true;

                    obj = {
                        _id: id,
                        type: 'state',
                        common: {
                            name: objs[i].Name + ' ' + parts[0],
                            type: 'string',
                            read: false,
                            write: true,
                            role: 'state.' + parts[0]
                        },
                        native: {
                            Name: objs[i].Name,
                            Attribute: parts[0],
                            possibleSets: true
                        }
                    };

                    if (parts[1]) {
                        if (parts[1].indexOf('noArg') !== -1) obj.common.role = 'button';
                        if (parts[1].indexOf('slider') !== -1) {
                            const _slider = parts[1].split(',');
                            obj.common.min = _slider[1];
                            obj.common.max = _slider[3];
                            obj.common.type = 'number';
                            obj.common.role = 'level.' + parts[0];
                        }
                    }

                    if (parts[0].indexOf('desired-temp') !== -1) {
                        obj.common.type = 'number';
                        obj.common.min = '5';
                        obj.common.max = '30';
                        obj.common.role = 'level.temperature';
                        obj.common.unit = '°C';
                        if (adapter.namespace === 'fhem.0') {
                            obj.common.smartName = {
                                'de': alias
                            };
                        }
                    }

                    if (dimPossibleSets.indexOf(parts[0]) !== -1) {
                        obj.common.type = 'number';
                        obj.common.min = '0';
                        obj.common.max = '100';
                        obj.common.role = 'level.dim';
                        obj.common.unit = '%';
                        if (adapter.namespace === 'fhem.0') {
                            obj.common.smartName = {
                                'de': alias
                            };
                        }
                    }

                    if (volumePossibleSets.indexOf(parts[0]) !== -1) {
                        obj.common.type = 'number';
                        obj.common.min = '0';
                        obj.common.max = '100';
                        obj.common.role = 'level.volume';
                        obj.common.unit = '%';
                        if (adapter.namespace === 'fhem.0') {
                            obj.common.smartName = {
                                'de': alias
                            };
                        }
                    }

                    if (parts[0].indexOf('RGB') !== -1) {
                        obj.common.role = 'light.color.rgb';
                        obj.native.rgb = true;
                    }
                    if (parts[0].indexOf('HSV') !== -1) {
                        obj.common.role = 'light.color.hsv';
                        obj.native.hsv = true;
                    }

                    obj.native.ts = new Date().getTime();
                    objects.push(obj);
                    setStates[stateName] = obj;
                    adapter.log.debug('[parseObjects] PossibleSets: ' + obj._id + ' = ' + (parts[1] || ''));
                }
            }

            //-----------------------------------------
            if (objs[i].Readings) {
                for (const attr in objs[i].Readings) {
                    if (!objs[i].Readings.hasOwnProperty(attr)) continue;
                    // ignore some useless Readings
                    if (ignoreReadings.indexOf(attr) !== -1) continue;

                    const stateName = attr.replace(/\./g, '_');
                    id = adapter.namespace + '.' + name + '.' + stateName;
                    const combined = false;
                    // PossibleSets?
                    if (setStates[stateName]) {
                        //combined = true;
                        obj = setStates[stateName];
                        obj.common.read = true;
                        obj.native.Readings = true;
                    } else {
                        obj = {
                            _id: id,
                            type: 'state',
                            common: {
                                name: objs[i].Name + ' ' + attr,
                                type: 'string',
                                read: true,
                                write: false,
                                unit: getUnit(attr)
                            },
                            native: {
                                Name: objs[i].Name,
                                Attribute: attr,
                                Readings: true
                            }
                        };
                    }

                    if (objs[i].Readings[attr]) {
                        const val = convertFhemValue(objs[i].Readings[attr].Value);
                        obj.common.type = obj.common.type || typeof val;
                        obj.common.role = obj.common.role || 'value' + '.' + attr;

                        states.push({
                            id: obj._id,
                            val: val,
                            ts: objs[i].Readings[attr].Time ? new Date(objs[i].Readings[attr].Time).getTime() : new Date().getTime(),
                            ack: true
                        });

                        // detect state
                        if (attr === 'state') {
                            obj.common.write = true;
                            obj.native.onoff = true;
                            obj.common.role = 'switch';
                        }
                        // detect on/off state
                        if (isOff && isOn && attr === 'state') {
                            obj.common.write = true;
                            obj.native.onoff = true;
                            obj.common.role = 'switch';
                        }
                        obj.native.ts = new Date().getTime(); // TEST
                        if (!combined) objects.push(obj);
                        adapter.log.debug('[parseObjects] Readings: ' + obj._id + ' = ' + (val || ''));
                    }
                }

                delete objs[i].Readings;
            }
            setStates = null;

        } catch (err) {
            adapter.log.error('[parseObjects] Cannot process object: ' + JSON.stringify(objs[i]));
            adapter.log.error('[parseObjects] Cannot process object: ' + err);
        }
    }
    firstRun = false;
    syncObjects(objects, () => {
        syncRooms(rooms, () => {
            syncStates(states, cb);
        });
    });

}

//--------------------------------------------------------------------------------------
function startSync(cb) {
    // send command JsonList2
    telnetOut.send('jsonlist2', (err, result) => {
        if (err) {
            adapter.log.error(err);
        }

        if (!connected) {
            adapter.log.info('Connected FHEM telnet ' + adapter.config.host + ':' + adapter.config.port);
            adapter.log.debug('[startSync] Connected');
            connected = true;
            adapter.setState('info.connection', true, true);
        }

        if (result) {
            let objects = null;
            try {
                objects = JSON.parse(result)
            } catch (e) {
                adapter.log.error('startSync: Cannot parse answer for jsonlist2: ' + e);
            }
            if (objects) {
                parseObjects(objects.Results, () => {
                    adapter.log.info('Synchronised FHEM!');
                    adapter.log.debug('[startSync] Synchronised!');
                    adapter.log.info('Search unused objects *');
                    unusedObjects('*', cb);
                    synchro = false;
                    if (cb) {
                        cb();
                        cb = null;
                    }
                });

            } else if (cb) {
                cb();
                cb = null;
            }
        } else if (cb) {
            cb();
            cb = null;
        }
    });
}

//--------------------------------------------------------------------------------------
function convertFhemValue(val) {
    val = val.trim();
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val === 'on') return true;
    if (val === 'off') return false;
    if (val === 'ok') return 'ok'; // what can it be?
    const f = parseFloat(val);
    if (f == val) return f;
    return val;
}

//--------------------------------------------------------------------------------------
function readValue(id, cb) {
    telnetOut.send('get ' + fhemObjects[id].native.Name + ' ' + fhemObjects[id].native.Attribute, (err, result) => {
        if (err) adapter.log.error('readValue: ' + err);
        // MeinWetter city => Berlin
        if (result) {
            result = convertFhemValue(result.substring(fhemObjects[id].native.Name.length + fhemObjects[id].native.Attribute + 5));
            if (result !== '') {
                adapter.setForeignState(id, result, true);
                adapter.log.info('readValue: ' + id + result);
            }
        }

        if (cb) cb();
    });
}

//--------------------------------------------------------------------------------------
function writeValue(id, val, cb) {
    let cmd;
    const valOrg = val;
    let parts;
    adapter.log.debug('[writeValue] Event ioBroker: ' + id + ' ' + val);
    if (val === undefined || val === null) val = '';
    parts = id.split('.');
    // attr?
    if (allowedAttributes.indexOf(parts[4]) !== -1) {
        cmd = 'attr ' + fhemObjects[id].native.Name + ' ' + parts[4] + ' ' + val;
        adapter.log.info('Event ioBroker: ' + id + ' ' + val + ' ==> writeFHEM: ' + cmd);
        telnetOut.send(cmd, (err, result) => {
            if (err) adapter.log.error('[writeValue] ' + err);
            if (cb) cb();
        });
        return;
    }
    // rgb?
    if (fhemObjects[id].native.Attribute === 'rgb') val = val.substring(1);
    // state?
    if (fhemObjects[id].native.Attribute === 'state') {
        if (val === '1' || val === 1 || val === 'on' || val === 'true' || val === true) val = 'on';
        if (val === '0' || val === 0 || val === 'off' || val === 'false' || val === false) val = 'off';
        cmd = 'set ' + fhemObjects[id].native.Name + ' ' + val;
    } else {
        cmd = 'set ' + fhemObjects[id].native.Name + ' ' + fhemObjects[id].native.Attribute + ' ' + val;
        // button?
        if (fhemObjects[id].common.role === 'button') {cmd = 'set ' + fhemObjects[id].native.Name + ' ' + fhemObjects[id].native.Attribute}
    }
    adapter.log.info('Event ioBroker: ' + id + ' ' + valOrg + ' ==> writeFHEM: ' + cmd);
    telnetOut.send(cmd, (err, result) => {
        if (err) adapter.log.error('[writeValue] ' + err);
        if (cb) cb();
    });
}

//--------------------------------------------------------------------------------------
function requestMeta(name, attr, value, event, cb) {
    // send command JsonList2
    telnetOut.send('jsonlist2 ' + name, (err, result) => {
        if (err) {
            adapter.log.error('[requestMeta] ' + err);
        }
        if (result) {
            let objects = null;
            try {
                objects = JSON.parse(result)
            } catch (e) {
                adapter.log.error('[requestMeta] Cannot parse answer for jsonlist2: ' + e);
            }
            if (objects) {
                parseObjects(objects.Results, () => {
                    if (cb) {
                        cb();
                        cb = null;
                    }
                });
            } else if (cb) {
                cb();
                cb = null;
            }
        } else if (cb) {
            cb();
            cb = null;
        }
    });
}

//--------------------------------------------------------------------------------------
function deleteChannel(name, cb) {
    adapter.deleteChannel(name, err => {
        if (err) {if (err !== 'Not exists') adapter.log.error('[deleteChannel] ' + name + ' ' + err)}
        if (cb) cb();
    });
}

//--------------------------------------------------------------------------------------
function deleteObject(name, cb) {
    adapter.log.debug('[deleteObject] ' + name);
    adapter.delObject(name, err => {
        if (err) {if (err !== 'Not exists') adapter.log.error('[deleteObject] ' + name + ' ' + err)}
        if (cb) cb();
    });
}

//--------------------------------------------------------------------------------------
function deleteState(name, cb) {
    adapter.log.debug('[deleteState] ' + name);
    adapter.delState(name, err => {
        if (err) {if (err !== 'Not exists') adapter.log.error('[deleteState] ' + name + ' ' + err)}
        if (cb) cb();
    });
}

//--------------------------------------------------------------------------------------
function unusedObjects(check, cb) {
    const channel = 'no';
    adapter.log.debug('[unusedObjects] check ' + check);
    adapter.getStates(check, (err, states) => {
        if (err) {
            adapter.log.error('[unusedObjects] ' + err);
        } else {
            for (const id in states) {
                if (!states.hasOwnProperty(id)) continue;

                adapter.getObject(id, (err, obj) => {
                    if (err) {
                        adapter.log.error('[unusedObjects] ' + err);
                    } else {
                        if (!obj) return;
                        const channelS = obj._id.split('.');
                        if (channelS[2] === 'info') return;
                        if (check === '*') {
                            if (obj.native.ts < ts_update || !obj.native.ts) {
                                if (channelS[3] === 'Internals' && channelS[4] === 'TYPE') {
                                    queueL.push({
                                        command: 'delChannel',
                                        name: channelS[2]
                                    });
                                    processQueueL();
                                }
                                queueL.push({
                                    command: 'delObject',
                                    name: obj._id
                                });
                                processQueueL();
                                queueL.push({
                                    command: 'delState',
                                    name: obj._id
                                });
                                processQueueL();
                            }
                        } else {
                            if (channelS[3] === 'Internals' && channelS[4] === 'TYPE') {
                                queueL.push({
                                    command: 'delChannel',
                                    name: channelS[2]
                                });
                                processQueueL();
                            }
                            delete fhemObjects[obj._id];
                            queueL.push({
                                command: 'delObject',
                                name: obj._id
                            });
                            processQueueL();
                            queueL.push({
                                command: 'delState',
                                name: obj._id
                            });
                            processQueueL();
                        }
                    }
                });
            }
        }
    });
    if (cb) cb();
}

//-------------------------------------------------------------------------------------------------------------------------------
function processQueue() {
    if (telnetOut.isCommandRunning() || !queue.length) return;
    const command = queue.shift();
    if (command.command === 'resync') {
        startSync(() => setImmediate(processQueue));
    } else if (command.command === 'read') {
        readValue(command.id, () => setImmediate(processQueue));
    } else if (command.command === 'write') {
        writeValue(command.id, command.val, () => setImmediate(processQueue));
    } else if (command.command === 'meta') {
        requestMeta(command.name, command.attr, command.val, command.event, () => setImmediate(processQueue));
    } else {
        adapter.log.error('Unknown task: ' + command.command);
        setImmediate(processQueue);
    }
}

//-------------------------------------------------------------------------------------------------------------------------------
function processQueueL() {
    if (!queueL.length) return;
    const command = queueL.shift();
    if (command.command === 'resync') {
        startSync(() => setImmediate(processQueueL));
    } else if (command.command === 'delObject') {
        deleteObject(command.name, () => setImmediate(processQueueL));
    } else if (command.command === 'delState') {
        deleteState(command.name, () => setImmediate(processQueueL));
    } else if (command.command === 'delChannel') {
        deleteChannel(command.name, () => setImmediate(processQueueL));
    } else {
        adapter.log.error('Unknown task: ' + command.command);
        setImmediate(processQueueL);
    }
}

//================================================================================================================================== end
function main() {
    adapter.config.host = adapter.config.host || '127.0.0.1';
    adapter.config.port = parseInt(adapter.config.port, 10) || 7072;
    adapter.config.reconnectTimeout = parseInt(adapter.config.reconnectTimeout, 10) || 30000;
    if (adapter.config.prompt === undefined) adapter.config.prompt = 'fhem>';

    // in this template all states changes inside the adapters namespace are subscribed
    adapter.subscribeStates('*');

    telnetIn = new Telnet({
        host: adapter.config.host,
        port: adapter.config.port,
        password: adapter.config.password,
        reconnectTimeout: adapter.config.reconnectTimeout,
        readOnly: true,
        prompt: adapter.config.prompt
    });
    telnetIn.on('data', data => parseEvent(data));

    telnetOut = new Telnet({
        host: adapter.config.host,
        port: adapter.config.port,
        password: adapter.config.password,
        reconnectTimeout: adapter.config.reconnectTimeout,
        prompt: adapter.config.prompt
    });

    telnetOut.on('ready', () => !connected && startSync());
    telnetOut.on('end', () => {
        if (connected) {
            adapter.log.debug('Disconnected');
            connected = false;
            adapter.setState('info.connection', false, true);
        }
    });
    telnetOut.on('close', () => {
        if (connected) {
            adapter.log.debug('Disconnected');
            connected = false;
            adapter.setState('info.connection', false, true);
        }
    });
}
