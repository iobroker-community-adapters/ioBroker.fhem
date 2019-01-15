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
let fhemIN = {};
let fhemINs = {};
const fhemObjects = {};
const functions = {};
let lastNameQueue;
let lastNameTS = '0';
let iobroker = false;
let firstRun = true;
let synchro = true;
let resync = false;
let debug = false;
const buildDate = '15.01.19';
//Debug
let debugNAME = [];
//Configuratios
let autoRole = false;
let autoFunction = false;
let autoConfigFHEM = false;
let autoSmartName = true;
let oldState = false;
let deleteUnusedObjects = true;
let onlySyncNAME;
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
            queue.push({
                command: 'write',
                id: adapter.namespace + '.info.Commands.sendFHEM',
                val: 'define ' + idFHEM + ' dummy'
            });
            processQueue();
            queue.push({
                command: 'write',
                id: adapter.namespace + '.info.Commands.sendFHEM',
                val: 'attr ' + idFHEM + ' room ioB_IN;attr ' + idFHEM + ' comment Auto-created by ioBroker;set ' + idFHEM + ' ' + state.val
            });
            processQueue();
            fhemIN[idFHEM] = {id: idFHEM};
            adapter.setState('info.Info.numberObjectsIOBout', Object.keys(fhemIN).length, true);
        } else {
            queue.push({
                command: 'write',
                id: adapter.namespace + '.info.Commands.sendFHEM',
                val: 'set ' + idFHEM + ' ' + state.val
            });
            processQueue();
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
        } else if (fhemObjects[id] || id === adapter.namespace + '.info.Commands.sendFHEM' || id.indexOf(adapter.namespace + '.info.Debug') !== -1 || id.indexOf(adapter.namespace + '.info.Settings') !== -1 || id.indexOf(adapter.namespace + '.info.Configurations') !== -1) {
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
function checkID(event, val, name, attr, id) {
    for (const f in fhemObjects) {
        if (fhemObjects.hasOwnProperty(f) && fhemObjects[f].native.Name === name && fhemObjects[f].native.Attribute === attr) {
            adapter.log.debug('[checkID] (FHEM) ' + event + ' > (ioBroker) ' + fhemObjects[f]._id + ' ' + val);
            id = fhemObjects[f]._id;
        }
    }
    return id;
}
function parseEvent(event, anz) {

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
        // event only parts[0] ?
        if (!parts[1]) {
            return;
        }
        // ignore ioB.IN
        if (fhemIN[parts[1].replace(/-/g, '_')]) {
            return;
        }
        // ignore Reading?
        if (parts[2] && parts[2].substr(parts[2].length - 1) === ':' && ignoreReadings.indexOf(parts[2].substr(0, parts[2].length - 1)) !== -1) {
            return;
        }

        // No cannel for event and not global?
        if (!fhemObjects[adapter.namespace + '.' + parts[1].replace(/\./g, '_')] && parts[1] !== 'global') {
            return;
        }
        // Global global ?
        if (parts[0] === 'Global' && parts[1] === 'global') {
            debugNAME.indexOf(parts[3]) !== -1 && adapter.log.info('[' + parts[3] + '] event FHEM(g) "' + event + '"');
            if (parts[2] === 'SAVE' || parts[2] === 'UPDATE') {
                logUnhandledEventFHEM && adapter.log.info('unhandled event FHEM(g) "' + event);
                return;
            }
            if (parts[2] === 'ATTR' && parts[4] === 'model') {
                logUnhandledEventFHEM && adapter.log.info('unhandled event FHEM(g) "' + event);
                return;
            }
            if (!parts[3]) {
                logUnhandledEventFHEM && adapter.log.warn('unhandled event FHEM(g) "' + event);
                return;
            }
            // ignore ioB.IN
            if (parts[3] && fhemIN[parts[3].replace(/-/g, '_')]) {
                logUnhandledEventFHEM && adapter.log.info('unhandled event FHEM(g) "' + event);
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
            logUnhandledEventFHEM && adapter.log.warn('unhandled event FHEM(g) "' + event + '" > jsonlist2');
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
        debugNAME.indexOf(parts[1]) !== -1 && adapter.log.info('[' + parts[1] + '] event FHEM "' + event + '"');
        if (pos === -1 || stelle.indexOf(':') !== 0) {
            if (oldState) {
                val = convertFhemValue(event.substring(parts[0].length + parts[1].length + 2));
            } else {
                val = event.substring(parts[0].length + parts[1].length + 2);
            }
            //send ioB ?
            if (parts[1] === 'send2ioB') {
                adapter.getForeignObject(parts[2], function (err, obj) {
                    if (err) {
                        adapter.log.error('error:' + err);
                    } else if (!obj) {
                        adapter.log.warn('event FHEM "' + event + '" > object "' + parts[2] + '" not found!');
                    } else if (obj && !obj.common.write) {
                        adapter.log.warn('event FHEM "' + event + '" > object "' + parts[2] + '" common.write not true');
                    } else if (obj && obj.common.write) {
                        let setState = event.substr(parts[0].length + parts[1].length + parts[2].length + 2);
                        adapter.log.info('event FHEM "' + event + '" > ' + parts[2] + ' = ' + setState);
                        adapter.setForeignState(parts[2], setState, false);
                    }
                });
                return;
            }
            id = checkID(event, val, parts[1], 'state', id);
            if (fhemObjects[id]) {
                adapter.setForeignState(id, {
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
                adapter.log.warn('[parseEvent] no object(S): "' + event + '" > ' + id + ' = ' + val);
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
                if (state !== null && state.val.substring(0, parts[2].length) === parts[2]) {
                    val = convertFhemValue(event.substring(parts[0].length + parts[1].length + 2));
                    id = checkID(event, val, parts[1], 'state', id);
                    typ = 'state';
                    adapter.log.debug('(1) ' + event + ' typ=' + typ + ' id=' + id + ' val=' + val);
                } else {
                    name = event.substring(0, pos);
                    parts = name.split(' ');
                    val = convertFhemValue(event.substring(parts[0].length + parts[1].length + parts[2].length + 4));
                    id = checkID(event, val, parts[1], parts[2], id);
                    // rgb? insert # usw
                    val = convertAttr(parts[2], val);
                    typ = 'reading';
                    adapter.log.debug('(2) ' + event + ' typ=' + typ + ' id=' + id + ' val=' + val);
                }
                if (!fhemObjects[id]) {
                    logUnhandledEventFHEM && adapter.log.info('unhandled event FHEM "' + event + '" > jsonlist2');
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
                    adapter.setForeignState(id, {
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
    adapter.setForeignState(id, state, err => {
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
    adapter.getForeignObject(obj._id, (err, oldObj) => {
        if (err)
            adapter.log.error('[syncObjects] ' + err);
        if (!oldObj) {
            if (obj.type === 'channel') {
                adapter.log.info('Create channel ' + obj._id + ' | ' + obj.common.name);
            }
            adapter.setForeignObject(obj._id, obj, err => {
                err && adapter.log.error('[syncObjects] ' + err);
                setImmediate(syncObjects, objects, cb);
            });
        } else {
            if (JSON.stringify(obj) !== JSON.stringify(oldObj)) {
                oldObj.native = obj.native;
                oldObj.common.name = obj.common.name;
                if (autoSmartName) {
                    oldObj.common.smartName = obj.common.smartName;
                }
                if (autoRole) {
                    oldObj.common.type = obj.common.type;
                    oldObj.common.role = obj.common.role;
                    oldObj.common.min = obj.common.min;
                    oldObj.common.max = obj.common.max;
                    oldObj.common.unit = obj.common.unit;
                    oldObj.common.read = obj.common.read;
                    oldObj.common.write = obj.common.write;
                    oldObj.common.states = obj.common.states;
                    oldObj.common.desc = obj.common.desc;
                }
                if (obj.type === 'channel' && logUpdateChannel) {
                    adapter.log.info('Update channel ' + obj._id + '  (' + oldObj.common.name + ')');
                }
                adapter.setForeignObject(obj._id, oldObj, err => {
                    err && adapter.log.error('[syncObjects] ' + err);
                    setImmediate(syncObjects, objects, cb);
                });
            } else {
                setImmediate(syncObjects, objects, cb);
            }
        }
    });
}
function syncRoom(room, members, cb) {
    adapter.log.debug('[syncRoom] (' + room + ') ' + members);
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
    adapter.log.info('check objects ' + adapter.namespace + '.info');
    const newPoints = [
        // info.Commands
        {_id: adapter.namespace + '.info.Commands.lastCommand', type: 'state', common: {name: 'Last command to FHEM', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        {_id: adapter.namespace + '.info.Commands.resultFHEM', type: 'state', common: {name: 'Result of FHEM', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        {_id: adapter.namespace + '.info.Commands.sendFHEM', type: 'state', common: {name: 'Command to FHEM', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        // info.Configurations
        {_id: adapter.namespace + '.info.Configurations.autoConfigFHEM', type: 'state', common: {name: 'special configurations FHEM', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.autoFunction', type: 'state', common: {name: 'set function automatically (Adapter Material)', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.autoRole', type: 'state', common: {name: 'set role automatically (Adapter Material)', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.autoSmartName', type: 'state', common: {name: 'if fhem.0 set smartName automatically (Adapter Cloud)', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.deleteUnusedObjects', type: 'state', common: {name: 'delete unused objects automatically', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.allowedIOBin', type: 'state', common: {name: 'allowed objects to FHEM', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.ignoreObjectsInternalsTYPE', type: 'state', common: {name: 'ignore objects TYPE = ' + ignoreObjectsInternalsTYPES + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.ignoreObjectsInternalsNAME', type: 'state', common: {name: 'ignore objects NAME = ' + ignoreObjectsInternalsNAMES + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.ignoreObjectsAttributesroom', type: 'state', common: {name: 'ignore objects room = ' + ignoreObjectsAttributesroomS + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.allowedAttributes', type: 'state', common: {name: 'allowed Attributes = ' + allowedAttributesS + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.allowedInternals', type: 'state', common: {name: 'allowed Internals = ' + allowedInternalsS + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.ignoreReadings', type: 'state', common: {name: 'ignore Readings = ' + ignoreReadingsS + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.ignorePossibleSets', type: 'state', common: {name: 'ignore PossibleSets = ' + ignorePossibleSetsS + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.oldState', type: 'state', common: {name: 'old version of state with true/false', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.onlySyncRoom', type: 'state', common: {name: 'only sync devices in room = ' + onlySyncRoomS + ' + Wert', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: adapter.namespace + '.info.Configurations.onlySyncNAME', type: 'state', common: {name: 'only sync devices NAME = ', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        // info.Debug
        {_id: adapter.namespace + '.info.Debug.jsonlist2', type: 'state', common: {name: 'jsonlist2 of FHEM', type: 'string', read: true, write: true, role: 'json'}, native: {}},
        {_id: adapter.namespace + '.info.Debug.meta', type: 'state', common: {name: 'Device NAME of FHEM', type: 'string', read: true, write: true, role: 'text'}, native: {}},
        {_id: adapter.namespace + '.info.Debug.activate', type: 'state', common: {name: 'Debug for Device Name', type: 'string', read: true, write: true, role: 'text'}, native: {}},
        // info.Info
        {_id: adapter.namespace + '.info.Info.buildDate', type: 'state', common: {name: 'Date of Version', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        {_id: adapter.namespace + '.info.Info.numberDevicesFHEM', type: 'state', common: {name: 'Number of devices FHEM', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        {_id: adapter.namespace + '.info.Info.roomioBroker', type: 'state', common: {name: 'room of fhem.x.info.Configurations.onlySyncRoom exist', type: 'boolean', read: true, write: false, role: 'indicator'}, native: {}},
        {_id: adapter.namespace + '.info.Info.numberObjectsIOBout', type: 'state', common: {name: 'Number of objects IOB out', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        {_id: adapter.namespace + '.info.Info.numberObjectsIOBoutSub', type: 'state', common: {name: 'Number of objects IOB out Subscripe', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        {_id: adapter.namespace + '.info.Info.numberObjectsIOBin', type: 'state', common: {name: 'Number of objects IOB in', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        // info.Settings
        {_id: adapter.namespace + '.info.Settings.logCheckObject', type: 'state', common: {name: 'Log info Check channel', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Settings.logCreateChannel', type: 'state', common: {name: 'Log info Create channel', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Settings.logDeleteChannel', type: 'state', common: {name: 'Log info Delete channel', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Settings.logEventFHEM', type: 'state', common: {name: 'Log info event FHEM (telnet in)', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Settings.logEventFHEMglobal', type: 'state', common: {name: 'Log info event FHEM global', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Settings.logEventFHEMreading', type: 'state', common: {name: 'Log info event FHEM reading', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Settings.logEventFHEMstate', type: 'state', common: {name: 'Log info event FHEM state', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Settings.logEventIOB', type: 'state', common: {name: 'Log info event ioBroker', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Settings.logUnhandledEventFHEM', type: 'state', common: {name: 'Log warn unhandled event FHEM', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Settings.logUpdateChannel', type: 'state', common: {name: 'Log info Update channel', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}},
        {_id: adapter.namespace + '.info.Settings.logIgnoreConfigurations', type: 'state', common: {name: 'Log info ignore FHEM device', type: 'boolean', read: true, write: true, role: 'switch'}, native: {}}
    ];
    for (let i = 0; i < newPoints.length; i++) {
        adapter.setForeignObject(newPoints[i]._id, newPoints[i], err => {
            err &&
                    adapter.log.error('[myObjects] ' + err);
            if (i === newPoints.length - 1) {
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
    adapter.getState(id, (err, obj) => {
        err && adapter.log.error('getSetting: ' + err);
        if (obj) {
            obj.val && adapter.log.info('> ' + id + ' = ' + obj.val);
            callback(obj.val);
            cb && cb();
        } else {
            adapter.setState(id, setting, true);
            setting && adapter.log.info('> ' + id + ' = ' + setting);
            callback(setting);
            cb && cb();
        }
    });
}
function getSettings(cb) {
    adapter.log.debug('[getSettings] start');
    adapter.log.info('check ' + adapter.namespace + '.' + 'info.Settings true');
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
    adapter.log.debug('[getConfig] ' + id + config);
    adapter.getState(id, (err, obj) => {
        err && adapter.log.error('[getConfig] ' + err);
        if (obj) {
            const part = obj.val.split(",");
            if (part[0]) {
                for (const i in part) {
                    config.push(part[i].trim());
                }
            }
            config.length && adapter.log.info('> ' + id + ' = ' + config);
            cb && cb();
        } else {
            cb && cb();
        }
        //config.length && adapter.log.info('> ' + id + ' = ' + config);
    });
}
function getConfigurations(cb) {
    adapter.log.debug('[getConfigurations] start');
    adapter.log.info('check ' + adapter.namespace + '.' + 'info.Configurations true or value');
    getSetting('info.Configurations.autoRole', autoRole, value => autoRole = value);
    getSetting('info.Configurations.autoFunction', autoFunction, value => autoFunction = value);
    getSetting('info.Configurations.autoConfigFHEM', autoConfigFHEM, value => autoConfigFHEM = value);
    getSetting('info.Configurations.autoSmartName', autoSmartName, value => autoSmartName = value);
    getSetting('info.Configurations.deleteUnusedObjects', deleteUnusedObjects, value => deleteUnusedObjects = value);
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
    getSetting('info.Configurations.oldState', oldState, value => oldState = value);
    getSetting('info.Configurations.onlySyncNAME', onlySyncNAME, value => onlySyncNAME = value);
    onlySyncRoom = onlySyncRoomS.slice();
    getConfig('info.Configurations.onlySyncRoom', onlySyncRoom, value => {
        adapter.log.debug('[getConfigurations] end');
        cb && cb();
    });
}
function getDebug(cb) {
    adapter.log.debug('[getDebug] start');
    adapter.log.info('check ' + adapter.namespace + '.' + 'info.Debug');
    debugNAME = [];
    adapter.getState('info.Debug.activate', (err, obj) => {
        err && adapter.log.error('[getDebug] ' + err);
        if (obj) {
            //debugNAME = 'testswitch';
            const part = obj.val.split(",");
            if (part[0]) {
                for (const i in part) {
                    debugNAME.push(part[i].trim());
                }
            }
            debugNAME.length && adapter.log.info('> ' + adapter.namespace + '.' + 'info.Debug.activate' + ' = ' + debugNAME);
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
    if (onlySyncNAME) {
        adapter.log.debug('[startSync] onlySyncNAME = ' + onlySyncNAME);
        send = send + ' ' + onlySyncNAME;
    }
// send command JsonList2
    telnetOut.send(send, (err, result) => {
        err && adapter.log.error(err);
        adapter.log.debug('[startSync] nach jsonlist2 connected = ' + connected);
        if (!connected) {
            adapter.log.info('Connected FHEM telnet ' + adapter.config.host + ':' + adapter.config.port);
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
                checkSubscribe((cb) => {
                    parseObjects(objects.Results, () => {
                        unusedObjects('*', (cb) => {
                            //    ======================================================================================================================= send2ioB
                            if (fhemObjects[adapter.namespace + '.send2ioB']) {
                                adapter.log.info('check ' + adapter.namespace + '.send2ioB > OK');
                            } else {
                                adapter.log.warn('check ' + adapter.namespace + '.send2ioB > not found!');
                                queue.push({
                                    command: 'write',
                                    id: adapter.namespace + '.info.Commands.sendFHEM',
                                    val: 'define send2ioB dummy;attr send2ioB alias send2ioB;attr send2ioB room ioB_System;attr send2ioB comment Auto created by ioBroker'
                                });
                                processQueue();
                            }
                            //    ======================================================================================================================= send2ioB
                            sendFHEM('save');
                            adapter.log.info('check ' + adapter.namespace + '.info.Info end');
                            adapter.setState('info.Info.numberObjectsIOBin', Object.keys(fhemObjects).length, true);
                            adapter.log.info('> info.Info.numberObjectsIOBin = ' + Object.keys(fhemObjects).length);
                            adapter.setState('info.Info.numberObjectsIOBout', Object.keys(fhemIN).length, true);
                            adapter.log.info('> info.Info.numberObjectsIOBout = ' + Object.keys(fhemIN).length);
                            adapter.log.info('> info.Info.numberObjectsIOBoutSub = ' + Object.keys(fhemINs).length);
                            adapter.log.info('Synchronised FHEM!');
                            synchro = false;
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
    adapter.log.debug('[checkSubscribe] start ');
    if (!allowedIOBin.length) {
        adapter.log.debug('[checkSubscribe] no end');
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
function parseObjects(objs, cb) {
    adapter.log.debug('[parseObjects] start');
    const rooms = {};
    const objects = [];
    const states = [];
    let id;
    let obj;
    let name;
    let suche = 'no';
    const debugShow = '';
    if (firstRun) {
        adapter.log.info('check ' + adapter.namespace + '.info.Info start');
        adapter.setState('info.Info.buildDate', buildDate, true);
        adapter.log.info('> info.Info.buildDate = ' + buildDate);
        adapter.setState('info.Info.numberDevicesFHEM', objs.length, true);
        adapter.log.info('> info.Info.numberDevicesFHEM = ' + objs.length);
        //room onlySyncRoom?
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
        adapter.setState('info.Info.roomioBroker', iobroker, true);
        adapter.log.info('> info.Info.roomioBroker = ' + iobroker);
    }

    for (let i = 0; i < objs.length; i++) {
        const debugN = '[' + objs[i].Name + ']';
        try {
            if (resync) {
                adapter.log.debug('[parseObjects] stop resync');
                return;
            }
            (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' check FHEM Device');
            //onlySyncNAME,ignore Internals TYPE,NAME & Attributtes room 
            if (onlySyncNAME && onlySyncNAME.indexOf(objs[i].Internals.NAME) === -1) {
                logIgnoreConfigurations && adapter.log.info('ignore FHEM device "' + objs[i].Name + '" | NAME <> ' + onlySyncNAME + ' | ' + ' ' + (i + 1) + '/' + objs.length);
                (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.warn(debugN + ' no sync - not included in ' + adapter.namespace + '.info.Config.onlySyncNAME');
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
            if (objs[i].Attributes.comment && objs[i].Attributes.comment.indexOf('Auto-created by ioBroker') !== -1) {
                adapter.log.debug('[parseObjects] Auto-created by ioBroker = ' + objs[i].Name);
                if (!fhemINs[objs[i].Name]) {
                    queue.push({
                        command: 'write',
                        id: adapter.namespace + '.info.Commands.sendFHEM',
                        val: 'delete ' + objs[i].Name
                    });
                    logIgnoreConfigurations && adapter.log.info('ignore FHEM device "' + objs[i].Name + '" | comment: Auto-created by ioBroker' + ' | ' + ' ' + (i + 1) + '/' + objs.length);
                } else {
                    fhemIN[objs[i].Name] = {id: objs[i].Name};
                }
                continue;
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
                    //12.01.19 allow room ioB_System
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
                    sendFHEM('attr ' + objs[i].Name + ' createGroupReadings 1', 'HUEBridge');
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
                    sendFHEM('attr ' + objs[i].Name + ' generateVolumeEvent 1', 'SONOSPLAYER');
                }
            }
            if (objs[i].Attributes.model === 'HM-CC-RT-DN') {
                Funktion = 'heating';
                obj.common.role = 'thermostate';
            }
            if (objs[i].Attributes.subType === 'thermostat') {
                Funktion = 'heating';
                //obj.common.role = 'thermostate';
            }
            if (objs[i].Attributes.subType === 'smokeDetector') {
                Funktion = 'security';
                //obj.common.role = 'sensor.alarm.fire';
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
                    adapter.log.warn(objs[i].Name + ': no alias found! set alias "' + alias + '" automatically in FHEM');
                    queue.push({
                        command: 'write',
                        id: adapter.namespace + '.info.Commands.sendFHEM',
                        val: 'attr ' + objs[i].Name + ' alias ' + objs[i].Name
                    });
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
                    obj.native.ts = Date.now();
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
                            read: true
                        },
                        native: {
                            Name: objs[i].Name,
                            Attribute: attr,
                            Internals: true
                        }
                    };
                    obj.native.ts = Date.now();
                    (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Internals[attr] + ' > ' + obj._id + ' = ' + val + ' | type: ' + obj.common.type + ' | read: ' + obj.common.read + ' | role: ' + obj.common.role);
                    //adapter.log.debug('[parseObjects] check Internals "' + id + '" = ' + val);
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
                    let states = true;
                    // ignore PossibleSets
                    if (ignorePossibleSets.indexOf(parts[0]) !== -1) {
                        (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.warn(debugN + ' >> ' + parts[0] + ' > no sync - included in ' + adapter.namespace + '.info.Config.ignorePossibleSets');
                        continue;
                    }
                    const stateName = parts[0].replace(/\./g, '_');
                    id = adapter.namespace + '.' + name + '.' + stateName;
                    if (parts[0] === 'off')
                        isOff = true;
                    if (parts[0] === 'on')
                        isOn = true;
                    obj = {
                        _id: id,
                        type: 'state',
                        common: {
                            name: objs[i].Name + ' ' + parts[0],
                            role: 'state',
                            type: 'string',
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
                    if (objs[i].Internals.TYPE === 'FS20' && !parts[1]) {                               //============================================
                        if (['on', 'off', 'toggle', 'dimup', 'dimdown', 'dimupdown', 'dim06%', 'dim12%', 'dim18%', 'dim25%', 'dim31%', 'dim37%', 'dim43%', 'dim50%', 'dim56%', 'dim62%', 'dim68%', 'dim75%', 'dim81%', 'dim87%', 'dim93%', 'dim100%'].indexOf(parts[0]) !== -1) {
                            obj.common.type = 'boolean';
                            obj.common.role = 'button';
                        }
                    }
                    if (parts[1]) {
                        if (parts[1].indexOf('noArg') !== -1) {
                            states = false;
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
                            states = false;
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
                            states = false;
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
                        states = false;
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
                        states = false;
                        obj.common.role = 'level.dimmer';
                        obj.common.unit = '%';
                        obj.native.level_dimmer = true;
                        if (adapter.namespace === 'fhem.0' && objs[i].Attributes.room) {
                            obj.common.smartName = {
                                'de': alias
                            };
                        }
                    }

                    if (volumePossibleSets.indexOf(parts[0]) !== -1) {
                        states = false;
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
                        states = false;
                        obj.common.role = 'level.color.rgb';
                        obj.native.rgb = true;
                        if (adapter.namespace === 'fhem.0' && objs[i].Attributes.room) {
                            obj.common.smartName = {
                                'de': alias
                            };
                        }
                    }

                    if (parts[0] === 'color') {
                        states = false;
                        obj.common.role = 'level.color.temperature';
                        obj.common.unit = 'K';
                        obj.native.ct = true;
                        if (adapter.namespace === 'fhem.0' && objs[i].Attributes.room) {
                            obj.common.smartName = {
                                'de': alias
                            };
                        }
                    }

                    if (parts[1] && states) {
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

                    obj.native.ts = Date.now();
                    (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + parts[0] + ' = ' + parts[1] + ' > ' + id + ' | type: ' + obj.common.type + ' | write: ' + obj.common.write + ' | role: ' + obj.common.role + ' | min: ' + obj.common.min + ' | max: ' + obj.common.max + ' | unit: ' + obj.common.unit + ' | states: ' + JSON.stringify(obj.common.states));
                    objects.push(obj);
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
                                //adapter.log.warn(name + ' ' + attr + ' ' + val + ' detect switch for dummy');
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
                                        Attribute: 'state',
                                        ts: Date.now()
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
                                        Attribute: 'state_boolean',
                                        ts: Date.now()
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
                                        Attribute: 'state_value',
                                        ts: Date.now()
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
                                        Attribute: 'state_media',
                                        ts: Date.now()
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

                        obj.native.ts = Date.now();
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
                        combined && (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value.replace(/\n|\r/g, '\u005cn') + ' > ' + obj._id + ' = ' + val.toString().replace(/\n|\r/g, '\u005cn') + ' | read: ' + obj.common.read + ' (Value Possible Set)');
                        !combined && (debugNAME.indexOf(objs[i].Name) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value.replace(/\n|\r/g, '\u005cn') + ' > ' + obj._id + ' = ' + val.toString().replace(/\n|\r/g, '\u005cn') + ' | type: ' + obj.common.type + ' | read: ' + obj.common.read + ' | role: ' + obj.common.role + ' | Funktion: ' + Funktion);
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
    firstRun = false;
    debug = false;
    processQueue();    //===============================================================
    adapter.log.debug('start [syncObjects]');
    adapter.log.debug('start [syncRooms]');
    adapter.log.debug('start [syncFunctions]');
    adapter.log.debug('start [syncStates]');
    syncObjects(objects, () => {
        syncRooms(rooms, () => {
            syncFunctions(functions, () => {
                syncStates(states, cb);
            });
        });
    });
}
function setFunction(id, Funktion, name) {
    let fff = Funktion.split(',');
    for (let f = 0; f < fff.length; f++) {
        fff[f] = fff[f].trim();
        //logCheckObject && adapter.log.info('> function = ' + fff[f] + ' | ' + id);
        functions[fff[f]] = functions[fff[f]] || [];
        functions[fff[f]].push(id);
    }
}
function sendFHEM(cmd, detect) {
    if (autoConfigFHEM) {
        queue.push({
            command: 'write',
            id: adapter.namespace + '.info.Commands.sendFHEM',
            val: cmd
        });
        processQueue();
        adapter.log.info('"' + adapter.namespace + '.info.Configurations.autoConfigFHEM" = true  > ' + cmd + ' | more info README.md');
    } else if (detect) {
        adapter.log.warn('detect ' + detect + ': missing "' + cmd + '" > set manuelly in FHEM or automatically with "' + adapter.namespace + '.info.Configuration.autoConfigFhem" = true | more info README.md');
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
//val = val.trim();
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
    //const f = parseFloat(val, 10);
    // //adapter.log.warn('[convertFhemValue] ' + val + ' ' + f + ' ' + typeof f);
    //if (f === Number(val))
    //    return f;
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
        if (id.indexOf('jsonlist2') !== -1) {
            adapter.log.info('[' + val + '] debug jsonlist2 ' + val);
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
            adapter.log.info('[' + val + '] debug meta "jsonlist2 ' + val + '"');
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
    adapter.log.info('check channel ' + name + ' > jsonlist2 ' + name);
    // send command JsonList2
    telnetOut.send('jsonlist2 ' + name, (err, result) => {
        err && adapter.log.error('[requestMeta] ' + err);
        if (result) {
            let objects = null;
            try {
                objects = JSON.parse(result);
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
    //adapter.log.warn(name);
    let parts = name.split('.');
    debugNAME.indexOf(parts[2]) !== -1 && adapter.log.info('[' + parts[2] + '] delete objekt "' + name + '"');
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
    if (check === '*')
        adapter.log.info('check delete unused objects');

    if (!deleteUnusedObjects) {
        if (check === '*') {
            adapter.log.info('> info.Configurations.deleteUnusedObjecs not true!');
        } else {
            adapter.log.info('info.Configurations.deleteUnusedObjecs ' + check + ' not true!');
        }
        cb && cb();
        return;
    }

    //let channel = 'no';
    adapter.getStates(check, (err, states) => {
        if (err) {
            adapter.log.error('[unusedObjects] ' + err);
        } else {
            for (const id in states) {
                if (!states.hasOwnProperty(id)) {
                    continue;
                }
                adapter.getObject(id, (err, obj) => {
                    if (err) {
                        adapter.log.error('[unusedObjects] ' + err);
                    } else {
                        if (!obj) {
                            return;
                        }
                        const channelS = obj._id.split('.');
                        if (channelS[2] === 'info') {
                            return;
                        }
                        if (check === '*') {
                            if (obj.native.ts < ts_update || !obj.native.ts) {
                                if (channelS[3] === 'Internals' && channelS[4] === 'TYPE') {
                                    queueL.push({
                                        command: 'delChannel',
                                        name: channelS[2]
                                    });
                                }
                                queueL.push({
                                    command: 'delObject',
                                    name: obj._id
                                });
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
                            }
                            delete fhemObjects[obj._id];
                            queueL.push({
                                command: 'delObject',
                                name: obj._id
                            });
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
    //adapter.log.debug ('[processQueue]');
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
function processQueueL() {
    if (!queueL.length) {
        adapter.log.debug('[processQueueL] ende');
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
// end ==================================================================================================================================
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
            //connected = true;
            myObjects(() =>
                getSettings(() =>
                    getConfigurations(() =>
                        getDebug(() =>
                            startSync()))));
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
