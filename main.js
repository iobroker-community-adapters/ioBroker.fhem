/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */

'use strict';
const utils = require('@iobroker/adapter-core');
const Telnet = require(__dirname + '/lib/telnet');
const adapter = utils.Adapter('fhem');
// Telnet sessions
let telnetOut = null; // read config and write values 
let telnetIn = null; // receive events

let connected = false;
const queue = [];
const queueL = [];
let fhemIN = {};
let fhemINs = {};
let fhemIgnore = {};
const fhemObjects = {};
const functions = {};
let lastNameQueue;
let lastNameTS = '0';
let iobroker = false;
let firstRun = true;
let synchro = true;
let resync = false;
let debug = false;
const buildDate = '19.04.19';
const linkREADME = 'https://github.com/iobroker-community-adapters/ioBroker.fhem/blob/master/docs/de/README.md';
//Debug
let debugNAME = [];
//Configuratios
let autoRole = false;
let autoFunction = false;
let autoConfigFHEM = false;
let autoSmartName = true;
let oldState = false;
let deleteUnusedObjects = true;
let onlySyncNAME = [];
let onlySyncTYPE = [];                                          //19.04.19
const onlySyncRoomS = ['ioBroker', 'ioB_OUT'];
let onlySyncRoom = [];
const ignoreObjectsInternalsTYPES = [];
let ignoreObjectsInternalsTYPE = [];
const ignoreObjectsInternalsNAMES = ['info'];
let ignoreObjectsInternalsNAME = [];
const ignoreObjectsAttributesroomS = [];
let ignoreObjectsAttributesroom = [];
const ignorePossibleSetsS = ['getConfig', 'etRegRaw', 'egBulk', 'regSet', 'deviceMsg', 'CommandAccepted'];
let ignorePossibleSets = [];
const ignoreReadingsS = ['currentTrackPositionSimulated', 'currentTrackPositionSimulatedSec'];
let ignoreReadings = [];
const allowedAttributesS = ['room', 'alias', 'comment'];
let allowedAttributes = [];
const allowedInternalsS = ['TYPE', 'NAME'];
let allowedInternals = [];
const allowedIOBinS = [];
let allowedIOBin = [];
//parseObject
const dimPossibleSets = ['pct', 'brightness', 'dim'];
const volumePossibleSets = ['Volume', 'volume', 'GroupVolume'];
const temperaturePossibleSets = ['desired-temp'];
const Utemperature = ['temperature', 'measured-temp', 'desired-temp', 'degrees', 'box_cputemp', 'temp_c', 'cpu_temp', 'cpu_temp_avg'];
const rgbPossibleSets = ['rgb'];
const Rindicator = ['reachable', 'presence', 'battery', 'Activity', 'present'];
//Settings
let logCheckObject = false;
let logUpdateChannel = false;
let logCreateChannel = true;
let logDeleteChannel = true;
let logEventIOB = true;
let logEventFHEM = false;
let logEventFHEMglobal = true;
let logEventFHEMreading = false;
let logEventFHEMstate = false;
let logUnhandledEventFHEM = true;
let logIgnoreConfigurations = true;
let ts_update;
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
    if (!Object.keys(fhemINs).length && id.indexOf(adapter.namespace) === -1) {
        return;
    }
    let idFHEM = id.replace(/-/g, '_');
    if (fhemINs[idFHEM]) {
        adapter.log.debug('[stateChange] ' + id + ' ' + JSON.stringify(state));
        if (!fhemIN[idFHEM]) {
            sendFHEM('define ' + idFHEM + ' dummy');
            sendFHEM('attr ' + idFHEM + ' alias ' + idFHEM);
            sendFHEM('attr ' + idFHEM + ' room ioB_IN');
            sendFHEM('attr ' + idFHEM + ' comment Auto-created by ioBroker ' + adapter.namespace);
            sendFHEM('set ' + idFHEM + ' ' + state.val);
            fhemIN[idFHEM] = {id: idFHEM};
            adapter.setState('info.Info.numberObjectsIOBout', Object.keys(fhemIN).length, true);
        } else {
            sendFHEM('set ' + idFHEM + ' ' + state.val);
        }
    }
    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        if (!connected) {
            adapter.log.warn('Cannot send command to "' + id + '", because not connected');
            return;
        }

        if (id === adapter.namespace + '.info.resync') {
            queue.push({
                command: 'resync'
            });
            processQueue();
        } else if (fhemObjects[id] || id.indexOf(adapter.namespace + '.info.Commands') !== -1 || id.indexOf(adapter.namespace + '.info.Debug') !== -1 || id.indexOf(adapter.namespace + '.info.Settings') !== -1 || id.indexOf(adapter.namespace + '.info.Configurations') !== -1) {
            adapter.log.debug('in: ' + id + ' ' + state.val);
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
            if (obj.callback) {
                adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
            }
        }
    }
});
// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', main);
//========================================================================================================================================== start

function checkID(event, val, name, attr, id) {
    for (const f in fhemObjects) {
        if (fhemObjects.hasOwnProperty(f) && fhemObjects[f].native.Name === name && fhemObjects[f].native.Attribute === attr) {
            adapter.log.debug('[checkID] (FHEM) ' + event + ' > (ioBroker) ' + fhemObjects[f]._id + ' ' + val);
            id = fhemObjects[f]._id;
        }
    }
    return id;
}
function parseEvent(event) {
    if (!event) {
        return;
    }
    logEventFHEM && adapter.log.info('event (FHEM) "' + event + '"');
    // Sonos special
    if (event.indexOf('display_covertitle') !== -1) {
        return;
    }
    let ts = undefined;
    if (event[4] === '-' && event[7] === '-') {
        ts = new Date(event.substring(0, 19)).getTime();
        event = event.substring(20);
    }
    let name;
    let id;
    let val;
    const pos = event.indexOf(':');
    let parts = event.split(' ');
    try {
        debugNAME.indexOf(parts[1]) !== -1 && adapter.log.info('[' + parts[1] + '] event (FHEM) "' + event + '"');
        // event only parts[0] ?
        if (!parts[1]) {
            adapter.log.debug('[parseEvent] unhandled event (FHEM) "' + event + ' - only parts[0] = no sync');
            return;
        }
        // ignore ioB.IN
        if (fhemIN[parts[1].replace(/-/g, '_')]) {
            adapter.log.debug('[parseEvent] unhandled event (FHEM) "' + event + ' - included in fhemIN = no sync');
            return;
        }
        // ignore Reading?
        if (parts[2] && parts[2].substr(parts[2].length - 1) === ':' && ignoreReadings.indexOf(parts[2].substr(0, parts[2].length - 1)) !== -1) {
            adapter.log.debug('[parseEvent] unhandled event (FHEM) "' + event + ' - included in ignoreReadings (' + ignoreReadings + ') = no sync');
            return;
        }
        // No cannel for event and not global?
        if (!fhemObjects[adapter.namespace + '.' + parts[1].replace(/\./g, '_')] && parts[1] !== 'global') {
            adapter.log.debug('[parseEvent] unhandled event (FHEM) "' + event + ' - not in fhemObjects and not global = no sync');
            return;
        }
        // Global global ?
        if (parts[0] === 'Global' && parts[1] === 'global') {
            debugNAME.indexOf(parts[3]) !== -1 && adapter.log.info('[' + parts[3] + '] event FHEM(g) "' + event + '"');
            if (parts[2] === 'SAVE' || parts[2] === 'UPDATE') {
                adapter.log.debug('[parseEvent] unhandled event FHEM(g) "' + event + ' - SAVE or UPDATE = no sync');
                return;
            }
            if (parts[2] === 'ATTR' && parts[4] === 'model') {
                adapter.log.debug('[parseEvent] unhandled event FHEM(g) "' + event + ' - ATTR model = no sync');
                return;
            }
            if (!parts[3]) {
                adapter.log.debug('[parseEvent] unhandled event FHEM(g) "' + event + ' - no parts[3] = no sync');
                return;
            }
            // ignore ioB.IN
            if (parts[3] && fhemIN[parts[3].replace(/-/g, '_')]) {
                adapter.log.debug('[parseEvent] unhandled event FHEM(g) "' + event + ' - included in fhemIN = no sync');
                return;
            }
            // Global global DEFINED ?
            if (parts[2] === 'DEFINED') {
                logEventFHEMglobal && adapter.log.info('event FHEM(g) "' + event + '"');
                queue.push({
                    command: 'meta',
                    name: parts[3],
                    attr: 'state',
                    val: 'no',
                    event: event
                });
                processQueue();
                return;
            }
            // No channel for event and not room?
            if (!fhemObjects[adapter.namespace + '.' + parts[3].replace(/\./g, '_')] && parts[4] !== 'room') {
                adapter.log.debug('[parseEvent] unhandled event FHEM(g) "' + event + ' - not in fhemObjects and no room = no sync');
                return;
            }
            // Global global ATTR ?
            if (parts[2] === 'ATTR' && allowedAttributes.indexOf(parts[4]) !== -1) {
                logEventFHEMglobal && adapter.log.info('event FHEM(g) "' + event + '"');
                queue.push({
                    command: 'meta',
                    name: parts[3],
                    attr: 'no',
                    val: parts[4],
                    event: event
                });
                processQueue();
                return;
            }
            // Global global DELETEATTR ?
            if (parts[2] === 'DELETEATTR' && allowedAttributes.indexOf(parts[4]) !== -1) {
                logEventFHEMglobal && adapter.log.info('event FHEM(g) "' + event + '"');
                if (parts[4] === 'room' && iobroker) {
                    unusedObjects(parts[3].replace(/\./g, '_') + '.*');
                } else {
                    unusedObjects(parts[3].replace(/\./g, '_') + '.Attributes.' + parts[4]);
                }
                if (parts[4] === 'alias') {
                    queue.push({
                        command: 'meta',
                        name: parts[3],
                        attr: 'no',
                        val: parts[4],
                        event: event
                    });
                    processQueue();
                }
                return;
            }
            // Global global DELETED ?
            if (parts[2] === 'DELETED') {
                logEventFHEMglobal && adapter.log.info('event FHEM(g) "' + event + '"');
                unusedObjects(parts[3].replace(/\./g, '_') + '.*');
                return;
            }
            logUnhandledEventFHEM && adapter.log.info('unhandled event FHEM(g) "' + event + '" > jsonlist2');
            queue.push({
                command: 'meta',
                name: parts[3],
                attr: 'no',
                val: parts[4],
                event: event
            });
            processQueue();
            return;
        }
        // state ? (ohne : oder : hinten)
        const stelle = event.substring(parts[0].length + parts[1].length + parts[2].length + 1);
        if (pos === -1 || stelle.indexOf(':') !== 0) {
            if (oldState) {
                val = convertFhemValue(event.substring(parts[0].length + parts[1].length + 2));
            } else {
                val = event.substring(parts[0].length + parts[1].length + 2);
            }
            //send2ioB ?
            if (parts[1] === adapter.namespace + '.send2ioB') {
                id = checkID(event, val, parts[1], 'state', id);                //19.04.19
                adapter.setState(id, {
                    val: val,
                    ack: true,
                    ts: ts
                });
                adapter.getForeignObject(parts[2], function (err, obj) {
                    if (err) {
                        adapter.log.error('error:' + err);
                    } else if (!obj) {
                        adapter.log.warn('event FHEM "' + event + '" > object "' + parts[2] + '" not found!');
                    } else if (obj && !obj.common.write) {
                        adapter.log.warn('event FHEM "' + event + '" > object "' + parts[2] + '" common.write not true');
                    } else if (obj && obj.common.write) {
                        let setState = event.substr(parts[0].length + parts[1].length + parts[2].length + 2);
                        logEventFHEMstate && adapter.log.info('event FHEM(s) "' + event + '" > ' + parts[2] + ' (' + setState + ')');
                        adapter.setForeignState(parts[2], setState, false);
                    }
                });
                return;
            }
            id = checkID(event, val, parts[1], 'state', id);
            if (fhemObjects[id]) {
                adapter.setState(id, {
                    val: val,
                    ack: true,
                    ts: ts
                });
                logEventFHEMstate && adapter.log.info('event FHEM(s) "' + event + '" > ' + id + '  ' + val);
                // check state
                let id_state = adapter.namespace + '.' + parts[1].replace(/\./g, '_');
                // state_switch?
                if (fhemObjects[id_state + '.state_switch']) {
                    adapter.setState(id_state + '.state_switch', convertFhemValue(parts[2]), true);
                }
                // state_media?
                if (fhemObjects[id_state + '.state_media']) {
                    val = (parts[2] === 'PLAYING');
                    adapter.setState(id_state + '.state_media', val, true);
                }
                // state_bollean?
                if (fhemObjects[id_state + '.state_boolean'] && typeof (convertFhemStateBoolean(parts[2])) === "boolean") {
                    adapter.setState(id_state + '.state_boolean', convertFhemStateBoolean(parts[2]), true);
                }
                // state_value?
                if (fhemObjects[id_state + '.state_value'] && typeof (convertFhemStateValue(parts[2])) === "number") {
                    adapter.setState(id_state + '.state_value', convertFhemStateValue(parts[2]), true);
                }
                // special for ZWave dim
                if (parts[0] === 'ZWave' && parts[2] === 'dim') {
                    let zwave = parts[0] + ' ' + parts[1] + ' ' + parts[2] + ': ' + parts[3];
                    adapter.log.info('event (Create4ZWave) "' + zwave + '"');
                    parseEvent(zwave);
                }
            } else {
                adapter.log.debug('[parseEvent] no object(S): "' + event + '" > ' + id + ' = ' + val);
                queue.push({
                    command: 'meta',
                    name: parts[1],
                    attr: 'state',
                    val: val,
                    event: event
                });
                processQueue();
            }
            return;
        }
        // reading or state? (mit : vorne)
        if (pos !== -1) {
            let typ;
            let idTest = checkID(event, val, parts[1], 'state', id);
            adapter.getState(idTest, function (err, state) {
                err && adapter.log.error('[parseEvent] rs? ' + err);
                if (state !== null && typeof (state.val) !== "boolean" && state.val.substring(0, parts[2].length) === parts[2]) {
                    val = convertFhemValue(event.substring(parts[0].length + parts[1].length + 2));
                    id = checkID(event, val, parts[1], 'state', id);
                    typ = 'state';
                    adapter.log.debug('(1) ' + event + ' typ = ' + typ + ' id = ' + id + ' val = ' + val);
                } else {
                    name = event.substring(0, pos);
                    let partsR = name.split(' ');
                    val = convertFhemValue(event.substring(partsR[0].length + partsR[1].length + partsR[2].length + 4));
                    id = checkID(event, val, partsR[1], partsR[2], id);
                    // rgb? insert # usw
                    val = convertAttr(partsR[2], val);
                    typ = 'reading';
                    adapter.log.debug('(2) ' + event + ' typ = ' + typ + ' id = ' + id + ' val = ' + val);
                }
                //readingsGroup?
                if (!fhemObjects[id]) {
                    if (parts[0] === 'readingsGroup') {
                        parts[2] = parts[2].substr(0, parts[2].length - 1);
                        let name = adapter.namespace + '.' + parts[1].replace(/\./g, '_') + '.readingsGroup.' + parts[2].replace(/\./g, '_');
                        debugNAME.indexOf(parts[1]) !== -1 && adapter.log.info('[' + parts[1] + '] detect readingsGroup "' + parts[2] + '" > check object "' + name + '"');
                        let RG = {
                            _id: name,
                            type: 'state',
                            common: {
                                name: parts[1] + ' ' + parts[2],
                                type: 'string',
                                role: 'html',
                                read: true,
                                write: false
                            },
                            native: {
                                Name: parts[1],
                                Attribute: parts[2],
                                noDelete: true
                            }
                        };
                        let stateRG = {
                            id: RG._id,
                            val: parts[3],
                            ts: Date.now(),
                            ack: true
                        };
                        syncObjects([RG], () => {
                            syncStates([stateRG], () => {
                            });
                        });
                        return;
                    }
                    logUnhandledEventFHEM && adapter.log.info('unhandled event FHEM "' + event + '" > jsonlist2 ' + parts[1]);
                    (debugNAME.indexOf(parts[1]) !== -1 || debug) && adapter.log.warn('[' + parts[1] + ']' + ' unhandled event FHEM "' + event + '" > jsonlist2' + parts[1]);
                    if (parts[1] !== lastNameQueue || parts[1] === lastNameQueue && lastNameTS + 2000 < Date.now()) {
                        queue.push({
                            command: 'meta',
                            name: parts[1],
                            attr: parts[2],
                            val: val,
                            event: event
                        });
                        processQueue();
                        lastNameQueue = parts[1];
                        lastNameTS = Date.now();
                    }

                } else {
                    if (logEventFHEMreading && typ === 'reading') {
                        adapter.log.info('event FHEM(r) "' + event + '" > ' + id + ' ' + val);
                    }
                    if (logEventFHEMstate && typ === 'state') {
                        adapter.log.info('event FHEM(s) "' + event + '" > ' + id + ' ' + val);
                    }
                    adapter.setState(id, {
                        val: val,
                        ack: true,
                        ts: ts
                    });
                }
                return;
            });
        }
    } catch (err) {
        adapter.log.error('[parseEvent] event: "' + event + '" ' + err);
    }
}
function syncStates(states, cb) {
    if (!states || !states.length) {
        adapter.log.debug('end [syncStates]');
        cb();
        return;
    }
    const state = states.shift();
    const id = state.id;
    delete state.id;
    adapter.setState(id, state, err => {
        err && adapter.log.error('[syncStates] ' + err);
        setImmediate(syncStates, states, cb);
    });
}
function syncObjects(objects, cb) {
    if (!objects || !objects.length) {
        adapter.log.debug('[syncObjects] end');
        adapter.setState('info.Info.numberObjectsIOBin', Object.keys(fhemObjects).length, true);
        cb();
        return;
    }
    if (resync) {
        adapter.log.debug('[syncObjects] Abbruch durch resync');
        return;
    }
    const obj = objects.shift();
    fhemObjects[obj._id] = obj;
    const parts = obj._id.split('.');
    adapter.getForeignObject(obj._id, (err, oldObj) => {
        if (err)
            adapter.log.error('[syncObjects] ' + err);
        if (!oldObj) {
            if (obj.type === 'channel') {
                adapter.log.info('Create channel ' + obj._id + ' (' + obj.common.name + ')');
            }
            debugNAME.indexOf(parts[2]) !== -1 && adapter.log.info('[' + parts[2] + '] create ' + obj.type + ' ' + obj._id);
            adapter.setForeignObject(obj._id, obj, err => {
                err && adapter.log.error('[syncObjects] ' + err);
                setImmediate(syncObjects, objects, cb);
            });
        } else {
            if (JSON.stringify(obj.native) === JSON.stringify(oldObj.native) && JSON.stringify(obj.common) === JSON.stringify(oldObj.common)) {
                setImmediate(syncObjects, objects, cb);
            } else {
                let newObj = JSON.parse(JSON.stringify(oldObj));
                let updateText = '';
                if (JSON.stringify(obj.native) !== JSON.stringify(oldObj.native)) {
                    newObj.native = obj.native;
                    updateText = updateText + ' native';
                }
                if (JSON.stringify(obj.common) !== JSON.stringify(oldObj.common)) {
                    newObj.common.name = obj.common.name;
                    updateText = updateText + ' common';
                    if (autoSmartName) {
                        newObj.common.smartName = obj.common.smartName;
                    }
                    if (autoRole) {
                        newObj.common.type = obj.common.type;
                        newObj.common.role = obj.common.role;
                        newObj.common.min = obj.common.min;
                        newObj.common.max = obj.common.max;
                        newObj.common.unit = obj.common.unit;
                        newObj.common.read = obj.common.read;
                        newObj.common.write = obj.common.write;
                        newObj.common.states = obj.common.states;
                        //newObj.common.desc = obj.common.desc;
                    }
                }
                if (JSON.stringify(newObj) !== JSON.stringify(oldObj)) {
                    if (obj.type === 'channel' && logUpdateChannel) {
                        adapter.log.info('Update channel ' + obj._id + '  (' + oldObj.common.name + ')');
                    }
                    debugNAME.indexOf(parts[2]) !== -1 && adapter.log.info('[' + parts[2] + '] update ' + obj.type + ' ' + obj._id + ' (' + updateText + ' )');
                    adapter.setForeignObject(obj._id, newObj, err => {
                        err && adapter.log.error('[syncObjects] ' + err);
                        setImmediate(syncObjects, objects, cb);
                    });
                } else {
                    setImmediate(syncObjects, objects, cb);
                }
            }
        }
    });
}
function syncRoom(room, members, cb) {
    adapter.log.debug('[syncRoom] (' + room + ') ' + members);
    adapter.getForeignObject('enum.rooms.' + room, (err, obj) => {
        err && adapter.log.error('[syncRoom] ' + err);
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
            adapter.log.debug('update' + obj._id + '"');
            adapter.setForeignObject(obj._id, obj, err => {
                err && adapter.log.error('[syncRoom] ' + err);
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
                adapter.log.debug('update "' + obj._id + '"');
                adapter.setForeignObject(obj._id, obj, err => {
                    err &&
                            adapter.log.error('[syncRoom] ' + err);
                    cb();
                });
            } else {
                cb();
            }
        }
    });
}
function syncRooms(rooms, cb) {
    for (const r in rooms) {
        if (!rooms.hasOwnProperty(r)) {
            continue;
        }
        if (rooms[r]) {
            syncRoom(r, rooms[r], () => setImmediate(syncRooms, rooms, cb));
            rooms[r] = null;
            return;
        }
    }
    cb && cb();
}
function syncFunction(funktion, members, cb) {
    adapter.log.debug('[syncFunction] (' + funktion + ') ' + members);
    adapter.getForeignObject('enum.functions.' + funktion, (err, obj) => {
        if (!obj) {
            obj = {
                _id: 'enum.functions.' + funktion,
                type: 'enum',
                common: {
                    name: funktion,
                    members: members
                },
                native: {}
            };
            adapter.log.debug('create' + obj._id + '"');
            adapter.setForeignObject(obj._id, obj, err => {
                err && adapter.log.error('[syncFunction] ' + err);
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
                adapter.log.debug('update "' + obj._id + '"');
                adapter.setForeignObject(obj._id, obj, err => {
                    err && adapter.log.error('[syncFunction] ' + err);
                    cb();
                });
            } else {
                cb();
            }
        }
    });
}
function syncFunctions(functions, cb) {
    for (const f in functions) {
        if (!functions.hasOwnProperty(f)) {
            continue;
        }
        if (functions[f]) {
            syncFunction(f, functions[f], () => setImmediate(syncFunctions, functions, cb));
            functions[f] = null;
            return;
        }
    }
    cb && cb();
}
function myObjects(cb) {
    adapter.log.debug('[myObjects] start');
    const newPoints = [
        // info.Commands
        {_id: 'info.Commands.lastCommand', type: 'state', common: {name: 'Last command to FHEM', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        {_id: 'info.Commands.resultFHEM', type: 'state', common: {name: 'Result of FHEM', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        {_id: 'info.Commands.sendFHEM', type: 'state', common: {name: 'Command to FHEM', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Commands.createSwitch', type: 'state', common: {name: 'Create dummy as switch in room FHEM (NAME room)', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        // info.Configurations
        {_id: 'info.Configurations.autoConfigFHEM', type: 'state', common: {name: 'FUNCTION allow special configurations FHEM', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Configurations.autoFunction', type: 'state', common: {name: 'FUNCTION set function automatically (use Adapter Material)', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Configurations.autoRole', type: 'state', common: {name: 'FUNCTION set role automatically (use Adapter Material)', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Configurations.autoSmartName', type: 'state', common: {name: 'FUNCTION if fhem.0 set smartName automatically (Adapter Cloud)', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Configurations.deleteUnusedObjects', type: 'state', common: {name: 'FUNCTION delete unused objects automatically', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Configurations.allowedIOBin', type: 'state', common: {name: 'SYNC allowed objects send2FHEM', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.ignoreObjectsInternalsTYPE', type: 'state', common: {name: 'SYNC ignore objects TYPE = ' + ignoreObjectsInternalsTYPES + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.ignoreObjectsInternalsNAME', type: 'state', common: {name: 'SYNC ignore objects NAME = ' + ignoreObjectsInternalsNAMES + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.ignoreObjectsAttributesroom', type: 'state', common: {name: 'SYNC ignore objects room = ' + ignoreObjectsAttributesroomS + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.allowedAttributes', type: 'state', common: {name: 'SYNC allowed Attributes = ' + allowedAttributesS + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.allowedInternals', type: 'state', common: {name: 'SYNC allowed Internals = ' + allowedInternalsS + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.ignoreReadings', type: 'state', common: {name: 'SYNC ignore Readings = ' + ignoreReadingsS + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.ignorePossibleSets', type: 'state', common: {name: 'SYNC ignore PossibleSets = ' + ignorePossibleSetsS + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.oldState', type: 'state', common: {name: 'FUNCTION old version of state with true/false', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Configurations.onlySyncRoom', type: 'state', common: {name: 'SYNC only sync devices if room exist = ' + onlySyncRoomS + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.onlySyncNAME', type: 'state', common: {name: 'SYNC only sync devices NAME = ', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.onlySyncTYPE', type: 'state', common: {name: 'SYNC only sync devices TYPE = ', type: 'string', read: true, write: true, role: 'state'}, native: {}}, //19.04.19
        // info.Debug
        {_id: 'info.Debug.jsonlist2', type: 'state', common: {name: 'jsonlist2 of FHEM', type: 'string', read: true, write: true, role: 'json'}, native: {}},
        {_id: 'info.Debug.meta', type: 'state', common: {name: 'Device NAME of FHEM', type: 'string', read: true, write: true, role: 'text'}, native: {}},
        {_id: 'info.Debug.activate', type: 'state', common: {name: 'Debug Mode for Device(s) NAME', type: 'string', read: true, write: true, role: 'text'}, native: {}},
        // info.Info
        {_id: 'info.Info.buildDate', type: 'state', common: {name: 'Date of main.js', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        {_id: 'info.Info.roomioBroker', type: 'state', common: {name: 'room of fhem.x.info.Configurations.onlySyncRoom exist', type: 'boolean', read: true, write: false, role: 'indicator'}, native: {}},
        {_id: 'info.Info.numberDevicesFHEM', type: 'state', common: {name: 'Number of devices FHEM (jsonlist2)', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        {_id: 'info.Info.numberDevicesFHEMsync', type: 'state', common: {name: 'Number of devices FHEM (synchro)', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        {_id: 'info.Info.numberObjectsIOBout', type: 'state', common: {name: 'Number of objects IOB out', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        {_id: 'info.Info.numberObjectsIOBoutSub', type: 'state', common: {name: 'Number of objects IOB out (possible)', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        {_id: 'info.Info.numberObjectsIOBin', type: 'state', common: {name: 'Number of objects IOB in', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        // info.Settings
        {_id: 'info.Settings.logCheckObject', type: 'state', common: {name: 'LOG "check channel ....." ', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Settings.logCreateChannel', type: 'state', common: {name: 'LOG "Create channel ....." ', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Settings.logDeleteChannel', type: 'state', common: {name: 'LOG "Delete channel ....." ', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Settings.logEventFHEM', type: 'state', common: {name: 'LOG "event FHEM ....." all events from FHEM over telnet)', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Settings.logEventFHEMglobal', type: 'state', common: {name: 'LOG "event FHEM(g) ....." events global from FHEM', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Settings.logEventFHEMreading', type: 'state', common: {name: 'LOG "event FHEM(r) ....." events readings from FHEM', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Settings.logEventFHEMstate', type: 'state', common: {name: 'LOG "event FHEM(s) ....." events state from FHEM', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Settings.logEventIOB', type: 'state', common: {name: 'LOG "event ioBroker ....." all events ioBroker to FHEM', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Settings.logUnhandledEventFHEM', type: 'state', common: {name: 'LOG "unhandled event FHEM ....." all events unhandled from FHEM', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Settings.logUpdateChannel', type: 'state', common: {name: 'LOG "Update channel ....." ', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: 'info.Settings.logIgnoreConfigurations', type: 'state', common: {name: 'LOG "ignore FHEM device ....." ignored Devices from FHEM (info.Configurations) ', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}}
    ];
    for (let i = 0; i < newPoints.length; i++) {
        adapter.setObject(newPoints[i]._id, newPoints[i], err => {
            err &&
                    adapter.log.error('[myObjects] ' + err);
            if (newPoints[i]._id.indexOf('Commands') !== -1) {
                adapter.setState(newPoints[i]._id, '.', true);
            }
            if (i === newPoints.length - 1) {
                adapter.log.info('> objects ' + adapter.namespace + '.info OK');
                adapter.log.debug('[myObjects] end');
                cb();
            }
        });
    }
    // Alte Objekte löschen
    adapter.getObject('info.Info.NumberObjects', (err, obj) => {
        err && adapter.log.error('[myObjects] ' + err);
        if (obj) {
            adapter.delObject('info.Info.NumberObjects', err => {
                err && adapter.log.error('[myObjects] ' + 'info.Info.NumberObjects' + ' ' + err);
            });
        }
    });
    adapter.getObject('info.Info.numberObjects', (err, obj) => {
        err && adapter.log.error('[myObjects] ' + err);
        if (obj) {
            adapter.delObject('info.Info.numberObjects', err =>
                err && adapter.log.error('[myObjects] ' + 'info.Info.numberObjects' + ' ' + err));
        }
    });
}
function getSetting(id, setting, callback, cb) {
    adapter.log.debug('[getSetting] ' + id + ' ' + setting);
    adapter.getObject(id, (err, objO) => {
        err && adapter.log.error('[getSetting] ' + err);
        if (objO) {
            adapter.getState(id, (err, obj) => {
                err && adapter.log.error('[getSetting] ' + err);
                if (obj) {
                    obj.val && adapter.log.info('> ' + objO.common.name + ' - ' + id + ' (' + obj.val + ')');
                    callback(obj.val);
                    cb && cb();
                } else {
                    adapter.setState(id, setting, true);
                    setting && adapter.log.info('> ' + objO.common.name + ' - ' + id + ' (' + setting + ')');
                    callback(setting);
                    cb && cb();
                }
            });
        }
    });
}
function getSettings(cb) {
    adapter.log.debug('[getSettings] start');
    if (!firstRun)
        adapter.log.info('change Settings ===== check ' + adapter.namespace + '.' + 'info.Settings (true) - select message ioBroker admin > LOG');
    getSetting('info.Settings.logCheckObject', logCheckObject, value => logCheckObject = value);
    getSetting('info.Settings.logUpdateChannel', logUpdateChannel, value => logUpdateChannel = value);
    getSetting('info.Settings.logCreateChannel', logCreateChannel, value => logCreateChannel = value);
    getSetting('info.Settings.logDeleteChannel', logDeleteChannel, value => logDeleteChannel = value);
    getSetting('info.Settings.logEventIOB', logEventIOB, value => logEventIOB = value);
    getSetting('info.Settings.logEventFHEM', logEventFHEM, value => logEventFHEM = value);
    getSetting('info.Settings.logEventFHEMglobal', logEventFHEMglobal, value => logEventFHEMglobal = value);
    getSetting('info.Settings.logEventFHEMreading', logEventFHEMreading, value => logEventFHEMreading = value);
    getSetting('info.Settings.logEventFHEMstate', logEventFHEMstate, value => logEventFHEMstate = value);
    getSetting('info.Settings.logUnhandledEventFHEM', logUnhandledEventFHEM, value => logUnhandledEventFHEM = value);
    getSetting('info.Settings.logIgnoreConfigurations', logIgnoreConfigurations, value => {
        logIgnoreConfigurations = value;
        adapter.log.debug('[getSettings] end');
        cb && cb();
    });
}
function getConfig(id, config, cb) {
    adapter.log.debug('[getConfig] ' + id + ' (' + config + ')');
    adapter.getObject(id, (err, objO) => {
        err && adapter.log.error('[getConfig] ' + err);
        if (objO) {
            adapter.getState(id, (err, obj) => {
                err && adapter.log.error('[getConfig] ' + err);
                adapter.log.debug('[getConfig] getState ' + id + ': ' + JSON.stringify(obj));
                if (obj && obj.val) {
                    const part = obj.val.split(",");
                    if (part[0]) {
                        for (const i in part) {
                            config.push(part[i].trim());
                        }
                    }
                    config.length && adapter.log.info('> ' + objO.common.name + ' - ' + id + ' (' + config + ')');
                    cb && cb();
                } else {
                    cb && cb();
                }
            });
        }
    });
}
function getConfigurations(cb) {
    adapter.log.debug('[getConfigurations] start');
    if (!firstRun)
        adapter.log.info('change Configurations ===== check ' + adapter.namespace + '.' + 'info.Configurations (true or value) - select function of Adapter and Devices to sync');
    getSetting('info.Configurations.autoRole', autoRole, value => autoRole = value);
    getSetting('info.Configurations.autoFunction', autoFunction, value => autoFunction = value);
    getSetting('info.Configurations.autoConfigFHEM', autoConfigFHEM, value => autoConfigFHEM = value);
    getSetting('info.Configurations.autoSmartName', autoSmartName, value => autoSmartName = value);
    getSetting('info.Configurations.deleteUnusedObjects', deleteUnusedObjects, value => deleteUnusedObjects = value);
    getSetting('info.Configurations.oldState', oldState, value => {
        oldState = value;
    });
    allowedIOBin = allowedIOBinS.slice();
    getConfig('info.Configurations.allowedIOBin', allowedIOBin, value => {
    });
    ignoreObjectsAttributesroom = ignoreObjectsAttributesroomS.slice();
    getConfig('info.Configurations.ignoreObjectsAttributesroom', ignoreObjectsAttributesroom, value => {
    });
    ignoreObjectsInternalsNAME = ignoreObjectsInternalsNAMES.slice();
    getConfig('info.Configurations.ignoreObjectsInternalsNAME', ignoreObjectsInternalsNAME, value => {
    });
    ignoreObjectsInternalsTYPE = ignoreObjectsInternalsTYPES.slice();
    getConfig('info.Configurations.ignoreObjectsInternalsTYPE', ignoreObjectsInternalsTYPE, value => {
    });
    allowedAttributes = allowedAttributesS.slice();
    getConfig('info.Configurations.allowedAttributes', allowedAttributes, value => {
    });
    allowedInternals = allowedInternalsS.slice();
    getConfig('info.Configurations.allowedInternals', allowedInternals, value => {
    });
    ignoreReadings = ignoreReadingsS.slice();
    getConfig('info.Configurations.ignoreReadings', ignoreReadings, value => {
    });
    ignorePossibleSets = ignorePossibleSetsS.slice();
    getConfig('info.Configurations.ignorePossibleSets', ignorePossibleSets, value => {
    });
    onlySyncNAME = [];
    getConfig('info.Configurations.onlySyncNAME', onlySyncNAME, value => {
    });
    onlySyncTYPE = [];                                                                                  //19.04.198
    getConfig('info.Configurations.onlySyncTYPE', onlySyncTYPE, value => {
    });
    onlySyncRoom = onlySyncRoomS.slice();
    getConfig('info.Configurations.onlySyncRoom', onlySyncRoom, value => {
        adapter.log.debug('[getConfigurations] end');
        cb && cb();
    });
}
function getDebug(cb) {
    adapter.log.debug('[getDebug] start');
    if (!firstRun)
        adapter.log.info('CHANGE dedug ===== check ' + adapter.namespace + '.' + 'info.Debug - Activate Debug-Mode for channel(s)');
    debugNAME = [];
    adapter.getState('info.Debug.activate', (err, obj) => {
        err && adapter.log.error('[getDebug] ' + err);
        if (obj) {
            const part = obj.val.split(",");
            if (part[0]) {
                for (const i in part) {
                    debugNAME.push(part[i].trim());
                }
            }
            if (debugNAME.length) {
                adapter.log.info('> ' + adapter.namespace + '.' + 'info.Debug.activate' + ' = ' + debugNAME);
            } else {
                adapter.log.info('> nothing to do - ' + adapter.namespace + '.' + 'info.Debug.activate');
            }
            adapter.log.debug('[getDebug] end');
            cb && cb();
        } else {
            adapter.log.debug('[getDebug] end');
            cb && cb();
        }
    });
}
function startSync(cb) {
    ts_update = Date.now();
    adapter.log.debug('[startSync] start ts_update = ' + ts_update + ' connected = ' + connected);
    let send = 'jsonlist2';
    if (onlySyncNAME.length) {
        send = send + ' ' + onlySyncNAME + ',' + adapter.namespce + '.send2ioB';
        adapter.log.info('> only jsonlist2 ' + onlySyncNAME + ' - ' + adapter.namespace + '.info.Configurations.onlySyncNAME (' + onlySyncNAME + ')');
    }
    // send command JsonList2
    telnetOut.send(send, (err, result) => {
        err && adapter.log.error('[startSync] telnetOut.send: ' + err);
        if (!connected) {
            adapter.log.info('> Connected FHEM telnet ' + adapter.config.host + ':' + adapter.config.port);
            adapter.log.info('> send telnet "' + send + '"');
            connected = true;
            adapter.setState('info.connection', true, true);
        }
        if (result) {
            adapter.log.debug('[startSync] result');
            let objects = null;
            try {
                objects = JSON.parse(result);
            } catch (e) {
                adapter.log.error('[startSync] Cannot parse answer for jsonlist2: ' + e);
            }
            if (objects) {
                adapter.log.debug('[startSync] objects');
                adapter.log.info('> get ' + objects.Results.length + ' Device(s) of FHEM');
                checkSubscribe((cb) => {
                    parseObjects(objects.Results, () => {
                        unusedObjects('*', (cb) => {
                            adapter.log.info('STEP 10 ==== check/create FHEM dummy Devices in room ioB_System');
                            if (fhemObjects[adapter.namespace + '.send2ioB']) {
                                adapter.log.warn('> please use ' + adapter.namespace + '.send2ioB instead of send2ioB > delete send2ioB');
                                sendFHEM('delete send2ioB');
                            }
                            let newID;
                            newID = adapter.namespace + '.send2ioB';
                            adapter.log.info('> dummy ' + newID + ' - use to set objects/states of ioBroker from FHEM');
                            if (!fhemObjects[adapter.namespace + '.' + adapter.namespace.replace(/\./g, '_') + '_send2ioB']) {
                                sendFHEM('define ' + newID + ' dummy');
                                sendFHEM('attr ' + newID + ' alias ' + newID);
                                sendFHEM('attr ' + newID + ' room ioB_System');
                                sendFHEM('attr ' + newID + ' comment Auto-created by ioBroker ' + adapter.namespace);
                            }
                            newID = adapter.namespace + '.alive';
                            adapter.log.info('> dummy ' + newID + ' - use to check alive FHEM Adapter in FHEM');
                            if (!fhemIgnore[newID]) {
                                sendFHEM('define ' + newID + ' dummy');
                                sendFHEM('attr ' + newID + ' alias ' + newID);
                                sendFHEM('attr ' + newID + ' room ioB_System');
                                sendFHEM('attr ' + newID + ' useSetExtensions 1');
                                sendFHEM('attr ' + newID + ' setList on:noArg off:noArg');
                                sendFHEM('attr ' + newID + ' event-on-change-reading .*');
                                sendFHEM('attr ' + newID + ' comment Auto-created by ioBroker ' + adapter.namespace);
                            }
                            //processQueue();
                            adapter.log.info('STEP 11 ==== info Synchro');
                            adapter.getStates('info.Info.*', (err, obj) => {
                                err && adapter.log.error('[getSetting] ' + err);
                                if (obj) {
                                    let end = 0;
                                    for (const id in obj) {
                                        if (!obj.hasOwnProperty(id)) {
                                            continue;
                                        }
                                        adapter.getObject(id, (err, objO) => {
                                            err && adapter.log.error('[getSetting] ' + err);
                                            if (objO) {
                                                adapter.log.info('> ' + objO.common.name + ' = ' + obj[id].val + ' - ' + id + ' (' + obj[id].val + ')');
                                            }
                                            end++;
                                            if (end === Object.keys(obj).length) {
                                                adapter.log.debug('fhemIgnore = ' + JSON.stringify(fhemIgnore));
                                                adapter.log.debug('fhemIN = ' + JSON.stringify(fhemIN));
                                                adapter.log.debug('fhemINs = ' + JSON.stringify(fhemINs));
                                                adapter.log.info('> activate ' + adapter.namespace + '.alive room ioB_System every 5 minutes');
                                                setAlive();
                                                adapter.log.warn('> more info FHEM Adapter visit ' + linkREADME);
                                                adapter.log.info('END ===== Synchronised FHEM :-)');
                                                synchro = false;
                                                firstRun = false;
                                                cb && cb();
                                            }
                                        });
                                    }
                                }
                            });
                            if (cb) {
                                cb();
                                cb = null;
                            }
                        });
                    });
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
function checkSubscribe(cb) {
    adapter.log.info('STEP 06 ===== check Subscribe');
    adapter.log.debug('[checkSubscribe] start ');
    if (!allowedIOBin.length) {
        adapter.log.info('> nothing to do - ' + adapter.namespace + '.info.Configurations.allowedIOBin');
        adapter.setState('info.Info.numberObjectsIOBoutSub', 0, true);
        cb && cb();
        return;
    }
    adapter.log.info('check ' + adapter.namespace + '.info.Configurations.allowedIOBin');
    let end = 0;
    allowedIOBin.forEach(search => {
        adapter.getForeignStates(search + '*', (err, states) => {
            if (err) {
                adapter.log.error('[checkSubscribe] error: ' + err);
            } else {
                adapter.log.debug('[checkSubscribe] found' + JSON.stringify(states));
                adapter.log.info('> ' + Object.keys(states).length + ' state(s) of "' + search + '" detected');
                for (const id in states) {
                    if (!states.hasOwnProperty(id)) {
                        continue;
                    }
                    adapter.subscribeForeignStates(id);
                    let idFHEM = id.replace(/-/g, '_');
                    fhemINs[idFHEM] = {id: idFHEM};
                    adapter.log.debug('[checkSubscribe] id = ' + id + ' / idFHEM = ' + idFHEM);
                }
                end++;
                if (end === allowedIOBin.length) {
                    adapter.setState('info.Info.numberObjectsIOBoutSub', Object.keys(fhemINs).length, true);
                    adapter.log.debug('[checkSubscribe] end');
                    cb && cb();
                }
            }
        });
    });
}
function getUnit(name) {
    name = name.toLowerCase();
    if (Utemperature.indexOf(name) !== -1) {
        return '°C';
    } else if (name.indexOf('power') !== -1) {
        return 'W';
    } else if (name.indexOf('energy') !== -1) {
        return 'Wh';
    } else if (name.indexOf('humidity') !== -1) {
        return '%';
    } else if (name.indexOf('pressure') !== -1) {
        return 'hPa';
    } else if (name.indexOf('speed') !== -1) {
        return 'kmh';
    } else if (name.indexOf('voltage') !== -1) {
        return 'V';
    }
    return undefined;
}
function parseObjects(objs, cb) {
    firstRun && adapter.log.info('STEP 07 ===== parse Objects');
    const rooms = {};
    const objects = [];
    const states = [];
    let id;
    let obj;
    let name;
    let suche = 'no';
    const debugShow = '';
    if (firstRun) {
        for (let i = 0; i < objs.length; i++) {
            try {
                if (iobroker) {
                    continue;
                }
                if (objs[i].Attributes.room) {
                    suche = objs[i].Attributes.room.split(',');
                    for (const r in suche) {
                        if (onlySyncRoom.indexOf(suche[r]) !== -1) {
                            adapter.log.debug('[parseObjects] found room ' + onlySyncRoom + ' / ' + i + ' > iobroker=true');
                            iobroker = true;
                        }
                    }
                }
            } catch (err) {
                adapter.log.error('[parseObjects] Cannot check room of object: ' + JSON.stringify(objs[i]));
                adapter.log.error('[parseObjects] Cannot check room of object: ' + err);
            }
        }
        adapter.setState('info.Info.numberDevicesFHEM', objs.length, true);
        adapter.log.info('> check channel - ' + objs.length + ' Device(s) of FHEM found');
        adapter.setState('info.Info.roomioBroker', iobroker, true);
        iobroker && adapter.log.info('> only sync device(s) from room(s) = ' + onlySyncRoom + ' - ' + adapter.namespace + '.info.Info.roomioBroker (' + iobroker + ')');
        onlySyncNAME.length && adapter.log.info('> only sync device(s) = ' + onlySyncNAME + ' - ' + adapter.namespace + '.info.Configurations.onlySyncNAME (' + onlySyncNAME + ')');
        ignoreObjectsAttributesroom.length && adapter.log.info('> no sync device(s) of room = ' + ignoreObjectsAttributesroom + ' - ' + adapter.namespace + '.info.Configurations.ignoreObjectsAttributesroom (' + ignoreObjectsAttributesroom + ')');
        ignoreObjectsInternalsNAME.length && adapter.log.info('> no sync device(s) with Internals:NAME = ' + ignoreObjectsInternalsNAME + ' - ' + adapter.namespace + '.info.Configurations.ignoreObjectsInternalsNAME (' + ignoreObjectsInternalsNAME + ')');
        ignoreObjectsInternalsTYPE.length && adapter.log.info('> no sync device(s) with Internals:TYPE = ' + ignoreObjectsInternalsTYPE + ' - ' + adapter.namespace + '.info.Configurations.ignoreObjectsInternalsTYPE (' + ignoreObjectsInternalsTYPE + ')');
    }
    for (let i = 0; i < objs.length; i++) {
        const debugN = '[' + objs[i].Name + ']';
        try {
            if (resync) {
                adapter.log.debug('[parseObjects] stop resync');
                return;
            }
            (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' check FHEM Device');
            if (onlySyncNAME.length && onlySyncNAME.indexOf(objs[i].Internals.NAME) === -1 && objs[i].Internals.NAME !== adapter.namespace + '.send2ioB') {         //19.04.19  
                logIgnoreConfigurations && adapter.log.info('ignore FHEM device "' + objs[i].Name + '" | NAME <> ' + onlySyncNAME + ' | ' + ' ' + (i + 1) + '/' + objs.length);
                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.warn(debugN + ' no sync - not included in ' + adapter.namespace + '.info.Config.onlySyncNAME');
                continue;
            }
            if (onlySyncTYPE.length && onlySyncTYPE.indexOf(objs[i].Internals.TYPE) === -1 && objs[i].Internals.NAME !== adapter.namespace + '.send2ioB') {         //19.04.19                 
                logIgnoreConfigurations && adapter.log.info('ignore FHEM device "' + objs[i].Name + '" | TYPE <> ' + onlySyncTYPE + ' | ' + ' ' + (i + 1) + '/' + objs.length);
                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.warn(debugN + ' no sync - not included in ' + adapter.namespace + '.info.Config.onlySyncTYPE');
                continue;
            }
            if (ignoreObjectsInternalsTYPE.indexOf(objs[i].Internals.TYPE) !== -1) {
                logIgnoreConfigurations && adapter.log.info('ignore FHEM device "' + objs[i].Name + '" | TYPE: ' + ignoreObjectsInternalsTYPE + ' | ' + ' ' + (i + 1) + '/' + objs.length);
                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.warn(debugN + ' no sync - included in ' + adapter.namespace + '.info.Config.ignoreObjectsInternalsTYPE');
                continue;
            }
            if (ignoreObjectsInternalsNAME.indexOf(objs[i].Internals.NAME) !== -1) {
                logIgnoreConfigurations && adapter.log.info('ignore FHEM device "' + objs[i].Name + '" | NAME: ' + ignoreObjectsInternalsNAME + ' | ' + ' ' + (i + 1) + '/' + objs.length);
                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.warn(debugN + ' no sync - included in ' + adapter.namespace + '.info.Config.ignoreObjectsInternalsNAME');
                continue;
            }
            if (ignoreObjectsAttributesroom.indexOf(objs[i].Attributes.room) !== -1) {
                logIgnoreConfigurations && adapter.log.info('ignore FHEM device "' + objs[i].Name + '" | room: ' + ignoreObjectsAttributesroom + ' | ' + ' ' + (i + 1) + '/' + objs.length);
                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.warn(debugN + ' no sync - included in ' + adapter.namespace + '.info.Config.ignoreObjectsAttributesroom');
                continue;
            }
            // Auto-created by ioBroker ?
            if (objs[i].Attributes.comment && objs[i].Attributes.comment.indexOf('Auto-created by ioBroker fhem') !== -1) {
                if (objs[i].Attributes.comment.indexOf('Auto-created by ioBroker ' + adapter.namespace) === -1) {
                    logIgnoreConfigurations && adapter.log.info('ignore FHEM device "' + objs[i].Name + '" | comment: ' + objs[i].Attributes.comment + ' | ' + ' ' + (i + 1) + '/' + objs.length);
                    continue;
                }
                if (!fhemINs[objs[i].Name] && objs[i].Attributes.room.indexOf('ioB_IN') !== -1) {
                    logIgnoreConfigurations && adapter.log.info('ignore FHEM device "' + objs[i].Name + '" | comment: ' + objs[i].Attributes.comment + ' | ' + ' ' + (i + 1) + '/' + objs.length);
                    sendFHEM('delete ' + objs[i].Name);
                    continue;
                }
                if (fhemINs[objs[i].Name] && objs[i].Attributes.room.indexOf('ioB_IN') !== -1) {
                    fhemIN[objs[i].Name] = {id: objs[i].Name};
                    continue;
                }
                if (objs[i].Name.indexOf('alive') !== -1) {
                    logIgnoreConfigurations && adapter.log.info('ignore FHEM device "' + objs[i].Name + '" | comment: ' + objs[i].Attributes.comment + ' | ' + ' ' + (i + 1) + '/' + objs.length);
                    fhemIgnore[objs[i].Name] = {id: objs[i].Name};
                    continue;
                }
            }
            if (objs[i].Attributes && objs[i].Attributes.room === 'hidden') {
                continue;
            }
            if (objs[i].Attributes && !objs[i].Attributes.room && iobroker) {
                continue;
            }
            if (objs[i].Attributes && objs[i].Attributes.room && iobroker) {
                let weiter = true;
                let searchRoom = objs[i].Attributes.room.split(',');
                for (const r in searchRoom) {
                    if (onlySyncRoom.indexOf(searchRoom[r]) !== -1 || searchRoom[r] === 'ioB_System') {
                        (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' iobroker=true > found room ' + searchRoom[r] + ' / ' + r);
                        weiter = false;
                    }
                }
                if (weiter && synchro !== true) {
                    unusedObjects(objs[i].Name.replace(/\./g, '_') + '.*', cb);
                }
                if (weiter) {
                    (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.warn(debugN + ' no sync - iobroker=true > found no room');
                    continue;
                }
            }
            let isOn = false;
            let isOff = false;
            let setStates = {};
            let alias = objs[i].Name;
            let Funktion = 'no';
            name = objs[i].Name.replace(/\./g, '_');
            id = adapter.namespace + '.' + name;
            //alias?
            if (objs[i].Attributes && objs[i].Attributes.alias) {
                alias = objs[i].Attributes.alias;
            }
            obj = {
                _id: id,
                type: 'channel',
                common: {
                    name: alias
                },
                native: objs[i]
            };
            if (objs[i].Internals.TYPE === 'HUEBridge') {
                if (!objs[i].Attributes.createGroupReadings) {
                    sendFHEM('attr ' + objs[i].Name + ' createGroupReadings 1', 'TYPE:HUEBridge');
                }
            }
            if (objs[i].Internals.TYPE === 'HUEDevice') {
                Funktion = 'light';
                if (objs[i].Internals.type) {
                    if (objs[i].Internals.type.indexOf('ZLL') !== -1 || objs[i].Internals.type === 'MotionDetector') {
                        Funktion = 'sensor';
                    }
                }
            }
            if (objs[i].Internals.TYPE === 'SONOSPLAYER') {
                Funktion = 'audio';
                obj.common.role = 'media.music';
                if (!objs[i].Attributes.generateVolumeEvent) {
                    sendFHEM('attr ' + objs[i].Name + ' generateVolumeEvent 1', 'TYPE:SONOSPLAYER');
                }
            }
            if (objs[i].Attributes.model === 'HM-CC-RT-DN') {
                Funktion = 'heating';
                obj.common.role = 'thermostate';
            }
            if (objs[i].Attributes.subType === 'thermostat') {
                Funktion = 'heating';
            }
            if (objs[i].Attributes.subType === 'smokeDetector') {
                Funktion = 'security';
            }
            if (objs[i].Attributes.subType === 'blindActuator') {
                Funktion = 'blind';
            }
            if (Funktion !== 'no' && autoFunction && objs[i].Attributes.room) {
                setFunction(id, Funktion, name);
            }
            objects.push(obj);
            logCheckObject && adapter.log.info('check channel ' + id + ' | name: ' + alias + ' | room: ' + objs[i].Attributes.room + ' | role: ' + obj.common.role + ' | function: ' + Funktion + ' | ' + ' ' + (i + 1) + '/' + objs.length);
            //Rooms
            if (objs[i].Attributes && objs[i].Attributes.room) {
                const rrr = objs[i].Attributes.room.split(',');
                for (let r = 0; r < rrr.length; r++) {
                    rrr[r] = rrr[r].trim();
                    rooms[rrr[r]] = rooms[rrr[r]] || [];
                    rooms[rrr[r]].push(adapter.namespace + '.' + name);
                }
            }
            //-----------------------------------------
            if (objs[i].Attributes) {
                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' > check Attributes');
                if (!objs[i].Attributes.alias) {
                    adapter.log.debug('check alias of ' + objs[i].Name + ' > not found! set alias automatically in FHEM');
                    sendFHEM('attr ' + objs[i].Name + ' alias ' + objs[i].Name);
                }
                for (const attr in objs[i].Attributes) {
                    // allowed Attributes?
                    if (allowedAttributes.indexOf(attr) === -1) {
                        (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.warn(debugN + ' >> ' + attr + ' = ' + objs[i].Attributes[attr] + ' > no sync - not included in ' + adapter.namespace + '.info.Config.allowedAttributes');
                        continue;
                    }
                    id = adapter.namespace + '.' + name + '.' + 'Attributes.' + attr.replace(/\./g, '_');
                    const val = objs[i].Attributes[attr];
                    obj = {
                        _id: id,
                        type: 'state',
                        common: {
                            name: objs[i].Name + ' ' + attr,
                            type: 'string',
                            role: 'text',
                            read: true,
                            write: true
                        },
                        native: {
                            Name: objs[i].Name,
                            Attribute: attr,
                            Attributes: true
                        }
                    };
                    (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Attributes[attr] + ' > ' + obj._id + ' = ' + val + ' | type: ' + obj.common.type + ' | read: ' + obj.common.read + ' | write: ' + obj.common.write + ' | role: ' + obj.common.role);
                    objects.push(obj);
                    states.push({
                        id: obj._id,
                        val: val,
                        ts: Date.now(),
                        ack: true
                    });
                }
            }
            //-----------------------------------------
            if (objs[i].Internals) {
                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' > check Internals');
                for (const attr in objs[i].Internals) {
                    // allowed Internals?
                    if (!objs[i].Internals.hasOwnProperty(attr) || allowedInternals.indexOf(attr) === -1) {
                        (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.warn(debugN + ' >> ' + attr + ' = ' + objs[i].Internals[attr] + ' > no sync - not included in ' + adapter.namespace + '.info.Config.allowedInternals');
                        continue;
                    }
                    id = adapter.namespace + '.' + name + '.' + 'Internals.' + attr.replace(/\./g, '_');
                    const val = objs[i].Internals[attr];
                    obj = {
                        _id: id,
                        type: 'state',
                        common: {
                            name: objs[i].Name + ' ' + attr,
                            type: 'string',
                            role: 'text',
                            read: true,
                            write: false
                        },
                        native: {
                            Name: objs[i].Name,
                            Attribute: attr,
                            Internals: true
                        }
                    };
                    (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Internals[attr] + ' > ' + obj._id + ' = ' + val + ' | type: ' + obj.common.type + ' | read: ' + obj.common.read + ' | role: ' + obj.common.role);
                    objects.push(obj);
                    states.push({
                        id: obj._id,
                        val: val,
                        ts: Date.now(),
                        ack: true
                    });
                }
            }
            //-----------------------------------------
            if (objs[i].PossibleSets && objs[i].PossibleSets.length > 1) {
                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' > check PossibleSets');
                const attrs = objs[i].PossibleSets.split(' ');
                for (let a = 0; a < attrs.length; a++) {
                    if (!attrs[a]) {
                        continue;
                    }
                    const parts = attrs[a].split(':');
                    Funktion = 'no';
                    let Cstates = true;
                    // ignore PossibleSets
                    if (ignorePossibleSets.indexOf(parts[0]) !== -1) {
                        (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.warn(debugN + ' >> ' + parts[0] + ' > no sync - included in ' + adapter.namespace + '.info.Config.ignorePossibleSets');
                        continue;
                    }
                    const stateName = parts[0].replace(/\./g, '_');
                    id = adapter.namespace + '.' + name + '.' + stateName;
                    //let idPS = adapter.namespace + '.' + name + '.PossibleSets.' + stateName;
                    if (parts[0] === 'off')
                        isOff = true;
                    if (parts[0] === 'on')
                        isOn = true;
                    obj = {
                        _id: id,
                        type: 'state',
                        common: {
                            name: objs[i].Name + ' ' + parts[0],
                            type: 'string',
                            role: 'state',
                            read: false,
                            write: true
                        },
                        native: {
                            Name: objs[i].Name,
                            Attribute: parts[0],
                            possibleSets: true
                        }
                    };
                    //special FS20
                    if (objs[i].Internals.TYPE === 'FS20' && !parts[1]) {
                        if (['on', 'off', 'toggle', 'dimup', 'dimdown', 'dimupdown', 'dim06%', 'dim12%', 'dim18%', 'dim25%', 'dim31%', 'dim37%', 'dim43%', 'dim50%', 'dim56%', 'dim62%', 'dim68%', 'dim75%', 'dim81%', 'dim87%', 'dim93%', 'dim100%'].indexOf(parts[0]) !== -1) {
                            obj.common.type = 'boolean';
                            obj.common.role = 'button';
                        }
                    }
                    if (parts[1]) {
                        if (parts[1].indexOf('noArg') !== -1) {
                            Cstates = false;
                            obj.common.type = 'boolean';
                            obj.common.role = 'button';
                            obj.native.noArg = true;
                            //special SONOS
                            if (parts[0] === 'Play')
                                obj.common.role = 'button.play';
                            if (parts[0] === 'Pause')
                                obj.common.role = 'button.pause';
                            if (parts[0] === 'Stop')
                                obj.common.role = 'button.stop';
                            if (parts[0] === 'Previous')
                                obj.common.role = 'button.prev';
                            if (parts[0] === 'Next')
                                obj.common.role = 'button.next';
                        }
                        if (parts[1].indexOf('slider') !== -1) {
                            Cstates = false;
                            const _slider = parts[1].split(',');
                            obj.common.type = 'number';
                            obj.common.role = 'level';
                            obj.common.min = parseInt(_slider[1]);
                            obj.common.max = parseInt(_slider[3]);
                            obj.native.slider = true;
                            //special
                            if (_slider[2] !== '1') {
                                obj.common.desc = 'limited function: slider step ' + _slider[2] + ' <> 1';
                            }
                            if (parts[0] === 'sat')
                                obj.common.role = 'level.color.saturation';
                        }
                        if (parts[1].indexOf('colorpicker') !== -1) {
                            Cstates = false;
                            obj.native.colorpicker = true;
                            const _cp = parts[1].split(',');
                            if (_cp[4]) {
                                obj.common.type = 'number';
                                obj.common.role = 'level';
                                obj.common.min = parseInt(_cp[2]);
                                obj.common.max = parseInt(_cp[4]);
                            }
                        }
                    }
                    if (temperaturePossibleSets.indexOf(parts[0]) !== -1) {
                        Cstates = false;
                        obj.common.type = 'number';
                        obj.common.role = 'level.temperature';
                        obj.common.unit = '°C';
                        obj.common.min = 5;
                        obj.common.max = 30;
                        obj.native.level_temperature = true;
                        if (adapter.namespace === 'fhem.0' && objs[i].Attributes.room) {
                            obj.common.smartName = {
                                'de': alias
                            };
                        }
                    }
                    if (dimPossibleSets.indexOf(parts[0]) !== -1) {
                        Cstates = false;
                        obj.common.role = 'level.dimmer';
                        obj.common.unit = '%';
                        obj.native.level_dimmer = true;
                        if (objs[i].Attributes.subType === 'blindActuator') {
                            obj.common.role = 'level.blind';
                            obj.native.level_blind = true;
                        }
                        if (adapter.namespace === 'fhem.0' && objs[i].Attributes.room) {
                            obj.common.smartName = {
                                'de': alias
                            };
                        }
                    }
                    if (volumePossibleSets.indexOf(parts[0]) !== -1) {
                        Cstates = false;
                        obj.common.role = 'level.volume';
                        obj.common.unit = '%';
                        obj.native.volume = true;
                        if (parts[0].indexOf('Group') !== -1) {
                            obj.common.role = 'level.volume.group';
                        }
                        if (adapter.namespace === 'fhem.0' && objs[i].Attributes.room) {
                            obj.common.smartName = {
                                'de': alias
                            };
                        }
                    }
                    if (rgbPossibleSets.indexOf(parts[0]) !== -1) {
                        Cstates = false;
                        obj.common.role = 'level.color.rgb';
                        obj.native.rgb = true;
                        if (adapter.namespace === 'fhem.0' && objs[i].Attributes.room) {
                            obj.common.smartName = {
                                'de': alias
                            };
                        }
                    }
                    if (parts[0] === 'color') {
                        Cstates = false;
                        obj.common.role = 'level.color.temperature';
                        obj.common.unit = 'K';
                        obj.native.ct = true;
                        if (adapter.namespace === 'fhem.0' && objs[i].Attributes.room) {
                            obj.common.smartName = {
                                'de': alias
                            };
                        }
                    }
                    if (parts[1] && Cstates) {
                        obj.native.states = true;
                        const ssss = parts[1].split(',');
                        obj.common.states = new Object();
                        for (let m = 0; m < ssss.length; m++) {
                            obj.common.states[ssss[m]] = ssss[m];
                        }
                    }
                    if (parts[0] === 'Mute') {
                        obj.common.type = 'boolean';
                        obj.common.role = 'media.mute';
                        obj.native.bol0 = true;
                    }
                    if (parts[0] === 'Repeat') {
                        obj.common.type = 'number';
                        obj.common.role = 'media.mode.repeat';
                    }
                    if (parts[0] === 'Shuffle') {
                        obj.common.type = 'boolean';
                        obj.common.role = 'media.mode.shuffle';
                        obj.native.bol0 = true;
                    }

                    if (parts[0].indexOf('RGB') !== -1) {
                        obj.common.role = 'light.color.rgb';
                        obj.native.rgb = true;
                    }
                    if (parts[0].indexOf('HSV') !== -1) {
                        obj.common.role = 'light.color.hsv';
                        obj.native.hsv = true;
                    }
                    (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + parts[0] + ' = ' + parts[1] + ' > ' + id + ' | type: ' + obj.common.type + ' | write: ' + obj.common.write + ' | role: ' + obj.common.role + ' | min: ' + obj.common.min + ' | max: ' + obj.common.max + ' | unit: ' + obj.common.unit + ' | states: ' + JSON.stringify(obj.common.states));
                    objects.push(obj);
                    states.push({
                        id: obj._id,
                        val: '.',
                        ts: Date.now(),
                        ack: true
                    });
                    setStates[stateName] = obj;
                    //Function?
                    if (Funktion !== 'no' && autoFunction && objs[i].Attributes.room) {
                        setFunction(id, Funktion, name);
                    }
                }
            }
            //-----------------------------------------
            if (objs[i].Readings) {
                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' > check Readings');
                for (const attr in objs[i].Readings) {
                    if (!objs[i].Readings.hasOwnProperty(attr)) {
                        continue;
                    }
                    // ignore Readings ?
                    if (ignoreReadings.indexOf(attr) !== -1) {
                        (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.warn(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value + ' > no sync - included in ' + adapter.namespace + '.info.Config.ignoreReadings');
                        continue;
                    }
                    const stateName = attr.replace(/\./g, '_');
                    id = adapter.namespace + '.' + name + '.' + stateName;
                    // PossibleSets?
                    let combined = false;
                    if (setStates[stateName]) {
                        combined = true;
                        obj = setStates[stateName];
                        obj.common.read = true;
                        obj.native.Readings = true;
                    } else {
                        obj = {
                            _id: id,
                            type: 'state',
                            common: {
                                name: objs[i].Name + ' ' + attr,
                                //type: 'string',      19.04.09
                                type: undefined,
                                role: undefined,
                                read: true,
                                write: false,
                                unit: getUnit(attr, objs[i].Internals.TYPE)
                            },
                            native: {
                                Name: objs[i].Name,
                                Attribute: attr,
                                Readings: true
                            }
                        };
                    }
                    if (objs[i].Readings[attr]) {
                        Funktion = 'no';
                        let val = objs[i].Readings[attr].Value;
                        let valOrg = val;
                        if (oldState && attr === 'state') {
                            val = convertFhemValue(val);
                        }
                        if (attr !== 'state') {
                            val = convertAttr(attr, val);
                        }
                        obj.common.type = obj.common.type || typeof val;
                        if (obj.common.type === 'number') {
                            obj.common.role = obj.common.role || 'value';
                        } else {
                            obj.common.role = obj.common.role || 'text';
                        }
                        // detect indicator
                        if (Rindicator.indexOf(attr) !== -1) {
                            obj.native.indicator = true;
                            obj.common.type = 'boolean';
                            obj.common.role = 'indicator.' + attr.toLowerCase();
                            if (objs[i].Internals.TYPE === 'HUEDevice' && attr === 'reachable')
                                obj.common.role = 'indicator.unreach';
                            if (objs[i].Internals.TYPE === 'SONOSPLAYER' && attr === 'presence')
                                obj.common.role = 'indicator.reachable';
                            if (objs[i].Internals.TYPE === 'CUL_HM' && attr === 'Activity')
                                obj.common.role = 'indicator.unreach';
                            if (objs[i].Internals.TYPE === 'FBDECT' && attr === 'present')
                                obj.common.role = 'indicator.unreach';
                            if (attr === 'battery')
                                obj.common.role = 'indicator.lowbat';
                        }
                        // detect temperature
                        if (obj.common.unit === '°C' && !combined) {
                            obj.native.temperature = true;
                            Funktion = 'temperature';
                            obj.common.type = 'number';
                            obj.common.role = 'value.temperature';
                        }
                        // detect Wh (energy)
                        if (obj.common.unit === 'Wh') {
                            obj.native.Wh = true;
                            obj.common.role = 'value.power.consumption';
                        }
                        // detect V (voltage)
                        if (obj.common.unit === 'V') {
                            obj.native.V = true;
                            obj.common.role = 'value.voltage';
                        }
                        // special role
                        if (attr === 'infoSummarize1') {
                            obj.common.role = 'media.title';
                        }
                        if (attr === 'currentAlbumArtURL') {
                            obj.common.role = 'media.cover';
                        }
                        // detect state
                        if (attr === 'state') {
                            obj.common.write = true;
                            obj.common.role = 'state';
                            // detect on/off (create state_switch)
                            if (isOff && isOn || objs[i].Internals.TYPE === 'dummy' && (val === 'on' || val === 'off')) {
                                obj.common.type = 'string';
                                obj.native.onoff = true;
                                Funktion = 'switch';
                                let obj_switch = {
                                    _id: adapter.namespace + '.' + name + '.state_switch',
                                    type: 'state',
                                    common: {
                                        name: objs[i].Name + ' ' + 'state_switch',
                                        type: 'boolean',
                                        role: 'switch',
                                        read: true,
                                        write: true
                                    },
                                    native: {
                                        Name: objs[i].Name,
                                        Attribute: 'state'
                                    }
                                };
                                //Schaltaktor aus FHEM in Cloud-Adapter hinzufügen                            
                                if (adapter.namespace === 'fhem.0' && objs[i].Attributes.room) {
                                    obj_switch.common.smartName = {
                                        'de': alias
                                    };
                                }
                                if (objs[i].Internals.TYPE === 'HUEDevice' && objs[i].Attributes.subType !== 'switch') {
                                    obj_switch.common.role = 'switch.light';
                                }
                                let valSwitch = val;
                                if (!oldState) {
                                    valSwitch = convertFhemValue(val);
                                }
                                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value + ' > ' + obj_switch._id + ' = ' + valSwitch + ' | type: ' + obj_switch.common.type + ' | read: ' + obj_switch.common.read + ' | write: ' + obj_switch.common.write + ' | role: ' + obj_switch.common.role + ' | Funktion: ' + Funktion);
                                objects.push(obj_switch);
                                states.push({
                                    id: obj_switch._id,
                                    val: valSwitch,
                                    ts: objs[i].Readings[attr].Time ? new Date(objs[i].Readings[attr].Time).getTime() : Date.now(),
                                    ack: true
                                });
                            }
                            // (create state_boolean)
                            if (typeof (convertFhemStateBoolean(valOrg)) === "boolean" && 'sonos myBroker HM_CFG_USB2 FB_Callmonitor'.indexOf(name) === -1) {
                                obj.native.StateBoolean = true;
                                let SBrole = 'bol';
                                if (valOrg === 'present' || valOrg === 'absent')
                                    SBrole = 'indicator.presence';
                                if (valOrg === 'open' || valOrg === 'close' || valOrg === 'opened' || valOrg === 'closed') {
                                    SBrole = 'sensor';
                                    Funktion = 'sensor';
                                    if (alias.toLowerCase().indexOf('tür') !== -1 || alias.toLowerCase().indexOf('tuer') !== -1 || alias.toLowerCase().indexOf('door') !== -1)
                                        SBrole = 'sensor.door';
                                    if (alias.toLowerCase().indexOf('fenster') !== -1 || alias.toLowerCase().indexOf('window') !== -1)
                                        SBrole = 'sensor.window';
                                    if (SBrole === 'sensor')
                                        adapter.log.warn('for full function of sensor "' + name + '" use door,window,Tür,Fenster in alias of device');
                                }
                                if (valOrg === 'motion' || valOrg === 'nomotion') {
                                    SBrole = 'sensor.motion';
                                    Funktion = 'sensor';
                                }
                                let obj_sensor = {
                                    _id: adapter.namespace + '.' + name + '.state_boolean',
                                    type: 'state',
                                    common: {
                                        name: objs[i].Name + ' ' + 'state_boolean',
                                        type: 'boolean',
                                        role: SBrole,
                                        read: true,
                                        write: false
                                    },
                                    native: {
                                        Name: objs[i].Name,
                                        Attribute: 'state_boolean'
                                    }
                                };
                                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value + ' > ' + obj_sensor._id + ' = ' + convertFhemStateBoolean(valOrg) + ' | type: ' + obj_sensor.common.type + ' | read: ' + obj_sensor.common.read + ' | write: ' + obj_sensor.common.write + ' | role: ' + obj_sensor.common.role + ' | Funktion: ' + Funktion);
                                objects.push(obj_sensor);
                                states.push({
                                    id: obj_sensor._id,
                                    val: convertFhemStateBoolean(valOrg),
                                    ts: Date.now(),
                                    ack: true
                                });
                            }
                            // (create state_value)
                            if (typeof (convertFhemStateValue(val)) === "number") {
                                obj.native.StateValue = true;
                                let obj_sensor = {
                                    _id: adapter.namespace + '.' + name + '.state_value',
                                    type: 'state',
                                    common: {
                                        name: objs[i].Name + ' ' + 'state_value',
                                        type: 'number',
                                        role: 'value',
                                        read: true,
                                        write: false
                                    },
                                    native: {
                                        Name: objs[i].Name,
                                        Attribute: 'state_value'
                                    }
                                };
                                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value + ' > ' + obj_sensor._id + ' = ' + convertFhemStateValue(val) + ' | type: ' + obj_sensor.common.type + ' | read: ' + obj_sensor.common.read + ' | write: ' + obj_sensor.common.write + ' | role: ' + obj_sensor.common.role + ' | Funktion: ' + Funktion);
                                objects.push(obj_sensor);
                                states.push({
                                    id: obj_sensor._id,
                                    val: convertFhemStateValue(val),
                                    ts: Date.now(),
                                    ack: true
                                });
                            }
                            // detect SONOS state (create media.state)
                            if (objs[i].Internals.TYPE === 'SONOSPLAYER') {
                                obj.native.media = true;
                                let valMedia = false;
                                if (val === 'PLAYING') {
                                    valMedia = true;
                                }
                                let obj_media = {
                                    _id: adapter.namespace + '.' + name + '.state_media',
                                    type: 'state',
                                    common: {
                                        name: objs[i].Name + ' ' + 'state_media',
                                        type: 'boolean',
                                        role: 'media.state',
                                        read: true,
                                        write: false
                                    },
                                    native: {
                                        Name: objs[i].Name,
                                        Attribute: 'state_media'
                                    }
                                };
                                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value + ' > ' + obj_media._id + ' = ' + valMedia + ' | type: ' + obj_media.common.type + ' | read: ' + obj_media.common.read + ' | write: ' + obj_media.common.write + ' | role: ' + obj_media.common.role + ' | Funktion: ' + Funktion);
                                objects.push(obj_media);
                                states.push({
                                    id: obj_media._id,
                                    val: valMedia,
                                    ts: objs[i].Readings[attr].Time ? new Date(objs[i].Readings[attr].Time).getTime() : Date.now(),
                                    ack: true
                                });
                            }
                        }
                        // detect readingList                             //19.04.19
                        if (objs[i].Attributes.readingList && objs[i].Attributes.readingList.indexOf(attr) !== -1) {
                            adapter.log.debug('[parseObjects] detect readingList - ' + objs[i].Internals.TYPE + ' ' + name + ' ' + attr + ' ' + val);
                            obj.common.write = true;
                            obj.common.role = 'state';
                        }
                        // special, because error on auto detect
                        if (objs[i].Internals.TYPE === 'LGTV_IP12' && attr === 'power') {
                            obj.common.type = 'string';
                            obj.common.role = 'text';
                            delete obj.common.unit;
                            val = valOrg;
                        }
                        states.push({
                            id: obj._id,
                            val: val,
                            ts: objs[i].Readings[attr].Time ? new Date(objs[i].Readings[attr].Time).getTime() : Date.now(),
                            ack: true
                        });
                        combined && (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value.replace(/\n|\r/g, '\u005cn') + ' > ' + obj._id + ' = ' + val.toString().replace(/\n|\r/g, '\u005cn') + ' | read: ' + obj.common.read + ' | write: ' + obj.common.write + ' (Value Possible Set)');
                        !combined && (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value.replace(/\n|\r/g, '\u005cn') + ' > ' + obj._id + ' = ' + val.toString().replace(/\n|\r/g, '\u005cn') + ' | type: ' + obj.common.type + ' | read: ' + obj.common.read + ' | write: ' + obj.common.write + ' | role: ' + obj.common.role + ' | Funktion: ' + Funktion);
                        objects.push(obj);
                        if (Funktion !== 'no' && autoFunction && objs[i].Attributes.room) {
                            if (Funktion === 'switch')
                                id = adapter.namespace + '.' + name;
                            if (Funktion === 'switch' && objs[i].Internals.TYPE === 'HUEDevice')
                                id = adapter.namespace + '.' + name + '.state_switch';
                            setFunction(id, Funktion, name);
                        }

                    }
                }
                delete objs[i].Readings;
            }
            setStates = null;
        } catch (err) {
            adapter.log.error('[parseObjects] Cannot process object: ' + JSON.stringify(objs[i]));
            adapter.log.error('[parseObjects] Cannot process object: ' + err);
        }
        (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' check FHEM Device finished!!!');
    }
    let channel = 0;
    let state = 0;
    for (let i = 0; i < objects.length; i++) {
        if (objects[i].type === 'channel') {
            channel = channel + 1;
        }
        if (objects[i].type === 'state') {
            state = state + 1;
        }
    }
    if (firstRun) {
        adapter.setState('info.Info.numberObjectsIOBout', Object.keys(fhemINs).length, true);
        adapter.log.info('> ' + Object.keys(fhemINs).length + ' objects to send FHEM detected (ioBout)');
        adapter.setState('info.Info.numberDevicesFHEMsync', channel, true);
        adapter.log.info('> check channel - ' + channel + ' Device(s) of FHEM synchronized');
        adapter.log.info('STEP 08 ===== Synchro objects,rooms,functions,states');
        adapter.log.info('> check ' + objects.length + ' object(s) update/create - ' + channel + ' channel(s) with ' + state + ' state(s) / ' + states.length + ' state(s) to sync: ');
        if (state !== states.length) {
            adapter.log.warn('object state(s) <> state(s) to sync');
        }
    }
    syncObjects(objects, () => {
        firstRun && adapter.log.info('> check ' + Object.keys(rooms).length + ' room(s) update/create');
        syncRooms(rooms, () => {
            firstRun && adapter.log.info('> check ' + Object.keys(functions).length + ' function(s) update/create');
            syncFunctions(functions, () => {
                firstRun && adapter.log.info('> check ' + states.length + ' state(s) update/create');
                syncStates(states, () => {
                    debug = false;
                    cb();
                });
            });
        });
    });
}
function setFunction(id, Funktion, name) {
    let fff = Funktion.split(',');
    for (let f = 0; f < fff.length; f++) {
        fff[f] = fff[f].trim();
        functions[fff[f]] = functions[fff[f]] || [];
        functions[fff[f]].push(id);
    }
}
function sendFHEM(cmd, detect) {
    adapter.log.debug('[sendFHEM] cmd=' + cmd + ' / detecct=' + detect);
    if (autoConfigFHEM || !detect) {                                                  //16.02.19
        queue.push({
            command: 'write',
            id: adapter.namespace + '.info.Commands.sendFHEM',
            val: cmd
        });
        processQueue();
        if (detect)
            adapter.log.info('detect ' + detect + ' and "' + adapter.namespace + '.info.Configurations.autoConfigFHEM" = true  > ' + cmd + ' | more info README.md');
    } else if (detect) {
        adapter.log.warn('detect ' + detect + ': missing "' + cmd + '" > set manually in FHEM or automatically "' + adapter.namespace + '.info.Configurations.autoConfigFhem" = true | more info README.md');
    }
}
function convertAttr(attr, val) {
    if (attr === 'rgb') {
        return '#' + val;
    }
    if (attr === 'Mute') {
        return convertBol0(val);
    }
    if (attr === 'Shuffle') {
        return convertBol0(val);
    }
    if (Rindicator.indexOf(attr) !== -1) {
        return convertValueBol(val);
    }
    if (Utemperature.indexOf(attr) !== -1) {
        return parseFloat(val);
    }
    if (attr.indexOf('power') !== -1) {
        return parseFloat(val);
    }
    if (attr.indexOf('voltage') !== -1) {
        return parseFloat(val);
    }
    if (attr.indexOf('energy') !== -1) {
        return parseFloat(val);
    }
    const f = parseFloat(val);
    if (f == val) {
        return f;
    }
    return val;
}
function convertBol0(val) {
    if (val === '0')
        return false;
    if (val === 0)
        return false;
    if (val === '1')
        return true;
    if (val === 1)
        return true;
    if (val === true)
        return '1';
    if (val === false)
        return '0';
    if (val === 'true')
        return '1';
    if (val === 'false')
        return '0';
    const f = parseFloat(val);
    if (f === val)
        return f;
    return val;
}
function convertValueBol(val) {
    if (val === '0')
        return true;
    if (val === 0)
        return true;
    if (val === '1')
        return false;
    if (val === 1)
        return false;
    if (val === 'appeared')
        return true;
    if (val === 'disappeared')
        return false;
    if (val === '~~NotLoadedMarker~~')
        return false;
    if (val === 'present')
        return true;
    if (val === 'absent')
        return false;
    if (val === 'low')
        return true;
    if (val === 'ok')
        return false;
    if (val === 'alive')
        return false;
    if (val === 'dead')
        return true;
    if (val === 'yes')
        return false;
    if (val === 'no')
        return true;
    const f = parseFloat(val);
    if (f === val)
        return f;
    return val;
}
function convertFhemValue(val) {
    if (val === 'true')
        return true;
    if (val === 'false')
        return false;
    if (val === 'on')
        return true;
    if (val === 'off')
        return false;
    if (val === 'unreachable')
        return false;
    if (val.indexOf('dim') !== -1)
        return true;
    return val;
}
function convertFhemStateBoolean(val) {
    if (val === 'open' || val === 'opened')
        return true;
    if (val === 'close' || val === 'closed')
        return false;
    if (val === 'present')
        return true;
    if (val === 'absent')
        return false;
    if (val === 'motion')
        return true;
    if (val === 'nomotion')
        return false;
    return val;
}
function convertFhemStateValue(val) {
    if (val === 'open' || val === 'opened')
        return 2;
    if (val === 'close' || val === 'closed')
        return 0;
    if (val === 'present')
        return 2;
    if (val === 'absent')
        return 0;
    return val;
}
/*
 function readValue(id, cb) {
 telnetOut.send('get ' + fhemObjects[id].native.Name + ' ' + fhemObjects[id].native.Attribute, (err, result) => {
 err && adapter.log.error('readValue: ' + err);
 if (result) {
 result = convertFhemValue(result.substring(fhemObjects[id].native.Name.length + fhemObjects[id].native.Attribute + 5));
 if (result !== '') {
 adapter.setForeignState(id, result, true);
 adapter.log.info('readValue: ' + id + result);
 }
 }
 cb && cb();
 });
 }
 */
function writeValue(id, val, cb) {
    adapter.log.debug('[writeValue] ' + id + ' ' + val);
    let cmd;
    let parts;
    if (val === undefined || val === null)
        val = '';
    parts = id.split('.');
    // switch?
    if (id.indexOf('state_switch') !== -1) {
        if (val === '1' || val === 1 || val === 'on' || val === 'true' || val === true)
            val = 'on';
        if (val === '0' || val === 0 || val === 'off' || val === 'false' || val === false)
            val = 'off';
        cmd = 'set ' + fhemObjects[id].native.Name + ' ' + val;
        logEventIOB && adapter.log.info('event ioBroker "' + id + ' ' + val + '" > ' + cmd);
        telnetOut.send(cmd, (err, result) => {
            err && adapter.log.error('[writeValue] ' + err);
            cb && cb();
        });
        return;
    }
    // change Debug?
    if (id.indexOf(adapter.namespace + '.info.Debug.') !== -1) {
        adapter.log.debug('[writeValue] detect info.Debug = ' + id);
        if (id.indexOf('jsonlist2') !== -1) {
            adapter.log.info('start debug jsonlist2 ' + val);
            let objects = null;
            try {
                objects = JSON.parse(val);
            } catch (e) {
                adapter.log.error('[writeValue] Cannot parse answer for ' + adapter.namespace + '.info.Debug.jsonlist2 ' + e);
            }
            if (objects) {
                debug = true;
                parseObjects(objects.Results, cb);
            }
        }
        if (id.indexOf('meta') !== -1) {
            adapter.log.info('start debug meta "jsonlist2 ' + val + '"');
            debug = true;
            queue.push({
                command: 'meta',
                name: val
            });
            processQueue();
        }
        if (id.indexOf('activate') !== -1) {
            getDebug(cb);
            cb && cb();
        }
        return;
    }
    // change Settings?
    if (id.indexOf(adapter.namespace + '.info.Settings.') !== -1) {
        getSettings(cb);
        cb && cb();
        return;
    }
    // change Configurations?
    if (id.indexOf(adapter.namespace + '.info.Configurations.') !== -1) {
        adapter.log.debug('Configurations changed >>> Start Resync FHEM ');
        getConfigurations(cb);
        queue.push({
            command: 'resync'
        });
        processQueue();
        cb && cb();
        return;
    }
    // info.Commands?
    if (id.indexOf(adapter.namespace + '.info.Commands') !== -1) {
        // sendFHEM?
        if (id === adapter.namespace + '.info.Commands.sendFHEM') {
            logEventIOB && adapter.log.info('event ioBroker "' + id + ' ' + val + '" > ' + val);
            telnetOut.send(val, (err, result) => {
                err && adapter.log.error('[writeValue] ' + err);
                adapter.setState('info.Commands.resultFHEM', result.replace(/(\r\n)|(\r)|(\n)/g, '<br>'), err =>
                    err && adapter.log.error('[writeValue] ' + err));
                adapter.setState('info.Commands.lastCommand', cmd, err => err && adapter.log.error('[writeValue] ' + err));
                cb && cb();
            });
        }
        // createSwitch?   19.04.19
        if (id === adapter.namespace + '.info.Commands.createSwitch') {
            let valP = val.split(' ');
            if (valP[0] && valP[1]) {
                logEventIOB && adapter.log.info('event ioBroker "' + id + ' ' + val + '" > sendFHEM');
                sendFHEM('define ' + valP[0] + ' dummy');
                //sendFHEM('attr ' + valP[0] + ' alias ' + valP[0]);
                sendFHEM('attr ' + valP[0] + ' room ' + valP[1]);
                sendFHEM('attr ' + valP[0] + ' comment Created by ioBroker ' + adapter.namespace);
                sendFHEM('attr ' + valP[0] + ' setList on:noArg off:noArg');
                sendFHEM('set ' + valP[0] + ' off');
                cb && cb();
            } else {
                adapter.log.warn('event ioBroker "' + id + ' ' + val + '" > wrong definition - use NAME room');
                cb && cb();
            }
        }
        cb && cb();
        return;
    }
    // attr?
    if (allowedAttributes.indexOf(parts[4]) !== -1) {
        cmd = 'attr ' + fhemObjects[id].native.Name + ' ' + parts[4] + ' ' + val;
        logEventIOB && adapter.log.info('event ioBroker "' + id + ' ' + val + '" > ' + cmd);
        telnetOut.send(cmd, (err, result) => {
            err && adapter.log.error('[writeValue] ' + err);
            cb && cb();
        });
        return;
    }
    // rgb?
    if (fhemObjects[id].native.Attribute === 'rgb') {
        val = val.substring(1);
    }
    // bol0?
    if (fhemObjects[id].native.bol0) {
        //convertBol0(val);
        if (val === '1' || val === 1 || val === 'on' || val === 'true' || val === true) {
            val = '1';
        }
        if (val === '0' || val === 0 || val === 'off' || val === 'false' || val === false) {
            val = '0';
        }
    }
    // state?
    if (fhemObjects[id].native.Attribute === 'state') {
        if (val === '1' || val === 1 || val === 'on' || val === 'true' || val === true) {
            val = 'on';
        }
        if (val === '0' || val === 0 || val === 'off' || val === 'false' || val === false) {
            val = 'off';
        }
        cmd = 'set ' + fhemObjects[id].native.Name + ' ' + val;
    } else {
        cmd = 'set ' + fhemObjects[id].native.Name + ' ' + fhemObjects[id].native.Attribute + ' ' + val;
        // button?
        if (fhemObjects[id].common.role.indexOf('button') !== -1) {
            cmd = 'set ' + fhemObjects[id].native.Name + ' ' + fhemObjects[id].native.Attribute;
        }
    }
    logEventIOB && adapter.log.info('event ioBroker "' + id + ' ' + val + '" > ' + cmd);
    telnetOut.send(cmd, (err, result) => {
        err && adapter.log.error('[writeValue] ' + err);
        cb && cb();
    });
}
function requestMeta(name, attr, value, event, cb) {
    //Debug Mode einfügen
    adapter.log.debug('check channel ' + name + ' > jsonlist2 ' + name);
    // send command JsonList2
    telnetOut.send('jsonlist2 ' + name, (err, result) => {
        err && adapter.log.error('[requestMeta] ' + err);
        if (result) {
            let objects = null;
            try {
                objects = JSON.parse(result);
                adapter.log.debug('[requestMeta] ' + name + ' - Number of Device(s) ' + objects.totalResultsReturned);
            } catch (e) {
                adapter.log.error('[requestMeta] Cannot parse answer for jsonlist2: ' + e);
            }
            if (objects.totalResultsReturned > 0) {
                parseObjects(objects.Results, () => {
                    if (cb) {
                        cb();
                        cb = null;
                    }
                });
            } else {
                adapter.log.warn('[' + name + '] no sync - no result of "jsonlist2 ' + name + '"');
                if (cb) {
                    cb();
                    cb = null;
                }
            }
        } else if (cb) {
            cb();
            cb = null;
        }
    });
}
function deleteChannel(name, cb) {
    adapter.log.debug('[deleteChannel] ' + name);
    delete fhemObjects[adapter.namespace + '.' + name];
    adapter.deleteChannel(name, err => {
        if (err && err !== 'Not exists') {
            adapter.log.error('[deleteChannel] ' + name + ' ' + err);
        }
        cb && cb();
    });
}
function deleteObject(name, cb) {
    adapter.log.debug('[deleteObject] ' + name);
    let parts = name.split('.');
    debugNAME.indexOf(parts[2]) !== -1 && adapter.log.info('[' + parts[2] + '] delete state "' + name + '"');
    adapter.delObject(name, err => {
        if (err && err !== 'Not exists') {
            adapter.log.error('[deleteObject] ' + name + ' ' + err);
        }
        adapter.setState('info.Info.numberObjectsIOBin', Object.keys(fhemObjects).length, true);
        cb && cb();
    });
}
function deleteState(name, cb) {
    adapter.log.debug('[deleteState] ' + name);
    adapter.delState(name, err => {
        if (err && err !== 'Not exists') {
            adapter.log.error('[deleteState] ' + name + ' ' + err);
        }
        cb && cb();
    });
}
function unusedObjects(check, cb) {
    adapter.log.debug('[unusedObjects] start ' + check);
    firstRun && adapter.log.info('STEP 09 ===== check delete unused objects');
    if (!deleteUnusedObjects) {
        adapter.log.info('> delete unused objects (' + check + ') > no automatically delete - info.Configurations.deleteUnusedObjecs not true!');
        cb && cb();
        return;
    }
    adapter.getStates(check, (err, states) => {
        if (err) {
            adapter.log.error('[unusedObjects] ' + err);
        } else {
            for (const id in states) {
                if (!states.hasOwnProperty(id)) {
                    continue;
                }
                const channelS = id.split('.');
                if (channelS[2] === 'info') {
                    continue;
                }
                // readingsGroup?
                if (channelS[3] === 'readingsGroup') {
                    debugNAME.indexOf(channelS[2]) !== -1 && adapter.log.info('[' + channelS[2] + '] detect "' + id + '" - readingsGroup > no delete');
                    continue;
                }

                if (check !== '*')
                    delete fhemObjects[id];
                if (!fhemObjects[id]) {
                    if (channelS[3] === 'Internals' && channelS[4] === 'TYPE') {
                        queueL.push({
                            command: 'delChannel',
                            name: channelS[2]
                        });
                    }
                    queueL.push({
                        command: 'delObject',
                        name: id
                    });
                    queueL.push({
                        command: 'delState',
                        name: id
                    });
                }
            }
        }
        let channel = 0;
        let state = 0;
        for (let i = 0; i < queueL.length; i++) {
            if (queueL[i].command === 'delChannel') {
                channel = channel + 1;
            }
            if (queueL[i].command === 'delState') {
                state = state + 1;
            }
        }
        firstRun && adapter.log.info('> delete unused objects (' + check + ') > delete ' + channel + ' channel(s) and ' + state + ' state(s)');
        processQueueL();
        adapter.log.debug('[unusedObjects] end');
        cb && cb();
    });
}
function resyncFHEM() {
    adapter.log.info('Start Resync FHEM');
    resync = false;
    synchro = true;
    firstRun = true;
    fhemIN = {};
    fhemINs = {};
    adapter.setState('info.resync', false, true);
    startSync();
}
function processQueue() {
    if (telnetOut.isCommandRunning() || !queue.length) {
        return;
    }
    const command = queue.shift();
    if (command.command === 'resync') {
        resync = true;
        adapter.log.debug('[processQueue] detected Resync FHEM');
        setTimeout(resyncFHEM, 5000);
    } else if (command.command === 'read') {
        readValue(command.id, () => setImmediate(processQueue));
    } else if (command.command === 'write') {
        adapter.log.debug('[processQueue] ' + command.id + ' ' + command.val);
        writeValue(command.id, command.val, () => setImmediate(processQueue));
    } else if (command.command === 'meta') {
        requestMeta(command.name, command.attr, command.val, command.event, () => setImmediate(processQueue));
    } else {
        adapter.log.error('[processQueue] Unknown task: ' + command.command);
        setImmediate(processQueue);
    }
}
function processQueueL(cb) {
    if (!queueL.length) {
        adapter.log.debug('[processQueueL] ende');
        cb && cb();
        return;
    }
    const command = queueL.shift();
    adapter.log.debug('[processQueueL] ' + command.command + ' ' + command.name);
    if (command.command === 'delObject') {
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
function setAlive() {
    adapter.log.debug('[setAlive] start setAlive 360 sec');
    sendFHEM('set ' + adapter.namespace + '.alive on-for-timer 360');
    setTimeout(setAlive, 300000);
}
//end ==================================================================================================================================
function main() {
    adapter.log.debug('[main] start');
    adapter.config.host = adapter.config.host || '127.0.0.1';
    adapter.config.port = parseInt(adapter.config.port, 10) || 7072;
    adapter.config.reconnectTimeout = parseInt(adapter.config.reconnectTimeout, 10) || 30000;
    if (adapter.config.prompt === undefined) {
        adapter.config.prompt = 'fhem>';
    }
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
    telnetOut.on('ready', () => {
        adapter.log.debug('[main] telnetOut.on ready');
        if (!connected) {
            adapter.setState('info.Info.buildDate', buildDate, true);
            adapter.log.info('STEP 01 ===== buildDate ' + buildDate + ' - check objects ' + adapter.namespace);
            myObjects(() => {
                adapter.log.info('STEP 02 ===== select messages ioBroker admin LOG - check ' + adapter.namespace + '.' + 'info.Settings (true)');
                getSettings(() => {
                    adapter.log.info('STEP 03 ===== select function of Adapter (FUNCTION) and Devices to sync (SYNC) - check ' + adapter.namespace + '.' + 'info.Configurations (true or value)');
                    getConfigurations(() => {
                        adapter.log.info('STEP 04 ===== Activate Debug-Mode for channel(s) - check ' + adapter.namespace + '.' + 'info.Debug');
                        getDebug(() => {
                            adapter.log.info('STEP 05 ===== connect FHEM and send jsonlist2');
                            startSync(() => {
                            });
                        });
                    });
                });
            });
        }
    });
    telnetOut.on('end', () => {
        adapter.log.debug('[main] telnetOut.on end');
        if (connected) {
            adapter.log.debug('Disconnected');
            connected = false;
            adapter.setState('info.connection', false, true);
            adapter.log.warn('Disconnected FHEM telnet ' + adapter.config.host + ':' + adapter.config.port + ' > Auto Restart Adapter!');
            setTimeout(function () {
                adapter.restart();
            }, 1000);
        }
    });
    telnetOut.on('close', () => {
        adapter.log.debug('[main] telnetOut.on close');
        if (connected) {
            adapter.log.debug('Disconnected');
            connected = false;
            adapter.setState('info.connection', false, true);
        }
    });
}
