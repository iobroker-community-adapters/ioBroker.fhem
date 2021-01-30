/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */

'use strict';
const utils = require('@iobroker/adapter-core');
const adapterName = require('./package.json').name.split('.').pop();
const Telnet = require('./lib/telnet');
// Telnet sessions
let telnetOut = null; // read config and write values
let telnetIn = null; // receive events
let adapter;
let connected = false;
const eventIOB = [];
const delObj = [];
const eventQueue = [];
const setStateQueue = [];
const setStateLogQueue = [];
let fhemIN = {};
let fhemINs = {};
let fhemIgnore = {};
let fhemIgnoreConfig = {};
let infoObjects = {};
const fhemObjects = {};
const functions = {};
let lastNameQueue;
let lastNameTS = '0';
let iobroker = false;
let firstRun = true;
let synchro = true;
let debug = false;
let aktivQueue = false;
let aktiv = false;
const buildDate = '30.01.21';
const linkREADME = 'https://github.com/iobroker-community-adapters/ioBroker.fhem/blob/master/docs/de/README.md';
const tsStart = Date.now();
let t = '> ';
// info.Debug
let debugNAME = [];
let logDevelop;
let numEvent = 0;
let timeEvent = 0;
let numWriteOut = 0;
let timeWriteOut = 0;
let numWriteValue = 0;
let timeWriteValue = 0;
// info.Configurations
let syncUpdate;
let syncUpdateIOBin;  //29.01.21
let advancedFunction;
let autoRole;
let autoFunction;
let autoRoom;
let autoConfigFHEM;
let autoSmartName;
let autoName;
let autoType;
let autoStates;
let autoRest;
let oldState;
let deleteUnusedObjects;
let logNoInfo;
let onlySyncNAME = [];
let onlySyncTYPE = [];
const onlySyncRoomS = ['ioBroker', 'ioB_OUT'];
let onlySyncRoom = [];
const ignoreObjectsInternalsTYPES = [];
let ignoreObjectsInternalsTYPE = [];
const ignoreObjectsInternalsNAMES = ['info'];
let ignoreObjectsInternalsNAME = [];
const ignoreObjectsAttributesRoomS = [];
let ignoreObjectsAttributesRoom = [];
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
let allowedIOBinExclude = []; //29.01.21
let allowedIOBinExcludeS = [];
// info.Settings
let logCheckObject;
let logUpdateChannel;
let logCreateChannel;
let logDeleteChannel;
let logEventIOB;
let logEventFHEM;
let logEventFHEMglobal;
let logEventFHEMreading;
let logEventFHEMstate;
let logUnhandledEventFHEM;
let logIgnoreConfigurations;
// parseObject
const dimPossibleSets = ['pct', 'brightness', 'dim'];
const volumePossibleSets = ['Volume', 'volume', 'GroupVolume'];
const temperaturePossibleSets = ['desired-temp'];
const Utemperature = ['temperature', 'measured-temp', 'desired-temp', 'degrees', 'box_cputemp', 'temp_c', 'cpu_temp', 'cpu_temp_avg'];
const rgbPossibleSets = ['rgb'];
const Rindicator = ['reachable', 'presence', 'battery', 'Activity', 'present', 'batteryState'];
//const 
function startAdapter(options) {
    options = options || {};
    Object.assign(options, {name: adapterName});
    adapter = new utils.Adapter(options);
    // is called when adapter shuts down - callback has to be called under any circumstances!
    adapter.on('unload', callback => {
        try {
            connected = false;
            // stop all timers
            Object.keys(adapter.__timeouts).forEach(name => {
                adapter.__timeouts[name] && clearTimeout(adapter.__timeouts[name]);
                adapter.__timeouts[name] = null;
                adapter.log.debug('adapter.on.unload: clearTimeout ' + name);
            });
            adapter.setState('info.connection', false, true);
            adapter.setState('info.Info.alive', false, true);
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
        let fn = '[stateChange] ';
        let ts = Date.now();
        // you can use the ack flag to detect if it is status (true) or command (false)
        if (!state) {
            adapter.log.debug(fn + 'no state - ' + id);
            return;
        }
        let val = state.val;
        let ack = state.ack;
        logDebug(fn, id, 'stateChange (in): ' + id + ' ' + val + ' ' + JSON.stringify(state), '');
        //29.01.21
        if (!id.startsWith(adapter.namespace)) {
            let idFHEM = convertNameIob(fn, id);
            if (fhemIN[idFHEM]) {
                if (val !== fhemINs[idFHEM].val || syncUpdateIOBin) {    //29.01.21
                    eventIOB.push({
                        command: 'writeOut',
                        id: idFHEM,
                        val: val,
                        ts: ts
                    });
                    fhemINs[idFHEM] = {
                        id: id,
                        val: val
                    };
                    if (!firstRun)
                        checkQueue(fn);
                    return;
                } else {
                    return;
                }
            }
        }
        if (ack)
            return;
        // no ack and from adapter ?
        if (!state.ack && id.startsWith(adapter.namespace)) {
            if (id === adapter.namespace + '.info.resync') {
                logWarn(fn, '----- request restart adapter');
                eventIOB.push({
                    command: 'resync'
                });
                checkQueue(fn);
                return;
            } else if (fhemObjects[id] || id.startsWith(adapter.namespace + '.info')) {
                logDebug(fn, id, 'stateChange(write): ' + id + ' ' + val + ' ' + JSON.stringify(state), 'D');
                eventIOB.push({
                    command: 'write',
                    id: id,
                    val: val,
                    ts: ts
                });
                checkQueue(fn);
                return;
            } else {
                logStateChange(fn, id, val, 'stateChange - no match !state.ack && id.startsWith(adapter.namespace) id: ' + id, 'neg');
                return;
            }
        } else {
            logDebug(fn + t, id, 'stateChange: ' + id + ' | ' + val + ' | ack: ' + ack, 'D');
            return;
        }
        logStateChange(fn, id, val, 'stateChange - no match ' + JSON.stringify(state), 'neg');
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
    adapter.__timeouts = {};
    return adapter;
}
//========================================================================================================================================== start
function firstCheck(ff, cb) {
    let fn = ff + '[firstCheck] ';
    logDebug(fn, '', 'start', 'D');
    adapter.setState('info.resync', false, true);
    getSetting(fn, 'info.Debug.logDevelop', value => {
        logDevelop = value;
        getSetting(fn, 'info.Configurations.logNoInfo', value => {
            logNoInfo = value;
            logDebug(fn, '', 'end', 'D');
            cb();
        });
    });
}
// STEP 01
function myObjects(ff, cb) {
    let fn = ff + '[myObjects] ';
    logDebug(fn, '', 'start', 'D');
    let id;
    const newPoints = [
        // info.Commands
        {_id: 'info.Commands.lastCommand', type: 'state', common: {name: 'Last command to FHEM', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        {_id: 'info.Commands.resultFHEM', type: 'state', common: {name: 'Result of FHEM', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        {_id: 'info.Commands.sendFHEM', type: 'state', common: {name: 'Command to FHEM', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Commands.createSwitch', type: 'state', common: {name: 'Create dummy as switch in room FHEM (NAME room)', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        // info.Configurations
        {_id: 'info.Configurations.autoConfigFHEM', type: 'state', common: {name: 'FUNCTION - allow special configurations FHEM', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Configurations.autoFunction', type: 'state', common: {name: 'FUNCTION - auto create function of object (use Adapter Material)', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Configurations.autoRoom', type: 'state', common: {name: 'FUNCTION - auto create room of channel (use Adapter Material)', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Configurations.autoRole', type: 'state', common: {name: 'FUNCTION - auto create role of object (use Adapter Material)', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Configurations.autoSmartName', type: 'state', common: {name: 'FUNCTION - (fhem.0) auto create SmartName of object (Adapter Cloud/IoT)', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Configurations.autoName', type: 'state', common: {name: 'FUNCTION - auto create name of object', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Configurations.autoType', type: 'state', common: {name: 'FUNCTION - auto create type of object', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Configurations.autoStates', type: 'state', common: {name: 'FUNCTION - auto create states of object', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Configurations.autoRest', type: 'state', common: {name: 'FUNCTION - auto create read,write,min,max,unit of object', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Configurations.deleteUnusedObjects', type: 'state', common: {name: 'FUNCTION - delete unused objects automatically', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Configurations.oldState', type: 'state', common: {name: 'FUNCTION - old version of state with true/false', type: 'boolean', read: true, write: true, role: 'switch', def: false}, native: {}},
        {_id: 'info.Configurations.allowedIOBin', type: 'state', common: {name: 'SYNC - allowed objects send2FHEM', type: 'string', read: true, write: true, role: 'state'}, native: {default: '.'}},
        {_id: 'info.Configurations.allowedIOBinExclude', type: 'state', common: {name: 'SYNC - exclude allowedIOBin', type: 'string', read: true, write: true, role: 'state'}, native: {default: '.'}}, //29.01.21   
        {_id: 'info.Configurations.ignoreObjectsInternalsTYPE', type: 'state', common: {name: 'SYNC - ignore device(s) TYPE (default: ' + ignoreObjectsInternalsTYPES + ')', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.ignoreObjectsInternalsNAME', type: 'state', common: {name: 'SYNC - ignore device(s) NAME (default: ' + ignoreObjectsInternalsNAMES + ')', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.ignoreObjectsAttributesroom', type: 'state', common: {name: 'SYNC - ignore device(s) of room(s) (default: ' + ignoreObjectsAttributesRoomS + ')', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.allowedAttributes', type: 'state', common: {name: 'SYNC - allowed Attributes (default:  ' + allowedAttributesS + ')', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.allowedInternals', type: 'state', common: {name: 'SYNC - allowed Internals (default: ' + allowedInternalsS + ')', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.ignoreReadings', type: 'state', common: {name: 'SYNC - ignore Readings (default: ' + ignoreReadingsS + ')', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.ignorePossibleSets', type: 'state', common: {name: 'SYNC - ignore PossibleSets (default: ' + ignorePossibleSetsS + ')', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.onlySyncRoom', type: 'state', common: {name: 'SYNC - only sync device(s) if room exist (default: ' + onlySyncRoomS + ')', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.onlySyncNAME', type: 'state', common: {name: 'SYNC - only sync device(s) NAME', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.onlySyncTYPE', type: 'state', common: {name: 'SYNC - only sync device(s) TYPE', type: 'string', read: true, write: true, role: 'state'}, native: {}},
        {_id: 'info.Configurations.logNoInfo', type: 'state', common: {name: 'FUNCTION - no LOG info', type: 'boolean', read: true, write: true, role: 'switch', def: false}, native: {}},
        {_id: 'info.Configurations.advancedFunction', type: 'state', common: {name: 'FUNCTION - advanced', type: 'boolean', read: true, write: true, role: 'switch', def: false}, native: {}},
        {_id: 'info.Configurations.syncUpdate', type: 'state', common: {name: 'FUNCTION - sync update FHEM reading', type: 'boolean', read: true, write: true, role: 'switch', def: true}, native: {}},
        {_id: 'info.Configurations.syncUpdateIOBin', type: 'state', common: {name: 'FUNCTION - sync update allowedIOBin', type: 'boolean', read: true, write: true, role: 'switch', def: true}, native: {}}, //29.01.21
        // info.Debug
        {_id: 'info.Debug.jsonlist2', type: 'state', common: {name: 'jsonlist2 of FHEM', type: 'string', read: true, write: true, role: 'json'}, native: {}},
        {_id: 'info.Debug.meta', type: 'state', common: {name: 'Device NAME of FHEM', type: 'string', read: true, write: true, role: 'text'}, native: {}},
        {_id: 'info.Debug.activate', type: 'state', common: {name: 'Debug Mode for Device(s) NAME', type: 'string', read: true, write: true, role: 'text'}, native: {}},
        {_id: 'info.Debug.logDevelop', type: 'state', common: {name: 'More info debug', type: 'boolean', role: 'switch', def: false}, native: {}},
        {_id: 'info.Debug.numberIn', type: 'state', common: {name: 'Number of events of FHEM last 5 min', type: 'number', read: true, write: false, role: 'value', def: 0}, native: {}},
        {_id: 'info.Debug.timeIn', type: 'state', common: {name: 'Average time(ms) of events of FHEM last 5 min', type: 'number', read: true, write: false, role: 'value', def: 0}, native: {}},
        {_id: 'info.Debug.numberOut', type: 'state', common: {name: 'Number of stateChanges(s) of ioBroker last 5 min', type: 'number', read: true, write: false, role: 'value', def: 0}, native: {}},
        {_id: 'info.Debug.timeOut', type: 'state', common: {name: 'Average time(ms) stateChanges(s) of ioBroker last 5 min', type: 'number', read: true, write: false, role: 'value', def: 0}, native: {}},
        {_id: 'info.Debug.fhemObjectsRead', type: 'state', common: {name: 'Device NAME of FHEM', type: 'string', read: true, write: true, role: 'text'}, native: {}},
        // info.Info
        {_id: 'info.Info.buildDate', type: 'state', common: {name: 'Date of main.js', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        {_id: 'info.Info.roomioBroker', type: 'state', common: {name: 'room of fhem.x.info.Configurations.onlySyncRoom exist', type: 'boolean', read: true, write: false, role: 'indicator'}, native: {}},
        {_id: 'info.Info.numberDevicesFHEM', type: 'state', common: {name: 'Number devices of FHEM (jsonlist2)', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        {_id: 'info.Info.numberDevicesFHEMsync', type: 'state', common: {name: 'Number devices of FHEM (synchronized)', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        {_id: 'info.Info.numberObjectsIOBout', type: 'state', common: {name: 'Number of objects IOB out (detected)', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        {_id: 'info.Info.numberObjectsIOBoutSub', type: 'state', common: {name: 'Number of objects IOB out (subscribe)', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        {_id: 'info.Info.numberObjectsIOBin', type: 'state', common: {name: 'Number of objects IOB in', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        {_id: 'info.Info.alive', type: 'state', common: {name: 'FHEM alive', type: 'boolean', read: true, write: false, role: 'indicator.connected'}, native: {}},
        {_id: 'info.Info.numberDevicesFHEMignored', type: 'state', common: {name: 'Number devices of FHEM (ignored)', type: 'number', read: true, write: false, role: 'value'}, native: {}},
        {_id: 'info.Info.lastWarn', type: 'state', common: {name: 'lastWarn', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        {_id: 'info.Info.lastError', type: 'state', common: {name: 'lastError', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        {_id: 'info.Info.lastInfo', type: 'state', common: {name: 'lastInfo', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        {_id: 'info.Info.lastSend2ioB', type: 'state', common: {name: 'lastSend2ioB', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        {_id: 'info.Info.lastIOBout', type: 'state', common: {name: 'lastIOBout', type: 'string', read: true, write: false, role: 'text'}, native: {}},
        // info.Settings
        {_id: 'info.Settings.logCheckObject', type: 'state', common: {name: 'LOG "check channel ....." ', type: 'boolean', role: 'switch', def: false}, native: {}},
        {_id: 'info.Settings.logCreateChannel', type: 'state', common: {name: 'LOG "Create channel ....." ', type: 'boolean', role: 'switch', def: false}, native: {}},
        {_id: 'info.Settings.logDeleteChannel', type: 'state', common: {name: 'LOG "Delete channel ....." ', type: 'boolean', role: 'switch', def: false}, native: {}},
        {_id: 'info.Settings.logEventFHEM', type: 'state', common: {name: 'LOG "event FHEM ....." all events from FHEM over telnet)', type: 'boolean', role: 'switch', def: false}, native: {}},
        {_id: 'info.Settings.logEventFHEMglobal', type: 'state', common: {name: 'LOG "event FHEM(g) ....." events global from FHEM', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Settings.logEventFHEMreading', type: 'state', common: {name: 'LOG "event FHEM(r) ....." events readings from FHEM', type: 'boolean', role: 'switch', def: false}, native: {}},
        {_id: 'info.Settings.logEventFHEMstate', type: 'state', common: {name: 'LOG "event FHEM(s) ....." events state from FHEM', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Settings.logEventIOB', type: 'state', common: {name: 'LOG "stateChange: ....." all events ioBroker to FHEM', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Settings.logUnhandledEventFHEM', type: 'state', common: {name: 'LOG "unhandled event FHEM ....." all events unhandled from FHEM', type: 'boolean', role: 'switch', def: true}, native: {}},
        {_id: 'info.Settings.logUpdateChannel', type: 'state', common: {name: 'LOG "Update channel ....." ', type: 'boolean', role: 'switch', def: false}, native: {}},
        {_id: 'info.Settings.logIgnoreConfigurations', type: 'state', common: {name: 'LOG "ignore FHEM device ....." ignored Devices from FHEM (info.Configurations) ', type: 'boolean', role: 'switch', def: false}, native: {}}
    ];
    id = adapter.namespace + '.info.resync';
    infoObjects[id] = {id: id};
    id = adapter.namespace + '.info.connection';
    infoObjects[id] = {id: id};
    logInfo(fn, '> check new/update objects ');
    for (let i = 0; i < newPoints.length; i++) {
        adapter.getObject(newPoints[i]._id, newPoints[i], (e, obj) => {
            e && logError(fn, e);
            id = adapter.namespace + '.' + newPoints[i]._id;
            infoObjects[id] = {id: id};
            if (!obj) {
                adapter.setObject(newPoints[i]._id, newPoints[i], e => {
                    e && logError(fn, e);
                    logInfo(fn, '> create ' + adapter.namespace + '.' + newPoints[i]._id + ' - ' + newPoints[i].common.name + ' (NEW)', () => {
                        if (i === newPoints.length - 1) {
                            deleteMyObjects(ff, i, () => {
                                logDebug(fn, '', 'end', 'D');
                                cb();
                            });
                        }
                    });
                });
            } else {
                adapter.extendObject(newPoints[i]._id, newPoints[i], e => {
                    e && logError(fn, e);
                    logDebug(fn, '', '> update ' + adapter.namespace + '.' + newPoints[i]._id + ' - ' + newPoints[i].common.name, '', () => {
                        if (i === newPoints.length - 1) {
                            deleteMyObjects(ff, i, () => {
                                logDebug(fn, '', 'end', 'D');
                                cb();
                            });
                        }
                    });
                });
            }
        });
    }
}
function deleteMyObjects(ff, i, cb) {
    let fn = ff + '[deleteMyObjects] ';
    logDebug(fn, '', 'start', 'D');
    logInfo(fn, '> check old objects and delete');
    adapter.getStates(adapter.namespace + '.info.*', (e, states) => {
        if (e) {
            logError(fn, e);
            cb();
        } else {
            for (const id in states) {
                if (!states.hasOwnProperty(id)) {
                    continue;
                }
                if (!infoObjects[id]) {
                    adapter.log.warn(id + ' ' + JSON.stringify(states));
                    delObj.push({
                        command: 'delState',
                        name: id
                    });
                    delObj.push({
                        command: 'delObject',
                        name: id
                    });
                }
            }
            logInfo(fn, '> ' + (i + 1) + ' objects ' + adapter.namespace + '.info OK');
            logDebug(fn, '', 'end', 'D');
            cb();
        }
    });
}
//STEP 02
function getConfigurationsSYNC(ff, cb) {  //29.01.21
    let fn = ff + '[getConfigurationsSYNC] ';
    logDebug(fn, '', 'start', 'D');
    if (!firstRun)
        logInfo(fn, 'change Configurations of FUNCTION ===== check ' + adapter.namespace + '.' + 'info.Configurations (true or value) - select function of Adapter and Devices to sync');
    allowedIOBin = allowedIOBinS.slice();
    getConfig(fn, 'info.Configurations.allowedIOBin', allowedIOBin, () => {
        allowedIOBinExclude = allowedIOBinExcludeS.slice();
        getConfig(fn, 'info.Configurations.allowedIOBinExclude', allowedIOBinExclude, () => {
            ignoreObjectsAttributesRoom = ignoreObjectsAttributesRoomS.slice();
            getConfig(fn, 'info.Configurations.ignoreObjectsAttributesroom', ignoreObjectsAttributesRoom, () => {
                ignoreObjectsInternalsNAME = ignoreObjectsInternalsNAMES.slice();
                getConfig(fn, 'info.Configurations.ignoreObjectsInternalsNAME', ignoreObjectsInternalsNAME, () => {
                    ignoreObjectsInternalsTYPE = ignoreObjectsInternalsTYPES.slice();
                    getConfig(fn, 'info.Configurations.ignoreObjectsInternalsTYPE', ignoreObjectsInternalsTYPE, () => {
                        allowedAttributes = allowedAttributesS.slice();
                        getConfig(fn, 'info.Configurations.allowedAttributes', allowedAttributes, () => {
                            allowedInternals = allowedInternalsS.slice();
                            getConfig(fn, 'info.Configurations.allowedInternals', allowedInternals, () => {
                                ignoreReadings = ignoreReadingsS.slice();
                                getConfig(fn, 'info.Configurations.ignoreReadings', ignoreReadings, () => {
                                    ignorePossibleSets = ignorePossibleSetsS.slice();
                                    getConfig(fn, 'info.Configurations.ignorePossibleSets', ignorePossibleSets, () => {
                                        onlySyncNAME = [];
                                        getConfig(fn, 'info.Configurations.onlySyncNAME', onlySyncNAME, () => {
                                            onlySyncTYPE = [];
                                            getConfig(fn, 'info.Configurations.onlySyncTYPE', onlySyncTYPE, () => {
                                                onlySyncRoom = onlySyncRoomS.slice();
                                                getConfig(fn, 'info.Configurations.onlySyncRoom', onlySyncRoom, () => {
                                                    logDebug(fn, '', 'end', 'D');
                                                    cb && cb();
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}
//STEP 03
function getConfigurationsFUNCTION(ff, cb) {
    let fn = ff + '[getConfigurationsFUNCTION] ';
    logDebug(fn, '', 'start', 'D');
    if (!firstRun)
        logInfo(fn, 'change Configurations of FUNCTION ===== check ' + adapter.namespace + '.' + 'info.Configurations (value) - Devices to sync');
    getSetting(fn, 'info.Configurations.autoRole', value => autoRole = value);
    getSetting(fn, 'info.Configurations.autoFunction', value => autoFunction = value);
    getSetting(fn, 'info.Configurations.autoRoom', value => autoRoom = value);
    getSetting(fn, 'info.Configurations.autoConfigFHEM', value => autoConfigFHEM = value);
    getSetting(fn, 'info.Configurations.autoSmartName', value => autoSmartName = value);
    getSetting(fn, 'info.Configurations.autoName', value => autoName = value);
    getSetting(fn, 'info.Configurations.autoType', value => autoType = value);
    getSetting(fn, 'info.Configurations.autoStates', value => autoStates = value);
    getSetting(fn, 'info.Configurations.autoRest', value => autoRest = value);
    getSetting(fn, 'info.Configurations.deleteUnusedObjects', value => deleteUnusedObjects = value);
    getSetting(fn, 'info.Configurations.advancedFunction', value => advancedFunction = value);
    getSetting(fn, 'info.Configurations.syncUpdate', value => syncUpdate = value);
    getSetting(fn, 'info.Configurations.syncUpdateIOBin', value => syncUpdateIOBin = value);   //29.01.21
    getSetting(fn, 'info.Configurations.oldState', value => {
        oldState = value;
        adapter.setState('info.Info.buildDate', buildDate, true);
        let start = '----- start FHEM Adapter Instanz ' + adapter.namespace;
        let text;
        if (advancedFunction) {
            text = start;
        } else {
            text = '----- not in use - info.Configurations.advancedFunction(false)';
        }
        adapter.setState('info.Info.lastWarn', text, true);
        adapter.setState('info.Info.lastError', text, true);
        adapter.setState('info.Info.lastInfo', text, true);
        adapter.setState('info.Info.lastSend2ioB', text, true);
        adapter.setState('info.Info.lastIOBout', text, true);
        adapter.setState('info.Commands.lastCommand', start, true);
        logDebug(fn, '', 'end', 'D');
        cb && cb();
    });
}
//STEP 04
function getSettings(ff, cb) {
    let fn = ff + '[getSettings] ';
    logDebug(fn, '', 'start', 'D');
    if (!firstRun)
        logInfo(fn, 'change Settings ===== check ' + adapter.namespace + '.' + 'info.Settings (true) - select message ioBroker admin > LOG');
    getSetting(fn, 'info.Settings.logCheckObject', value => logCheckObject = value);
    getSetting(fn, 'info.Settings.logUpdateChannel', value => logUpdateChannel = value);
    getSetting(fn, 'info.Settings.logCreateChannel', value => logCreateChannel = value);
    getSetting(fn, 'info.Settings.logDeleteChannel', value => logDeleteChannel = value);
    getSetting(fn, 'info.Settings.logEventIOB', value => logEventIOB = value);
    getSetting(fn, 'info.Settings.logEventFHEM', value => logEventFHEM = value);
    getSetting(fn, 'info.Settings.logEventFHEMglobal', value => logEventFHEMglobal = value);
    getSetting(fn, 'info.Settings.logEventFHEMreading', value => logEventFHEMreading = value);
    getSetting(fn, 'info.Settings.logEventFHEMstate', value => logEventFHEMstate = value);
    getSetting(fn, 'info.Settings.logUnhandledEventFHEM', value => logUnhandledEventFHEM = value);
    getSetting(fn, 'info.Settings.logIgnoreConfigurations', value => {
        logIgnoreConfigurations = value;
        logDebug(fn, '', 'end', 'D');
        cb && cb();
    });
}
// more
function getSetting(ff, id, cb) {
    let fn = ff + '[getSetting] ';
    logDebug(fn, '', id, 'D');
    adapter.getObject(id, (e, obj) => {
        e && logError(fn, e);
        if (obj) {
            adapter.getState(id, (e, state) => {
                e && logError(fn, e);
                if (state) {
                    logDebug(fn, '', id + ' ' + state.val, '');
                    state.val && logInfo(fn, '> ' + obj.common.name + ' - ' + id + ' (' + state.val + ')');
                    adapter.setState(id, state.val, true);
                    cb(state.val);
                } else {
                    logDebug(fn, '', id + ' - no state found', '');
                    cb();
                }
            });
        } else {
            logDebug(fn, '', id + ' - no object found', '');
            cb();
        }
    });
}
function getConfig(ff, id, config, cb) {
    let fn = ff + '[getConfig] ';
    adapter.log.debug(fn + id + ' (' + config + ')');
    adapter.getObject(id, (e, obj) => {
        e && logError(fn, e);
        if (obj) {
            adapter.getState(id, (e, state) => {
                e && logError(fn, e);
                adapter.log.debug(fn + id + ': ' + JSON.stringify(state));
                if (state && state.val) {
                    adapter.setState(id, state.val, true);
                    const part = state.val.split(",");
                    if (part[0]) {
                        for (const i in part) {
                            config.push(part[i].trim());
                        }
                    }
                    config.length && logInfo(fn, '> ' + obj.common.name + ' - ' + id + ' (' + config + ')');
                    cb && cb();
                } else {
                    cb && cb();
                }
            });
        }
    });
}
//STEP 05
function getDebug(ff, cb) {
    let fn = ff + '[getDebug] ';
    logDebug(fn, '', 'start', 'D');
    if (!firstRun)
        logInfo(fn, 'CHANGE debug ===== check ' + adapter.namespace + '.' + 'info.Debug - Activate Debug-Mode for channel(s)');
    debugNAME = [];
    adapter.getState('info.Debug.activate', (e, state) => {
        e && logError(fn, e);
        if (state) {
            const part = state.val.split(",");
            if (part[0]) {
                for (const i in part) {
                    debugNAME.push(part[i].trim());
                }
            }
            if (debugNAME.length) {
                logInfo(fn, '> ' + adapter.namespace + '.' + 'info.Debug.activate' + ' = ' + debugNAME);
            } else {
                logInfo(fn, '> no sync - ' + adapter.namespace + '.' + 'info.Debug.activate');
            }
            logDebug(fn, '', fn + 'with obj - end', 'D');
            cb && cb();
        } else {
            logDebug(fn, '', fn + 'end', 'D');
            cb && cb();
        }
    });
}
//STEP 06
function checkSubscribe(ff, cb) {
    let fn = ff + '[checkSubscribe] ';
    logDebug(fn, '', 'start', 'D');
    if (!allowedIOBin.length) {
        logInfo(fn, '> no sync - ' + adapter.namespace + '.info.Configurations.allowedIOBin');
        adapter.setState('info.Info.numberObjectsIOBoutSub', 0, true);
        cb && cb();
        return;
    }
    let end = 0;
    allowedIOBin.forEach(search => {
        adapter.getForeignStates(search + '*', (e, states) => {
            if (e) {
                logError(fn, 'error: ' + e);
            } else {
                logDebug(fn, '', fn + 'detected' + JSON.stringify(states), 'D');
                logInfo(fn, '> detected ' + Object.keys(states).length + ' state(s) of "' + search + '"');
                for (const id in states) {
                    if (!states.hasOwnProperty(id)) {
                        continue;
                    }
                    //30.01.21
                    let foundEx = false;
                    let end1 = 0;
                    if (!allowedIOBinExclude.length)
                        allowedIOBinExclude = ['?'];
                    allowedIOBinExclude.forEach(searchEx => {
                        if (id.startsWith(searchEx)) {
                            logInfo(fn, '>> excluded ' + id);
                            foundEx = true;
                        }
                        end1++;
                        if (end1 === allowedIOBinExclude.length && !foundEx) {
                            let idFHEM = convertNameIob(fn, id);
                            let val;
                            try {
                                val = states[id].val;
                            } catch (e) {
                                val = '???';
                            }
                            fhemINs[idFHEM] = {
                                id: id,
                                val: val
                            };
                            fhemIgnore[idFHEM] = {id: id};
                            logDebug(fn, '', fn + 'found ' + id, '');
                            foundEx = false;
                            end1 = 0;
                        }
                    });
                }
                end++;
                if (end === allowedIOBin.length) {
                    adapter.setState('info.Info.numberObjectsIOBoutSub', Object.keys(fhemINs).length, true);
                    logDebug(fn, '', 'end', 'D');
                    cb && cb();
                }
            }
        });
    });
}
// STEP 07-09
function syncFHEM(ff, cb) {
    let fn = ff + '[syncFHEM] ';
    logDebug(fn, '', 'start', 'D');
    let send = 'jsonlist2';
    if (onlySyncNAME.length) {
        send = send + ' ' + onlySyncNAME + ',' + adapter.namespce + '.send2ioB';
        logInfo(fn, '> only jsonlist2 ' + onlySyncNAME + ' - ' + adapter.namespace + '.info.Configurations.onlySyncNAME (' + onlySyncNAME + ')');
    }
    if (!connected) {
        logInfo(fn, '> Connected FHEM telnet ' + adapter.config.host + ':' + adapter.config.port + ' - send telnet "' + send + '"');
        connected = true;
        adapter.setState('info.connection', true, true);
    }
    telnetOut.send(send, (e, result) => {
        e && logError(fn, 'telnetOut.send: ' + e);
        if (result) {
            logInfo(fn, '> result of jsonlist2 OK');
            let objects = null;
            try {
                objects = JSON.parse(result);
            } catch (e) {
                if (e.name === 'SyntaxError' && e.message.startsWith('Unexpected token')) {
                    let stelle = Number(e.message.replace(/[^0-9]/g, ""));
                    let stelleN = result.lastIndexOf('NAME', stelle);
                    let stelleName = result.indexOf(',', stelleN);
                    logError(fn, '> SyntaxError jsonlist2 of FHEM device ' + result.substr(stelleN, stelleName - stelleN) + ' --> stop instance ' + adapter.namespace);
                    let stelleE = result.indexOf('Name', stelleN);
                    adapter.log.debug(fn + 'SyntaxError: ' + result.substr(stelleN, stelleE - stelleN));
                } else {
                    logError(fn, 'Cannot parse answer for jsonlist2: ' + e);
                }
                if (firstRun)
                    adapter.setForeignState('system.adapter.fhem.1.alive', false, false);
            }
            if (objects) {
                logInfo(fn, '> get ' + objects.Results.length + ' Device(s) of FHEM');
                if (connected) {
                    parseObjects(fn, objects.Results, () => {
                        logDebug(fn, '', fn + 'end', 'D');
                        cb && cb();
                    });
                } else {
                    cb && cb();
                }
            } else {
                logDebug(fn, '', fn + 'no objects - end', 'D');
                cb && cb();
            }
        } else {
            logDebug(fn, '', fn + 'no result - end', 'D');
            cb && cb();
        }
    });
}
function parseObjects(ff, objs, cb) {
    let fn = ff + '[parseObjects] ';
    logDebug(fn, '', 'start', 'D');
    const rooms = {};
    const objects = [];
    const states = [];
    let id;
    let obj;
    let alias;
    let suche = 'no';
    let text;
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
                            adapter.log.debug(fn + 'detected room ' + onlySyncRoom + ' / ' + i + ' > iobroker=true');
                            iobroker = true;
                        }
                    }
                }
            } catch (e) {
                logError(fn, 'Cannot check room of object: ' + JSON.stringify(objs[i]) + ' ' + e);
            }
        }
        adapter.setState('info.Info.numberDevicesFHEM', objs.length, true);
        firstRun && logInfo(fn, 'STEP 08 ===== parse Objects - check ' + objs.length + ' Device(s) of FHEM detected');
        adapter.setState('info.Info.roomioBroker', iobroker, true);
        iobroker && logInfo(fn, '> only sync device(s) from room(s) = ' + onlySyncRoom + ' - ' + adapter.namespace + '.info.Info.roomioBroker (' + iobroker + ')');
        onlySyncNAME.length && logInfo(fn, '> only sync device(s) = ' + onlySyncNAME + ' - ' + adapter.namespace + '.info.Configurations.onlySyncNAME (' + onlySyncNAME + ')');
        ignoreObjectsAttributesRoom.length && logInfo(fn, '> no sync device(s) of room(s) = ' + ignoreObjectsAttributesRoom + ' - ' + adapter.namespace + '.info.Configurations.ignoreObjectsAttributesroom (' + ignoreObjectsAttributesRoom + ')');
        ignoreObjectsInternalsNAME.length && logInfo(fn, '> no sync device(s) with Internals:NAME = ' + ignoreObjectsInternalsNAME + ' - ' + adapter.namespace + '.info.Configurations.ignoreObjectsInternalsNAME (' + ignoreObjectsInternalsNAME + ')');
        ignoreObjectsInternalsTYPE.length && logInfo(fn, '> no sync device(s) with Internals:TYPE = ' + ignoreObjectsInternalsTYPE + ' - ' + adapter.namespace + '.info.Configurations.ignoreObjectsInternalsTYPE (' + ignoreObjectsInternalsTYPE + ')');
    }
    for (let i = 0; i < objs.length; i++) {
        const device = objs[i].Name;
        const debugN = device + ' | ';
        if (!connected) {
            (cb);
            return;
        }
        try {
// Auto-created by ioBroker ?
            if (objs[i].Attributes.comment && objs[i].Attributes.comment.startsWith('Auto-created by ioBroker fhem')) {
                // nicht eigene Instanz?
                if (objs[i].Attributes.comment.indexOf('Auto-created by ioBroker ' + adapter.namespace)) {
                    fhemIgnore[device] = {id: device};
                    fhemIgnoreConfig[device] = {id: device};
                    logIgnoreConfig(fn, device, 'comment: ' + objs[i].Attributes.comment, i, objs.length);
                    continue;
                }
                if (!fhemINs[device] && objs[i].Attributes.room.startsWith('ioB_IN')) {
                    logIgnoreConfig(fn, device, 'comment: ' + objs[i].Attributes.comment, i, objs.length);
                    sendFHEM(fn, 'delete ' + device);
                    continue;
                }
                if (fhemINs[device] && objs[i].Attributes.room.startsWith('ioB_IN')) {
                    fhemIN[device] = {id: device};
                    fhemIgnore[device] = {id: device};
                    logIgnoreConfig(fn, device, 'comment: ' + objs[i].Attributes.comment, i, objs.length);
                    continue;
                }
                if (device.indexOf('alive') !== -1) {
                    fhemIgnore[device] = {id: device};
                    logIgnoreConfig(fn, device, 'comment: ' + objs[i].Attributes.comment, i, objs.length);
                    continue;
                }
                if (device.indexOf('send2ioB') !== -1) {
                    fhemIgnore[device] = {id: device};
                    logIgnoreConfig(fn, device, 'comment: ' + objs[i].Attributes.comment, i, objs.length);
                    continue;
                }
            }
            if (objs[i].Attributes && iobroker) {
                if (!objs[i].Attributes.room) {
                    logIgnoreConfig(fn, device, 'no room, iobroker=true', i, objs.length);
                    continue;
                } else {
                    let weiter = true;
                    let searchRoom = objs[i].Attributes.room.split(',');
                    for (const r in searchRoom) {
                        if (onlySyncRoom.indexOf(searchRoom[r]) !== -1 || searchRoom[r] === 'ioB_System') {
                            logDebug(fn, device, 'detected room ' + searchRoom[r] + '/' + r + ' of FHEM device "' + device + '"', 'D');
                            weiter = false;
                        }
                    }
                    if (weiter && !synchro) {
                        unusedObjects(fn, convertNameFHEM(fn, device) + '.*', cb);
                    }
                    if (weiter) {
                        logIgnoreConfig(fn, device, 'room <> ' + onlySyncRoom, i, objs.length);
                        continue;
                    }
                }
            }
            if (onlySyncNAME.length && onlySyncNAME.indexOf(objs[i].Internals.NAME) === -1) {
                logIgnoreConfig(fn, device, 'NAME <> ' + onlySyncNAME, i, objs.length);
                continue;
            }
            if (onlySyncTYPE.length && onlySyncTYPE.indexOf(objs[i].Internals.TYPE) === -1) {
                logIgnoreConfig(fn, device, 'TYPE <> ' + onlySyncTYPE, i, objs.length);
                continue;
            }
            if (ignoreObjectsInternalsTYPE.indexOf(objs[i].Internals.TYPE) !== -1) {
                logIgnoreConfig(fn, device, 'TYPE: ' + ignoreObjectsInternalsTYPE, i, objs.length);
                continue;
            }
            if (ignoreObjectsInternalsNAME.indexOf(objs[i].Internals.NAME) !== -1) {
                logIgnoreConfig(fn, device, 'NAME: ' + ignoreObjectsInternalsNAME, i, objs.length);
                continue;
            }
            if (ignoreObjectsAttributesRoom.indexOf(objs[i].Attributes.room) !== -1) {
                logIgnoreConfig(fn, device, 'room: ' + ignoreObjectsAttributesRoom, i, objs.length);
                continue;
            }
            if (objs[i].Attributes && objs[i].Attributes.room === 'hidden') {
                logIgnoreConfig(fn, device, 'room: hidden', i, objs.length);
                continue;
            }
            logDebug(fn, device, 'detected FHEM device "' + device + '" to sync', 'D');
            let isOn = false;
            let isOff = false;
            let setStates = {};
            let Funktion = 'no';
            let id;
            const nameIob = convertNameFHEM(fn, device);
            const channel = adapter.namespace + '.' + nameIob;
            //alias?
            if (objs[i].Attributes && objs[i].Attributes.alias) {
                alias = objs[i].Attributes.alias;
            } else {
                alias = device;
            }
            obj = {
                _id: channel,
                type: 'channel',
                common: {
                    name: alias
                },
                native: objs[i]
            };
            if (objs[i].Internals.TYPE === 'HUEBridge') {
                if (!objs[i].Attributes.createGroupReadings) {
                    sendFHEM(fn, 'attr ' + device + ' createGroupReadings 1', 'TYPE:HUEBridge');
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
                    sendFHEM(fn, 'attr ' + device + ' generateVolumeEvent 1', 'TYPE:SONOSPLAYER');
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
// Functions
            if (Funktion !== 'no' && autoFunction && objs[i].Attributes.room) {
//setFunction(channel, Funktion, nameIob);
                setFunction(channel, Funktion);
            }
            objects.push(obj);
            text = 'check channel ' + channel + ' | name: ' + alias + ' | room: ' + objs[i].Attributes.room + ' | role: ' + obj.common.role + ' | function: ' + Funktion + ' | ' + ' ' + (i + 1) + '/' + objs.length;
            if (logCheckObject && debugNAME.indexOf(device) === -1) {
                logInfo(fn, text);
            } else {
                logDebug(fn, device, text, '');
            }
// Rooms
            if (objs[i].Attributes && objs[i].Attributes.room && autoRoom) {
                const rrr = objs[i].Attributes.room.split(',');
                for (let r = 0; r < rrr.length; r++) {
                    rrr[r] = rrr[r].trim();
                    rooms[rrr[r]] = rooms[rrr[r]] || [];
                    rooms[rrr[r]].push(channel);
                }
            }
// Attributes
            if (objs[i].Attributes) {
                (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' > check Attributes');
                if (!objs[i].Attributes.alias) {
                    adapter.log.debug('check alias of ' + device + ' > not detected! set alias automatically in FHEM');
                    sendFHEM(fn, 'attr ' + device + ' alias ' + device);
                }
                for (const attr in objs[i].Attributes) {
// allowed Attributes?
                    if (allowedAttributes.indexOf(attr) === -1) {
                        (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.warn(debugN + ' >> ' + attr + ' = ' + objs[i].Attributes[attr] + ' > no sync - not included in ' + adapter.namespace + '.info.Config.allowedAttributes');
                        continue;
                    }
                    const val = objs[i].Attributes[attr];
                    obj = {
                        _id: channel + '.' + 'Attributes.' + convertNameFHEM(fn, attr),
                        type: 'state',
                        common: {
                            name: alias + ' ' + attr,
                            type: 'string',
                            role: 'text',
                            read: true,
                            write: true
                        },
                        native: {
                            Name: device,
                            Attribute: attr,
                            Attributes: true
                        }
                    };
                    (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Attributes[attr] + ' > ' + obj._id + ' = ' + val + ' | type: ' + obj.common.type + ' | read: ' + obj.common.read + ' | write: ' + obj.common.write + ' | role: ' + obj.common.role);
                    objects.push(obj);
                    states.push({
                        id: obj._id,
                        val: val,
                        ts: Date.now(),
                        ack: true
                    });
                }
            }
// Internals
            if (objs[i].Internals) {
                (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' > check Internals');
                for (const attr in objs[i].Internals) {
// allowed Internals?
                    if (!objs[i].Internals.hasOwnProperty(attr) || allowedInternals.indexOf(attr) === -1) {
                        (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.warn(debugN + ' >> ' + attr + ' = ' + objs[i].Internals[attr] + ' > no sync - not included in ' + adapter.namespace + '.info.Config.allowedInternals');
                        continue;
                    }
                    const val = objs[i].Internals[attr];
                    obj = {
                        _id: channel + '.' + 'Internals.' + convertNameFHEM(fn, attr),
                        type: 'state',
                        common: {
                            name: alias + ' ' + attr,
                            type: 'string',
                            role: 'text',
                            read: true,
                            write: false
                        },
                        native: {
                            Name: device,
                            Attribute: attr,
                            Internals: true
                        }
                    };
                    (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Internals[attr] + ' > ' + obj._id + ' = ' + val + ' | type: ' + obj.common.type + ' | read: ' + obj.common.read + ' | role: ' + obj.common.role);
                    objects.push(obj);
                    states.push({
                        id: obj._id,
                        val: val,
                        ts: Date.now(),
                        ack: true
                    });
                }
            }
// Possible Sets
            if (objs[i].PossibleSets && objs[i].PossibleSets.length > 1) {
                (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' > check PossibleSets');
                const attrs = objs[i].PossibleSets.split(' ');
                for (let a = 0; a < attrs.length; a++) {
                    if (!attrs[a]) {
                        continue;
                    }
                    const parts = attrs[a].split(':');
                    let Cstates = true;
                    // ignore PossibleSets
                    if (ignorePossibleSets.indexOf(parts[0]) !== -1) {
                        (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.warn(debugN + ' >> ' + parts[0] + ' > no sync - included in ' + adapter.namespace + '.info.Config.ignorePossibleSets');
                        continue;
                    }
                    const stateName = convertNameFHEM(fn, parts[0]); //KNX
                    if (parts[0] === 'off')
                        isOff = true;
                    if (parts[0] === 'on')
                        isOn = true;
                    obj = {
                        _id: channel + '.' + stateName,
                        type: 'state',
                        common: {
                            name: alias + ' ' + parts[0],
                            type: 'string',
                            role: 'state',
                            read: false,
                            write: true
                        },
                        native: {
                            Name: device,
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
                                'de': alias,
                                'smartType': 'THERMOSTAT'
                            };
                        }
                    }
                    if (dimPossibleSets.indexOf(parts[0]) !== -1) {
                        let typ = 'LIGHT';
                        Cstates = false;
                        obj.common.role = 'level.dimmer';
                        obj.common.unit = '%';
                        obj.native.level_dimmer = true;
                        if (objs[i].Attributes.subType === 'blindActuator') {
                            obj.common.role = 'level.blind';
                            obj.native.level_blind = true;
                            typ = 'kein Typ';
                        }
                        if (adapter.namespace === 'fhem.0' && objs[i].Attributes.room) {
                            obj.common.smartName = {
                                'de': alias,
                                'smartType': typ
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
                                'de': alias,
                                'smartType': 'LIGHT'
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
                                'de': alias,
                                'smartType': 'LIGHT'
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
                    (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + parts[0] + ' = ' + parts[1] + ' > ' + obj._id + ' | type: ' + obj.common.type + ' | write: ' + obj.common.write + ' | role: ' + obj.common.role + ' | min: ' + obj.common.min + ' | max: ' + obj.common.max + ' | unit: ' + obj.common.unit + ' | states: ' + JSON.stringify(obj.common.states));
                    let found = false;
                    for (const attr in objs[i].Readings) {
                        if (!objs[i].Readings.hasOwnProperty(attr)) {
                            continue;
                        }
                        if (stateName === attr) {
                            found = true;
                            setStates[stateName] = obj;
                            continue;
                        }
                    }
                    if (!found) {
                        objects.push(obj);
                        states.push({
                            id: obj._id,
                            val: '.',
                            ts: Date.now(),
                            ack: true
                        });
                    }
                }
            }
// Readings
            if (objs[i].Readings) {
                (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' > check Readings');
                for (const attr in objs[i].Readings) {
                    if (!objs[i].Readings.hasOwnProperty(attr)) {
                        continue;
                    }
// ignore Readings ?
                    if (ignoreReadings.indexOf(attr) !== -1) {
                        (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.warn(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value + ' > no sync - included in ' + adapter.namespace + '.info.Config.ignoreReadings');
                        continue;
                    }
                    const stateName = convertNameFHEM(fn, attr);
                    // PossibleSets?
                    let combined = false;
                    if (setStates[stateName]) {
                        combined = true;
                        obj = setStates[stateName];
                        obj.common.read = true;
                        obj.native.Readings = true;
                    } else {
                        obj = {
                            _id: channel + '.' + stateName,
                            type: 'state',
                            common: {
                                name: alias + ' ' + attr,
                                type: undefined,
                                role: undefined,
                                read: true,
                                write: false,
                                // Unit nach attr
                                unit: getUnit(attr)
                            },
                            native: {
                                Name: device,
                                Attribute: attr,
                                Readings: true
                            },
                            value: {
                                val: objs[i].Readings[attr].Value
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
                            //
                            val = convertAttr(attr, val);
                        }
                        obj.common.type = obj.common.type || typeof val;
                        if (obj.common.type === 'number') {
                            obj.common.role = obj.common.role || 'value';
                        } else if (obj.common.type === 'boolean') {
//obj.common.role = obj.common.role || 'text';
                            //adapter.log.warn('found boolean?');
                        } else if (obj.common.type === 'object') {
//obj.common.role = obj.common.role || 'text';
                            adapter.log.warn('found object?');
                            //} else if (obj.common.type === 'string' && !obj.common.role) {
                        } else if (obj.common.type === 'string') {
                            obj.common.role = obj.common.role || 'text';
                            if (!obj.common.states) {
                                const checkUnit = val.split(' ');
                                if (Number(checkUnit[0]) > 0 && checkUnit[1] && !checkUnit[2]) {
                                    if ('C °C kWh kW lh W V % km hPa mins min s'.indexOf(checkUnit[1]) !== -1) {
                                        if (checkUnit[1] === 'C')
                                            checkUnit[1] = '°C';
                                        val = checkUnit[0];
                                        obj.common.unit = checkUnit[1];
                                    } else {
                                        adapter.log.warn(val + ' Unit: ' + checkUnit[1] + ' not found indexoF!');
                                    }
                                }
                            }
                        } else {
                            adapter.log.warn('obj.common.role ' + obj.common.role + ' not found!');
                        }
                        //
                        if (obj.common.unit && !combined) {
                            obj.common.type = 'number';
                            if (obj.common.unit === '°C') {
                                obj.common.role = 'value.temperature';
                                Funktion = 'temperature';
                            } else if (obj.common.unit === 'kWh' || obj.common.unit === 'kW') {
                                obj.common.role = 'value.power.consumption';
                            } else if (obj.common.unit === 'V') {
                                obj.common.role = 'value.voltage';
                            } else if (obj.common.unit === 'W') {
                                obj.common.role = 'value.power';
                            } else if (obj.common.unit === 'Wh') {
                                obj.common.role = 'value.energie';
                            } else if (obj.common.unit === 'lh') {
                                obj.common.role = 'value.flow';
                            } else if (obj.common.unit === '%') {
                                if (attr.indexOf('humidity') !== -1) {
                                    obj.common.role = 'value.humidity';
                                } else if (attr.indexOf('battery') !== -1) {
                                    obj.common.role = 'battery.percent';
                                } else {
                                    obj.common.role = 'value.percent';
                                }
                            } else if (obj.common.unit === 'km') {
                                obj.common.role = 'value.distance';
                            } else if (obj.common.unit === 'kmh') {
                                obj.common.role = 'value.speed';
                            } else if (obj.common.unit === 'hPa') {
                                obj.common.role = 'value.pressure';
                            } else if (obj.common.unit === 's' | obj.common.unit === 'min' || obj.common.unit === 'mins') {
                                obj.common.role = 'value.duration';
                            } else {
                                adapter.log.warn(val + ' Unit: ' + obj.common.unit + ' not found!');
                            }
                        }

// detect indicator
                        if (Rindicator.indexOf(attr) !== -1) {
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
                            if (attr === 'battery' || attr === 'batteryState')
                                obj.common.role = 'indicator.lowbat';
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
                            // detect on and off or KNX or dummy (create state_switch)
                            if (isOff && isOn || objs[i].Internals.TYPE === 'KNX' || objs[i].Internals.TYPE === 'dummy' && (val === 'on' || val === 'off')) {
                                obj.native.onoff = true;
                                Funktion = 'switch';
                                let obj_switch = {
                                    _id: channel + '.state_switch',
                                    type: 'state',
                                    common: {
                                        name: alias + ' ' + 'state_switch',
                                        type: 'boolean',
                                        role: 'switch',
                                        read: true,
                                        write: true
                                    },
                                    native: {
                                        Name: device,
                                        Attribute: 'state'
                                    }
                                };
                                //Schaltaktor aus FHEM in Cloud-Adapter hinzufügen
                                if (adapter.namespace === 'fhem.0' && objs[i].Attributes.room) {
                                    obj_switch.common.smartName = {
                                        'de': alias,
                                        'smartType': 'SWITCH'
                                    };
                                }
                                if (objs[i].Internals.TYPE === 'HUEDevice' && objs[i].Attributes.subType !== 'switch') {
                                    obj_switch.common.role = 'switch.light';
                                }
                                let valSwitch = val;
                                if (!oldState) {
                                    valSwitch = convertFhemValue(val);
                                }
                                (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value + ' > ' + obj_switch._id + ' = ' + valSwitch + ' | type: ' + obj_switch.common.type + ' | read: ' + obj_switch.common.read + ' | write: ' + obj_switch.common.write + ' | role: ' + obj_switch.common.role + ' | Funktion: ' + Funktion);
                                objects.push(obj_switch);
                                states.push({
                                    id: obj_switch._id,
                                    val: valSwitch,
                                    ts: objs[i].Readings[attr].Time ? new Date(objs[i].Readings[attr].Time).getTime() : Date.now(),
                                    ack: true
                                });
                            }
// sensor?
                            let type = objs[i].Internals.TYPE;
                            const sensor = convertFhemSensor(fn, valOrg, device, type);
                            if ((typeof (sensor[0]) === "boolean" || objs[i].Attributes.subType === 'motionDetector')) {
                                logDebug(fn, device, 'detect sensor - ' + device, 'D');
                                Funktion = 'sensor';
                                obj.common.write = false;
                                if (alias.toLowerCase().indexOf('tür') !== -1 || alias.toLowerCase().indexOf('tuer') !== -1 || alias.toLowerCase().indexOf('door') !== -1)
                                    sensor[1] = 'sensor.door';
                                if (alias.toLowerCase().indexOf('fenster') !== -1 || alias.toLowerCase().indexOf('window') !== -1)
                                    sensor[1] = 'sensor.window';
                                if (objs[i].Attributes.subType === 'motionDetector') {
                                    sensor[1] = 'sensor.motion';
                                }
                                if (sensor[1] === 'sensor')
                                    firstRun && logWarn(fn, 'detect sensor "' + device + '" - for full function of sensor use door,window,Tür,Tuer,Fenster in alias of device');
                                obj.native.StateBoolean = true;
                                let obj_sensor = {
                                    _id: channel + '.state_boolean',
                                    type: 'state',
                                    common: {
                                        name: alias + ' ' + 'state_boolean',
                                        type: 'boolean',
                                        role: sensor[1],
                                        read: true,
                                        write: false
                                    },
                                    native: {
                                        Name: device,
                                        Attribute: 'state_boolean'
                                    }
                                };
                                (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value + ' > ' + obj_sensor._id + ' = ' + sensor[0] + ' | type: ' + obj_sensor.common.type + ' | read: ' + obj_sensor.common.read + ' | write: ' + obj_sensor.common.write + ' | role: ' + obj_sensor.common.role + ' | Funktion: ' + Funktion);
                                objects.push(obj_sensor);
                                states.push({
                                    id: obj_sensor._id,
                                    val: sensor[0],
                                    ts: Date.now(),
                                    ack: true
                                });
                            }
// create state_value
                            if (typeof (sensor[3]) === "number") {
                                obj.native.StateValue = true;
                                let obj_sensor = {
                                    _id: channel + '.state_value',
                                    type: 'state',
                                    common: {
                                        name: alias + ' ' + 'state_value',
                                        type: 'number',
                                        role: sensor[2],
                                        read: true,
                                        write: false
                                    },
                                    native: {
                                        Name: device,
                                        Attribute: 'state_value'
                                    }
                                };
                                (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value + ' > ' + obj_sensor._id + ' = ' + sensor[3] + ' | type: ' + obj_sensor.common.type + ' | read: ' + obj_sensor.common.read + ' | write: ' + obj_sensor.common.write + ' | role: ' + obj_sensor.common.role + ' | Funktion: ' + Funktion);
                                objects.push(obj_sensor);
                                states.push({
                                    id: obj_sensor._id,
                                    val: sensor[3],
                                    ts: Date.now(),
                                    ack: true
                                });
                            }
// create media.state
                            if (objs[i].Internals.TYPE === 'SONOSPLAYER') {
                                obj.native.media = true;
                                let valMedia = false;
                                if (val === 'PLAYING') {
                                    valMedia = true;
                                }
                                let obj_media = {
                                    _id: channel + '.state_media',
                                    type: 'state',
                                    common: {
                                        name: alias + ' ' + 'state_media',
                                        type: 'boolean',
                                        role: 'media.state',
                                        read: true,
                                        write: false
                                    },
                                    native: {
                                        Name: device,
                                        Attribute: 'state_media'
                                    }
                                };
                                (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value + ' > ' + obj_media._id + ' = ' + valMedia + ' | type: ' + obj_media.common.type + ' | read: ' + obj_media.common.read + ' | write: ' + obj_media.common.write + ' | role: ' + obj_media.common.role + ' | Funktion: ' + Funktion);
                                objects.push(obj_media);
                                states.push({
                                    id: obj_media._id,
                                    val: valMedia,
                                    ts: objs[i].Readings[attr].Time ? new Date(objs[i].Readings[attr].Time).getTime() : Date.now(),
                                    ack: true
                                });
                            }
                        }
// detect readingList
                        if (objs[i].Attributes.readingList && objs[i].Attributes.readingList.indexOf(attr) !== -1) {
                            adapter.log.debug(fn + 'detect readingList - ' + objs[i].Internals.TYPE + ' ' + device + ' ' + attr + ' ' + val);
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
                        combined && (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value.replace(/\n|\r/g, '\u005cn') + ' > ' + obj._id + ' = ' + val.toString().replace(/\n|\r/g, '\u005cn') + ' | read: ' + obj.common.read + ' | write: ' + obj.common.write + ' (Value Possible Set)');
                        !combined && (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' >> ' + attr + ' = ' + objs[i].Readings[attr].Value.replace(/\n|\r/g, '\u005cn') + ' > ' + obj._id + ' = ' + val.toString().replace(/\n|\r/g, '\u005cn') + ' | type: ' + obj.common.type + ' | read: ' + obj.common.read + ' | write: ' + obj.common.write + ' | role: ' + obj.common.role + ' | Funktion: ' + Funktion);

                        //neuif (isNaN(timestamp) === false)
                        /*
                         if (obj.common.type === 'string' && obj.common.role === 'text' && isNaN(Date.parse(val))=== false) {
                         adapter.log.warn('Datum ' + obj.common.name  );
                         obj.common.role = 'date';
                         }
                         */
                        obj.native.type = obj.common.type;
                        obj.native.role = obj.common.role;
                        obj.native.unit = obj.common.unit;

                        objects.push(obj);
                        if (Funktion !== 'no' && autoFunction && objs[i].Attributes.room) {
                            id = obj._id;
                            if (Funktion === 'switch')
                                id = channel;
                            if (Funktion === 'switch' && objs[i].Internals.TYPE === 'HUEDevice')
                                id = channel + '.state_switch';
                            if (Funktion === 'sensor')
                                id = channel + '.state_boolean';
                            //noch ändern
                            adapter.log.debug(fn + 'Funktion: ' + Funktion + ' für ' + id);
                            setFunction(id, Funktion);
                        }
                    }
                }
                delete objs[i].Readings;
            }
            setStates = null;
            (debugNAME.indexOf(device) !== -1 || debug) && adapter.log.info(debugN + ' check channel ' + channel + ' finished!');
        } catch (e) {
            logError(fn, 'Cannot process object: ' + JSON.stringify(objs[i]) + ' ' + e);
            (cb);
            return;
        }
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
    adapter.setState('info.Info.numberDevicesFHEMignored', Object.keys(fhemIgnore).length, true);
    if (firstRun) {
        adapter.setState('info.Info.numberObjectsIOBout', Object.keys(fhemIN).length, true);
        logInfo(fn, '> detected ' + Object.keys(fhemIN).length + ' objects to send FHEM (ioBout)');
        adapter.setState('info.Info.numberDevicesFHEMsync', channel, true);
        logInfo(fn, '> check channel - ' + channel + ' Device(s) of FHEM synchronized');
        logInfo(fn, 'STEP 09 ===== Synchro objects, rooms, functions, states');
    }
    firstRun && logInfo(fn, '> check update/create ' + objects.length + ' object(s) / ' + channel + ' channel(s) ' + ' and ' + state + ' state(s)');
    syncObjects(objects, () => {
        text = adapter.namespace + '.info.Configurations.autoRoom (' + autoRoom + ')';
        if (!autoRoom) {
            logInfo(fn, '> no auto create of room(s) - ' + text);
        } else {
            firstRun && logInfo(fn, '> check update/create ' + Object.keys(rooms).length + ' room(s) - ' + text);
        }
        syncRooms(rooms, () => {
            text = adapter.namespace + '.info.Configurations.autoFunction (' + autoFunction + ')';
            if (!autoFunction) {
                firstRun && logInfo(fn, '> no auto create of function(s) - ' + text);
            } else {
                firstRun && logInfo(fn, '> check update/create ' + Object.keys(functions).length + ' function(s) - ' + text);
            }
            syncFunctions(functions, () => {
                firstRun && logInfo(fn, '> check update/create ' + state + ' state(s) / ' + states.length + ' state(s) to sync');
                if (state !== states.length)
                    logWarn(fn, 'object state(s) <> state(s) to sync');
                syncStates(states, () => {
                    debug = false; // hier syncIOBin dazu toDO
                    cb();
                });
            });
        });
    });
}
//
function logIgnoreConfig(ff, name, text, nr, from) {
    let fn = ff + '[logIgnoreConfig] ';
    if (!fhemIgnore[name]) {
        fhemIgnoreConfig[name] = {id: name};
    }
    text = 'ignored FHEM device "' + name + '" > no sync - ' + text + ' | ' + ' ' + (nr + 1) + '/' + from;
    if (logIgnoreConfigurations && debugNAME.indexOf(name) === -1) {
        adapter.log.info(text);
    } else {
        logDebug(fn, name, text);
    }
}
function syncObjects(objects, cb) {
    try {
        let fn = '[syncObjects] ';
        if (!objects || !objects.length) {
            logDebug(fn, '', fn + 'end', 'D');
            adapter.setState('info.Info.numberObjectsIOBin', Object.keys(fhemObjects).length, true);
            cb();
            return;
        }
        if (!connected) {
            cb();
            return;
        }
        const obj = objects.shift();
        fhemObjects[obj._id] = obj;
        const parts = obj._id.split('.');
        adapter.getForeignObject(obj._id, (e, oldObj) => {
            if (e) {
                adapter.log.warn('syncObjects (getF) ' + e);
                cb();
                return;
            }
            if (!oldObj) {
                if (obj.type === 'channel' && logCreateChannel) {
                    logInfo(fn, 'Create channel: ' + obj.common.name + ' | ' + obj._id);
                } else {
                    logDebug(fn, obj._id, 'create object: ' + obj._id + ' (' + obj.type + ')', '');
                }
                adapter.setForeignObject(obj._id, obj, e => {
                    e && logError(fn, e);
                    setImmediate(syncObjects, objects, cb);
                });
            } else {
                if (JSON.stringify(obj.native) === JSON.stringify(oldObj.native) && JSON.stringify(obj.common) === JSON.stringify(oldObj.common)) {
                    logDebug(fn, obj._id, 'check object: ' + obj._id + ' (' + obj.type + ') OK 1', 'D');
                    setImmediate(syncObjects, objects, cb);
                } else {
                    let newObj = JSON.parse(JSON.stringify(oldObj));
                    let text;
                    if (JSON.stringify(obj.native) !== JSON.stringify(newObj.native)) {
                        newObj.native = obj.native;
                        text = 'native';
                    }
                    if (JSON.stringify(obj.common) !== JSON.stringify(newObj.common)) {
                        if (autoSmartName) {
                            newObj.common.smartName = obj.common.smartName;
                        }
                        if (autoRole) {
                            newObj.common.role = obj.common.role;
                        }
                        if (autoName || newObj.type === 'channel') {
                            newObj.common.name = obj.common.name;
                        }
                        if (autoType) {
                            newObj.common.type = obj.common.type;
                        }
                        if (autoStates) {
                            newObj.common.states = obj.common.states;
                        }
                        if (autoRest) {
                            newObj.common.min = obj.common.min;
                            newObj.common.max = obj.common.max;
                            newObj.common.unit = obj.common.unit;
                            newObj.common.read = obj.common.read;
                            newObj.common.write = obj.common.write;
                        }
                        if (JSON.stringify(oldObj.common) !== JSON.stringify(newObj.common)) {
                            text = text + ' common';
                        }
                    }
                    if (JSON.stringify(newObj) !== JSON.stringify(oldObj)) {
                        if (obj.type === 'channel' && logUpdateChannel) {
                            logInfo(fn, 'update channel: ' + obj.common.name + ' | ' + obj._id + ' - ' + text);
                        } else {
                            logDebug(fn, obj._id, 'update object: ' + obj._id + ' (' + obj.type + ') - ' + text, '');
                        }
                        adapter.setObject(obj._id, newObj, e => {
                            e && logError(fn, e);
                            setImmediate(syncObjects, objects, cb);
                        });
                    } else {
                        logDebug(fn, obj._id, 'check object: ' + obj._id + ' (' + obj.type + ') OK 2 ', 'D');
                        setImmediate(syncObjects, objects, cb);
                    }
                }
            }
        });
    } catch (e) {
        adapter.log.warn('syncObjects (catch) ' + e);
        cb();
        return;
    }
}
function syncRooms(rooms, cb) {
    for (const r in rooms) {
        if (!rooms.hasOwnProperty(r)) {
            continue;
        }
        if (!connected) {
            cb();
            return;
        }
        if (rooms[r]) {
            syncRoom(r, rooms[r], () => setImmediate(syncRooms, rooms, cb));
            rooms[r] = null;
            return;
        }
    }
    cb && cb();
}
function syncRoom(room, members, cb) {
    adapter.log.debug('[syncRoom] (' + room + ') ' + members);
    adapter.getForeignObject('enum.rooms.' + room, (e, obj) => {
        if (e) {
            logError('[syncRoom] ', e);
            cb();
            return;
        }
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
            adapter.log.debug('create' + obj._id + '"');
            adapter.setForeignObject(obj._id, obj, e => {
                e && logError('[syncRoom] ', e);
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
                adapter.setForeignObject(obj._id, obj, e => {
                    e && logError('[syncRoom] ', e);
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
        if (!connected) {
            cb();
            return;
        }
        if (functions[f]) {
            syncFunction(f, functions[f], () => setImmediate(syncFunctions, functions, cb));
            functions[f] = null;
            return;
        }
    }
    cb && cb();
}
function syncFunction(funktion, members, cb) {
    let fn = '[syncFunction] ';
    adapter.log.debug(fn + '(' + funktion + ') ' + members);
    adapter.getForeignObject('enum.functions.' + funktion, (e, obj) => {
        e && logError(fn, e);
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
            adapter.setForeignObject(obj._id, obj, e => {
                e && logError(fn, e);
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
                adapter.setForeignObject(obj._id, obj, e => {
                    e && logError(fn, e);
                    cb();
                });
            } else {
                cb();
            }
        }
    });
}
function syncStates(states, cb) {
    let fn = '[syncStates] ';
    if (!states || !states.length) {
        adapter.log.debug(fn + 'end');
        cb();
        return;
    }
    if (!connected) {
        cb();
        return;
    }
    const state = states.shift();
    const id = state.id;
    delete state.id;
    adapter.getState(id, (e, stateG) => {
        if (e) {
            logError(fn, 'rs? ' + e);
            cb();
            return;
        }
        if (!stateG || stateG.val != state.val) {
            if (!stateG) {
                logDebug(fn, id, 'create state: ' + id + ' = ' + state.val, '');
            } else {
                logDebug(fn, id, 'update state: ' + id + ' = ' + stateG.val + ' > ' + state.val, '');
            }
            adapter.setState(id, state.val, true, () => {
                setImmediate(syncStates, states, cb);
            });
        } else {
            logDebug(fn, id, 'check state: ' + id + ' = ' + state.val + ' > OK', 'D');
            setImmediate(syncStates, states, cb);
        }
    });
}
function setFunction(id, Funktion) {
    let fff = Funktion.split(',');
    for (let f = 0; f < fff.length; f++) {
        fff[f] = fff[f].trim();
        functions[fff[f]] = functions[fff[f]] || [];
        functions[fff[f]].push(id);
    }
}
//STEP 10
function unusedObjects(ff, check, cb) {
    let fn = ff + '[unusedObjects] ';
    logDebug(fn, '', 'start - ' + check, 'D');
    if (!deleteUnusedObjects) {
        logInfo(fn, '> delete unused objects (' + check + ') > no automatically delete - info.Configurations.deleteUnusedObjecs not true!');
        cb && cb();
        return;
    }
    adapter.getStates(check, (e, states) => {
        if (e) {
            logError(fn, e);
        } else {
            for (const id in states) {
                if (!states.hasOwnProperty(id)) {
                    continue;
                }
                const channelS = id.split('.');
                logDebug(fn, id, 'check ' + id, 'D');
                if (channelS[2] === 'info') {
                    continue;
                }
// readingsGroup?
                if (channelS[3] === 'readingsGroup') {
                    debugNAME.indexOf(channelS[2]) !== -1 && adapter.log.info(channelS[2] + ' | detect "' + id + '" - readingsGroup > no delete');
                    continue;
                }
                if (check !== '*')
                    delete fhemObjects[id];
                if (!fhemObjects[id]) {
                    if (channelS[3] === 'Internals' && channelS[4] === 'TYPE') {
                        delObj.push({
                            command: 'delChannel',
                            name: channelS[2]
                        });
                    }
                    delObj.push({
                        command: 'delState',
                        name: id
                    });
                    delObj.push({
                        command: 'delObject',
                        name: id
                    });
                }
            }
        }
        let channel = 0;
        let state = 0;
        for (let i = 0; i < delObj.length; i++) {
            if (delObj[i].command === 'delChannel') {
                channel = channel + 1;
            }
            if (delObj[i].command === 'delState') {
                state = state + 1;
            }
        }
        firstRun && logInfo(fn, '> delete unused objects (' + check + ') > delete ' + channel + ' channel(s) and ' + state + ' state(s)');
        logDebug(fn, '', '[processDelObj] start', 'D');
        processDelObj(fn, () => {
            logDebug(fn, '', '[processDelObj] end', 'D');
            cb && cb();
        });
    });
}
function processDelObj(ff, cb) {
    let fn = ff + '[processDelObj] ';
    if (!delObj.length) {
        logDebug(fn, '', 'end', 'D');
        cb && cb();
        return;
    }
    const command = delObj.shift();
    logDebug(fn, '', command.command + ' ' + command.name, '');
    if (command.command === 'delObject') {
        deleteObject(fn, command.name, () => setImmediate(processDelObj, ff, cb));
    } else if (command.command === 'delState') {
        deleteState(fn, command.name, () => setImmediate(processDelObj, ff, cb));
    } else if (command.command === 'delChannel') {
        deleteChannel(fn, command.name, () => setImmediate(processDelObj, ff, cb));
    } else {
        logError(fn, 'Unknown task: ' + command.command);
        setImmediate(processDelObj, ff, cb);
    }
}
function deleteObject(ff, name, cb) {
    let fn = ff + '[deleteObject] ';
    adapter.delObject(name, e => {
        if (e) {
            logError(fn, name + ': ' + e);
            cb && cb();
        } else {
            logDebug(fn, name, 'delete object: ' + name, '');
            adapter.setState('info.Info.numberObjectsIOBin', Object.keys(fhemObjects).length, true);
            cb && cb();
        }
    });
}
function deleteState(ff, name, cb) {
    let fn = ff + '[deleteState] ';
    adapter.delState(name, e => {
        if (e) {
            logError(fn, name + ': ' + e);
            cb && cb();
        } else {
            logDebug(fn, name, 'delete state: ' + name, '');
            cb && cb();
        }
    });
}
function deleteChannel(ff, name, cb) {
    let fn = ff + '[deleteChannel] ';
    delete fhemObjects[adapter.namespace + '.' + name];
    adapter.deleteChannel(name, e => {
        if (e) {
            logError(fn, name + ': ' + e);
            cb && cb();
        } else {
            cb && cb();
        }
    });
}
//STEP 11
function syncStatesIOB(cb) {
    let fn = '[syncStatesIOB] ';
    logDebug(fn, '', 'start - ' + Object.keys(fhemINs).length + ' objects of fhemINs', 'D');
    let end = 0;
    if (Object.keys(fhemINs).length) {
        for (const idFHEM in fhemINs) {
            let id = fhemINs[idFHEM].id;
            adapter.getForeignObject(id, (e, Obj) => {
                if (e) {
                    logError(fn, 'error: ' + e);
                }
                if (Obj && Obj.common.name) {
                    let alias = Obj.common.name;
                    let val;
                    adapter.getForeignState(id, (e, state) => {
                        if (e) {
                            logError(fn, 'error: ' + e);
                        } else {
                            adapter.subscribeForeignStates(id);
                            try {
                                val = state.val;
                            } catch (e) {
                                val = '???';
                            }

                            if (fhemIN[idFHEM]) {
                                eventIOB.push({
                                    command: 'writeOut',
                                    id: idFHEM,
                                    val: val,
                                    ts: Date.now()
                                });
                                fhemINs[idFHEM] = {
                                    id: id,
                                    val: val
                                };
                                logDebug(fn, '', 'detected ' + idFHEM + ' > set ' + idFHEM + ' ' + val, '');
                            } else {
                                fhemIN[idFHEM] = {id: id};
                                let group = id.substring(0, id.lastIndexOf('.'));
                                sendFHEM(fn, 'define ' + idFHEM + ' dummy' + ';' + 'attr ' + idFHEM + ' group ' + group + ';' + 'attr ' + idFHEM + ' alias ' + alias + ';' + 'attr ' + idFHEM + ' room ioB_IN' + ';' + 'attr ' + idFHEM + ' comment Auto-created by ioBroker ' + adapter.namespace + ';' + 'set ' + idFHEM + ' ' + val);
                                logInfo(fn, '> create dummy ' + idFHEM + ' / ' + alias);
                            }
                        }
                        end++;
                        if (end === Object.keys(fhemINs).length) {
                            logDebug(fn, '', 'end', 'D');
                            cb();
                        }
                    });
                } else {
                    end++;
                    if (end === Object.keys(fhemINs).length) {
                        logDebug(fn, '', 'end', 'D');
                        cb();
                    }
                }
            });
        }
    } else {
        logInfo(fn, '> room ioB_IN: nothing to do.....');
        cb();
    }
}
//STEP 12
function setAlive() {
    let fn = '[setAlive] ';
    logDebug(fn, '', 'start setAlive 300 sec', '');
    sendFHEM(fn, 'set ' + adapter.namespace + '.alive on-for-timer 360');
    adapter.__timeouts.setAlive = setTimeout(setAlive, 5 * 60000);
}
//STEP 13
function checkQueue(ff) {
    let fn = ff + '[checkQueue] ';
    if (!synchro && !aktivQueue) {
        logDebug(fn, '', 'checkQueue: start', 'D');
        processQueue(fn);
    } else {
        logDebug(fn, '', 'checkQueue: end - aktivQueue = ' + aktivQueue, 'D');
    }
}
function processQueue(ff, cb) {
    try {
        let fn = ff + '[processQueue] ';
        aktivQueue = true;
        if (!eventIOB.length) {
            logDebug(fn, '', 'checkQueue: end - !eventIOB.length', 'D');
            cb && cb();
            aktivQueue = false;
            return;
        }
        if (telnetOut.isCommandRunning()) {
            if (logDevelop & !firstRun)
                adapter.log.warn(fn + 'end - commandRunning events: ' + eventIOB.length);
            cb && cb();
            aktivQueue = false;
            return;
        }
        if (!connected) {
            adapter.log.warn(fn + 'end - Cannot process stateChange, because not connected');
            cb && cb();
            aktivQueue = false;
            return;
        }
        const command = eventIOB.shift();
        if (command.command === 'resync') {
            adapter.log.debug(fn + 'detected Resync FHEM');
            adapter.__timeouts.resyncFHEM = setTimeout(() => {
                adapter.__timeouts.resyncFHEM = null;
                resyncFHEM();
            }, 5000);
        } else if (command.command === 'write') {
            logDebug(fn, command.id, command.command + ' > ' + command.id + ' ' + command.val + ' / todo: ' + eventIOB.length, 'D');
            writeValue(fn, command.id, command.val, command.ts, () => setImmediate(processQueue, ff, cb));
        } else if (command.command === 'writeOut') {
            logDebug(fn, command.id, command.command + ' > ' + command.id + ' ' + command.val + ' / todo: ' + eventIOB.length, 'D');
            writeOut(fn, command.id, command.val, command.ts, () => setImmediate(processQueue, ff, cb));
        } else if (command.command === 'meta') {
            logDebug(fn, command.name, command.command + ' > ' + command.name + ' / todo: ' + eventIOB.length, 'D');
            if (logDevelop & !firstRun)
                adapter.log.warn(command.command + ' > ' + command.name + ' / todo: ' + eventIOB.length);
            requestMeta(fn, command.name, () => setImmediate(processQueue, ff, cb));
        } else {
            logError(fn, 'Unknown task: ' + command.command);
            setImmediate(processQueue, ff, cb);
        }
    } catch (e) {
        adapter.log.warn('processQueue ' + e);
    }
}
function resyncFHEM() {
    let fn = '[resyncFHEM] ';
    adapter.log.debug(fn, 'Start Resync FHEM');
    adapter.setState('info.Info.alive', false, true);
    adapter.setState('info.resync', false, true);
    adapter.restart();
}
function writeValue(ff, id, val, ts, cb) {
    let fn = ff + '[writeValue] ';
    let cmd;
    if (val === undefined || val === null)
        val = '';
    // info ?
    if (id.startsWith(adapter.namespace + '.info.')) {
// info.Info?
        if (id.startsWith(adapter.namespace + '.info.Info')) {
            logDebug(fn, id, 'detect info.Info - ' + id + ' ' + val, 'D');
            logStateChange(fn, id, val, 'writeValue - no match', 'neg');
            cb && cb();
            return;
        }
// info.Commands?
        else if (id.startsWith(adapter.namespace + '.info.Commands')) {      /// prüfen     
            logDebug(fn, id, 'detect info.Commands - ' + id + ' ' + val, 'D');
            // sendFHEM?
            if (id === adapter.namespace + '.info.Commands.sendFHEM') {
                adapter.setState('info.Commands.sendFHEM', val, true, () => {
                    logStateChange(fn, id, val, val, 'pos');
                    telnetOut.send(val, (e, result) => {
                        cb && cb();
                        e && logError(fn, e);
                        adapter.setState('info.Commands.resultFHEM', result.replace(/(\r\n)|(\r)|(\n)/g, '<br>'), true, () => {
                            adapter.setState('info.Commands.lastCommand', val, true, () => {
                                adapter.setState('info.Commands.sendFHEM', 'done', true, () => {
                                });
                            });
                        });
                    });
                });
                // createSwitch?
            } else if (id === adapter.namespace + '.info.Commands.createSwitch') {
                logDebug(fn, id, 'detect info.Commands.createSwitch - ' + id + ' ' + val, 'D');
                let valP = val.split(' ');
                if (valP[0] && valP[1]) {
                    logStateChange(fn, id, val, 'define ' + valP[0] + ' dummy', 'pos');
                    sendFHEM(fn, 'define ' + valP[0] + ' dummy');
                    sendFHEM(fn, 'attr ' + valP[0] + ' room ' + valP[1]);
                    sendFHEM(fn, 'attr ' + valP[0] + ' comment Created by ioBroker ' + adapter.namespace);
                    sendFHEM(fn, 'attr ' + valP[0] + ' setList on:noArg off:noArg');
                    sendFHEM(fn, 'set ' + valP[0] + ' off');
                    setState(fn, 'info.Commands.createSwitch', 'done', true, Date.now(), () => {
                        cb && cb();
                    });
                } else {
                    logStateChange(fn, id, val, 'wrong definition - use NAME room', 'neg');
                    cb && cb();
                }
            } else {
                logStateChange(fn, id, val, 'info.Commands - no match', 'neg');
                cb && cb();
            }
            return;
            // change Debug?
        } else if (id.startsWith(adapter.namespace + '.info.Debug.')) {
            logDebug(fn, id, 'detect info.Debug = ' + id, 'D');
            if (id.indexOf('jsonlist2') !== -1) {
                adapter.log.info('start debug jsonlist2 ' + val);
                let objects = null;
                try {
                    objects = JSON.parse(val);
                } catch (e) {
                    logError(fn, 'Cannot parse answer for ' + adapter.namespace + '.info.Debug.jsonlist2 ' + e);
                }
                if (objects) {
                    debug = true;
                    parseObjects(fn, objects.Results, cb);
                }
                cb && cb();
            } else if (id.indexOf('meta') !== -1) {
                adapter.log.info('start debug meta "jsonlist2 ' + val + '"');
                debug = true;
                doJsonlist(ff, val, cb);
                cb && cb();
            } else if (id.indexOf('activate') !== -1) {
                getDebug(fn, cb);
                cb && cb();
            } else if (id.indexOf('eventIOB') !== -1) {
                adapter.log.warn('eventIOB ?');
                cb && cb();
            } else if (id.indexOf('eventFHEM') !== -1) {
                adapter.log.warn('eventFHEM ?');
                cb && cb();
            } else if (id.indexOf('logDevelop') !== -1) {
                logDevelop = val;
                setState(fn, id, val, true, Date.now());
                cb && cb();
            } else if (id.indexOf('fhemObjectsRead') !== -1) {
                adapter.log.warn(val + ': ' + JSON.stringify(fhemObjects[val]));
                cb && cb();
            } else if (id.indexOf('fhemObjectsRead') !== -1) {
                adapter.log.warn(val + ': ' + JSON.stringify(fhemObjects[val]));
                cb && cb();
            } else {
                logStateChange(fn, id, val, 'info.Debug - no match', 'neg');
                cb && cb();
            }
            return;
            // change Settings?
        } else if (id.startsWith(adapter.namespace + '.info.Settings.')) {
            getSettings(fn, cb);
            cb && cb();
            return;
            // change Configurations?
        } else if (id.startsWith(adapter.namespace + '.info.Configurations.')) {
            logStateChange(fn, id, val, 'Resync FHEM', 'pos');
            setState(fn, 'info.resync', true, false, Date.now());
            cb && cb();
            return;
        } else {
            logStateChange(fn, id, val, 'info.Info - no match', 'neg');
            cb && cb();
            return;
        }
    } else {
        let device = fhemObjects[id].native.Name;
        let attribute = fhemObjects[id].native.Attribute;
        // switch?
        if (attribute === 'state_switch') {
            logDebug(fn, id, 'detect state_switch - ' + id, 'D');
            cmd = 'set ' + device + ' ' + convertOnOff(fn, val);
            logStateChange(fn, id, val, cmd, 'pos');
            telnetOut.send(cmd, (e) => {
                e && logError(fn, cmd + ' - ' + e);
                cb && cb();
            });
            return;
        }
// attr?
        if (allowedAttributes.indexOf(attribute) !== -1) {
            logDebug(fn, id, 'detect allowedAttributes ' + attribute + ' - ' + id, 'D');
            cmd = 'attr ' + device + ' ' + attribute + ' ' + val;
            logStateChange(fn, id, val, cmd, 'pos');
            telnetOut.send(cmd, (e) => {
                e && logError(fn, e);
                cb && cb();
            });
            return;
        }
        logDebug(fn, device, 'detect fhem', 'D');
        // rgb?
        if (attribute === 'rgb') {
            val = val.substring(1);
        }
        if (fhemObjects[id].common.unit === '%') {
            val = Math.round(val);
        }
// bol0?
        if (fhemObjects[id].native.bol0) {    //benötigt??????
            if (val === '1' || val === 1 || val === 'on' || val === 'true' || val === true) {
                val = '1';
            }
            if (val === '0' || val === 0 || val === 'off' || val === 'false' || val === false) {
                val = '0';
            }
        }
// state?
        if (attribute === 'state') {
            cmd = 'set ' + device + ' ' + convertOnOff(fn, val);
        } else {
            cmd = 'set ' + device + ' ' + attribute + ' ' + val;
            // button?
            if (fhemObjects[id].common.role.indexOf('button') !== -1) {
                cmd = 'set ' + device + ' ' + attribute;
            }
        }
        telnetOut.send(cmd, (e) => {
            e && logError(fn, e);
            cb && cb();
            logStateChange(fn, id, val, cmd, 'pos');
            let dif = Date.now() - ts;
            numWriteValue = numWriteValue + 1;
            timeWriteValue = timeWriteValue + dif;
            //TEST
            if (logDevelop & !firstRun) {
                if (dif > Math.round(timeWriteValue / numWriteValue))
                    adapter.log.warn(eventIOB.length + ' (' + dif + ' ms) writeValue: ' + id + ' ' + val);
            }
        });
    }
}
// ?????
function fhemObjectsRead(ff, val, cb) {
    adapter.log.warn(val + ': ' + JSON.stringify(fhemObjects[val]));
}
function writeOut(ff, id, val, ts, cb) {
    let fn = ff + '[writeOut] ';
    let cmd = 'set ' + id + ' ' + val;
    telnetOut.send(cmd, (e) => {
        e && logError(fn, e);
        cb && cb();
        if (!id.startsWith(adapter.namespace + '.info') && advancedFunction)
            setStateLog(fn, 'info.Info.lastIOBout', id + ' ' + val, true, Date.now());
        logStateChange(fn, id, val, cmd, 'pos');
        let dif = Date.now() - ts;
        numWriteOut = numWriteOut + 1;
        timeWriteOut = timeWriteOut + dif;
        //TEST
        if (logDevelop & !firstRun) {
            if (dif > 1000)
                adapter.log.warn(eventIOB.length + ' (' + dif + ' ms) writeOut: ' + id + ' ' + val);
        }
    });
}
function requestMeta(ff, name, cb) {
    let fn = ff + '[requestMeta] ';
    logDebug(fn, name, 'requestMeta: check channel ' + name + ' > jsonlist2 ' + name, 'D');
    telnetOut.send('jsonlist2 ' + name, (e, result) => {
        e && logError(fn, e);
        cb && cb();
        if (logDevelop & !firstRun)
            adapter.log.warn('jsonlist2 ende cb');
        if (result) {
            let objects = null;
            try {
                objects = JSON.parse(result);
                logDebug(fn, name, 'requestMeta: ' + name + ' - Number of Device(s) ' + objects.totalResultsReturned, 'D');
            } catch (e) {
                logError(fn, 'Cannot parse answer for "jsonlist2 ' + name + '" - ' + e);
            }
            if (objects.totalResultsReturned > 0) {
                parseObjects(fn, objects.Results, () => {
                });
            } else {
                logWarn(fn, 'no sync - result of "jsonlist2 ' + name + '" <1');
            }
        } else {
            logWarn(fn, 'no sync - no result of "jsonlist2 ' + name + '"');
        }
    });
}
// STEP 14
function eventFHEM(ff, event) {

    let fn = ff + '[eventFHEM] ';
    let ts = Date.now();
    if (!event) {
        adapter.log.debug(fn + 'no event - return ' + ff);
        return;
    }
// Sonos special
    if (event.indexOf('display_covertitle') !== -1) {
        return;
    }
    let parts = event.split(' ');
    if (fhemIgnoreConfig[parts[1]]) {
        return;
    }
    if (event[4] === '-' && event[7] === '-') {
        ts = new Date(event.substring(0, 19)).getTime();
        event = event.substring(20);
    }
    if (logEventFHEM) {
        adapter.log.info('eventFHEM(in): "' + event + '"');
    } else {
        logDebug(fn, event, 'eventFHEM(in): "' + event + '"', '');
    }
    eventQueue.push({
        parts: parts,
        event: event,
        ts: ts
    });
    processEvent(fn);
    return;
}
function processEvent(ff, cb) {
    let fn = ff + '[processEvent] ';
    if (!eventQueue.length) {
        cb && cb();
        return;
    }
    const command = eventQueue.shift();
    logDebug(fn, command.event, '"' + command.event + '"  / todo: ' + eventQueue.length + ' (' + (Date.now() - command.ts) + ' ms processEvent)', 'D');
    //Test
    if (logDevelop & !firstRun) {
        let dif = Date.now() - command.ts;
        if (dif > 20)
            adapter.log.warn(eventQueue.length + ' (' + dif + ' ms) processEvent: ' + command.event + ' ');
    }
    parseEvent(fn, command, () => setImmediate(processEvent, ff, cb));
}
function parseEvent(ff, eventIN, cb) {
    let fn = ff + '[parseEvent] ';
    let event = eventIN.event;
    let ts = eventIN.ts;
    if (!event) {
        logDebug(fn, '', 'no event > return', '');
        cb && cb();
        return;
    }
    let parts = eventIN.parts;
    if (!parts[1]) {
        eventNOK(fn, event, 'no channel', 'only parts[0] = ' + parts[0], 'warn', 'unknown');
        cb && cb();
        return;
    }
    let type = parts[0];
    let device = parts[1];
    let nameIob = convertNameFHEM(fn, device);
    let channel = adapter.namespace + '.' + nameIob;
    let id;
    // special
    if (parts[0] === 'TelegramBot' && parts[2] === '_msg') {
        eventNOK(fn, event, channel, 'TelegramBot xxx _msg', 'info', parts[1]);
        cb && cb();
        return;
    }
// Global global ?
    if (parts[0] === 'Global' && parts[1] === 'global') {
        logDebug(fn, channel, 'detect "Global global" - ' + event, 'D');
        if (parts[3]) {
            device = parts[3];
            nameIob = convertNameFHEM(fn, device);
            channel = adapter.namespace + '.' + nameIob;
        }
        if (parts[2] === 'SAVE' || parts[2] === 'UPDATE') {
            eventNOK(fn, event, channel, 'SAVE or UPDATE', 'debug', parts[1]);
            cb && cb();
            return;
        } else if (!parts[3]) {
            eventNOK(fn, event, channel, 'no parts[3]', 'warn', 'unknown');
            cb && cb();
            return;
            // ignore FHEM Device?
        } else if (fhemIgnore[device]) {
            eventNOK(fn, event, channel, '"' + device + '" included in fhemIgnore', 'debug', device);
            cb && cb();
            return;
            // Global global DEFINED or MODIFIED?
        } else if (parts[2] === 'DEFINED' || parts[2] === 'MODIFIED') {
            logDebug(fn, channel, 'detect "Global global DEFINED" - ' + event, 'D');
            eventOK(ff, event, 'jsonlist2', device, ts, 'global', device);
            cb && cb();
            return;
            // No channel for event and not room?
        } else if (!fhemObjects[adapter.namespace + '.' + nameIob] && parts[4] !== 'room') {
            eventNOK(fn, event, channel, '"' + device + '" not in fhemObjects and ATTR <> room', 'debug', device);
            cb && cb();
            return;
            // Global global ATTR ?
        } else if (parts[2] === 'ATTR') {
            logDebug(fn, channel, 'detect "Global global ATTR" - ' + event, 'D');
            if (allowedAttributes.indexOf(parts[4]) !== -1) {
                eventOK(ff, event, 'jsonlist2', device, ts, 'global', device, channel);
                cb && cb();
                return;
            } else {
                eventNOK(fn, event, channel, 'attr "' + parts[4] + '" not in info.Configurations.allowedAttributes', 'info', device);
                cb && cb();
                return;
            }
// Global global DELETEATTR ?
        } else if (parts[2] === 'DELETEATTR') {
            logDebug(fn, channel, 'detect "Global global DELETEATTR" - ' + event, 'D');
            if (allowedAttributes.indexOf(parts[4]) !== -1) {
                if (parts[4] === 'room' && iobroker) {
                    eventOK(fn, event, 'unusedObjects', nameIob + '.*', ts, 'global', device, channel);
                    cb && cb();
                    return;
                } else {
                    eventOK(fn, event, 'unusedObjects', nameIob + '.Attributes.' + parts[4], ts, 'global', device, channel);
                    cb && cb();
                    return;
                }
                if (parts[4] === 'alias') {
                    eventOK(fn, event, 'jsonlist2', device, ts, 'global', device, channel);
                    cb && cb();
                    return;
                }
            } else {
                eventNOK(fn, event, channel, 'DELETEATTR "' + parts[4] + '" not in info.Configurations.allowedAttributes', 'info', device);
                cb && cb();
                return;
            }
// Global global DELETED ?
        } else if (parts[2] === 'DELETED') {
            logDebug(fn, channel, 'detect "Global global DELETED" - ' + event, 'D');
            eventOK(fn, event, 'unusedObjects', nameIob + '.*', ts, 'global', device, channel);
            cb && cb();
            return;
        } else {
            eventNOK(fn, event, channel, 'Global global not proccesed!', 'warn', device, channel);
            cb && cb();
            return;
        }
    } else if (parts[0] === 'readingsGroup') {
        if (fhemObjects[channel]) {
            parts[2] = parts[2].substr(0, parts[2].length - 1);
            let name = adapter.namespace + '.' + nameIob + '.readingsGroup.' + convertNameFHEM(fn, parts[2]);
            logDebug(fn, event, 'detect readingsGroup "' + parts[2] + '" > check object "' + name + '"', 'D');
            let RG = {
                _id: name,
                type: 'state',
                common: {
                    name: device + ' ' + parts[2],
                    type: 'string',
                    role: 'html',
                    read: true,
                    write: false
                },
                native: {
                    Name: device,
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
            eventOK(fn, event, name, parts[3], ts, 'state', nameIob, channel);
            syncObjects([RG], () => {
                syncStates([stateRG], () => {
                });
            });
            cb && cb();
            return;
        } else {
            eventNOK(fn, event, channel, 'redingsGroup "' + nameIob + '" not im fhemObjects', 'debug', nameIob);
            cb && cb();
            return;
        }
//ignored
    } else if (fhemIgnore[device] && !fhemObjects[channel]) {
        logDebug(fn, event, 'detect fhemIgnore - ' + event, 'D');
        if (device === adapter.namespace + '.alive') {
            logDebug(fn, event, 'detect alive', 'D');
            getAlive(fn);
            cb && cb();
            return;
        } else if (device === adapter.namespace + '.send2ioB') {
            logDebug(fn, event, 'detect send2ioB ', 'D');
            let val = event.substring(parts[0].length + device.length + 2);
            if (advancedFunction)
                setStateLog('info.Info.lastSend2ioB', val, true, Date.now());
            adapter.getForeignObject(parts[2], function (e, obj) {
                if (e) {
                    logError(fn, e);
                } else if (!obj) {
                    eventNOK(fn, event, channel, 'object "' + parts[2] + '" not detected!', 'warn', 'unknown');
                } else if (obj && !obj.common.write) {
                    eventNOK(fn, event, channel, 'object "' + parts[2] + '" common.write not true', 'warn', 'unknown');
                } else if (obj && obj.common.write) {
                    let setState = event.substr(parts[0].length + device.length + parts[2].length + 3);
                    if (obj.common.type === 'number')
                        setState = parseInt(setState);
                    if (obj.common.type === 'boolean')
                        setState = JSON.parse(setState);
                    eventOK(fn, event, parts[2], setState, ts, 'state', device, 'no');
                    adapter.setForeignState(parts[2], setState, false);
                }
            });
            cb && cb();
            return;
        } else {
            eventNOK(fn, event, channel, 'included in fhemIgnore', 'debug', device);
            cb && cb();
            return;
        }
    } else if (fhemIN[nameIob]) {
        eventNOK(fn, event, channel, 'included in fhemIN', 'warn', 'unknown');
        cb && cb();
        return;
    } else if (parts[2] && parts[2].substr(parts[2].length - 1) === ':' && ignoreReadings.indexOf(parts[2].substr(0, parts[2].length - 1)) !== -1) {
        eventNOK(fn, event, channel, 'included in ignoreReadings', 'debug', device);
        cb && cb();
        return;
    } else if (!fhemObjects[channel] && device !== 'global') {    //global?
        eventNOK(fn, event, channel, 'not in fhemObjects and not global', 'debug', device);
        cb && cb();
        return;
    } else {
        try {
            logDebug(fn, event, 'check reading or state - ' + event, 'D');
            const stelle = event.substring(parts[0].length + device.length + parts[2].length + 1);
            let name;
            let val;
            let search;
            const pos = event.indexOf(':');
            // state? (ohne : oder : hinten)
            if (pos === -1 || stelle.indexOf(':') !== 0) {
                logDebug(fn, event, 'detect state (ohne : oder : hinten) ' + event, 'D');
                val = event.substring(parts[0].length + device.length + 2);
                id = channel + '.state';
                if (fhemObjects[id] && id !== channel) {
                    eventOK(fn, event, id, val, ts, 'state', device, channel);
                    // state_switch?
                    search = channel + '.state_switch';
                    if (fhemObjects[search])
                        eventOK(fn, event, search, convertFhemValue(parts[2]), ts, 'switch', device, channel);
                    const sensor = convertFhemSensor(fn, val, device, type);
                    // state_media?
                    search = channel + '.state_media';
                    if (fhemObjects[search]) {
                        val = (parts[2] === 'PLAYING');
                        eventOK(fn, event, search, val, ts, 'media', device, channel);
                        cb && cb();
                        return;
                    }
// state_boolean?
                    search = channel + '.state_boolean';
                    if (fhemObjects[search] || typeof (sensor[0]) === "boolean")
                        eventOK(fn, event, channel + '.state_boolean', sensor[0], ts, 'boolean', device, channel);
                    search = channel + '.state_value';
                    // state_value?
                    if (fhemObjects[search] || typeof (sensor[3]) === "number")
                        eventOK(fn, event, channel + '.state_value', sensor[3], ts, 'value', device, channel);
                    // special for ZWave dim
                    if (parts[0] === 'ZWave' && parts[2] === 'dim') {
                        let zwave = parts[0] + ' ' + device + ' ' + parts[2] + ': ' + parts[3];
                        adapter.log.info('--- | event FHEM: ' + event + ' (Create4ZWave) > ' + zwave);
                        eventFHEM(fn, zwave);
                    }
                    cb && cb();
                    return;
                } else {
                    eventNOK(fn, event, id, 'no object(state)', 'json', device);
                    cb && cb();
                    return;
                }
            } else if (pos !== -1) {
                logDebug(fn, event, 'check reading or state? (mit : vorne)' + event, 'D');
                name = event.substring(0, pos);
                let partsR = name.split(' ');
                // let id = channel + '.' + partsR[2];   09.01.21 HPSU
                let id = channel + '.' + convertNameFHEM(fn, partsR[2]);
                if (fhemObjects[id]) {
                    val = convertFhemValue(event.substring(partsR[0].length + partsR[1].length + partsR[2].length + 4));
                    // unit?
                    if (fhemObjects[id].common.unit) {
                        const valOU = val.split(' ');
                        logDebug(fn, name, ' detect Unit (' + fhemObjects[id].common.unit + '): ' + name + ' ' + val + ' --> ' + name + ' ' + valOU[0], 'D');
                        if (fhemObjects[id].common.unit !== valOU[1] && valOU[1] && fhemObjects[id].common.unit !== '°C' && valOU[1] !== 'C')
                            adapter.log.warn('different unit! ' + name + ' old: ' + fhemObjects[id].common.unit + ' / new: ' + valOU[1]);
                        val = valOU[0];
                    }
                    //indicator?
                    if (fhemObjects[id].native.role.startsWith('indicator')) {
                        //adapter.log.warn(id+' found indicator');
                        val = convertValueBol(val);
                    }
                    //rgb?
                    if (fhemObjects[id].native.role.startsWith('level.color.rgb')) {
                        val = '#' + val;
                    }
                    eventOK(fn, event, id, val, ts, 'reading', device, channel);
                    cb && cb();
                    return;
                } else {
                    let idS = channel + '.' + "state";
                    if (fhemObjects[idS] && "value" in fhemObjects[idS]) {
                        let valOld = fhemObjects[idS].value.val.split(' ');
                        if (valOld[0] === partsR[2] + ':') {
                            val = convertFhemValue(event.substring(partsR[0].length + partsR[1].length + 2));
                            eventOK(fn, event, idS, val, ts, 'state', device, channel);
                        } else {
                            eventNOK(fn, event, id, 'no fhemObjects', 'json', device);
                        }
                    } else {
                        eventNOK(fn, event, id, 'no fhemObjects', 'json', device);
                    }
                    cb && cb();
                    return;
                }
            }
        } catch (e) {
            logError(fn, 'event: "' + event + '" ' + e);
        }
    }
    logDebug(fn, '', 'no match -  ' + event, 'D');
}
// more
function eventOK(ff, event, id, val, ts, info, device, channel, cb) {
    let fn = ff + '[eventOK] ';
    if (id === 'jsonlist2') {
        doJsonlist(fn, val, cb);
    } else if (id === 'unusedObjects') {
        unusedObjects(fn, val);
    } else {
        setState(fn, id, val, true, ts);
    }
    let alias = '----';
    if (fhemObjects[channel]) {
        alias = fhemObjects[channel].native.Attributes.alias;
    }
    let tE = '';
    if (logDevelop) {
        tE = ' (' + Math.round((Date.now() - ts)) + ' ms) ';
    }
    let out = 'event FHEM: ' + tE + alias + ' | ' + event + ' | ' + info + ' > ' + id + ' ' + val;
    if (debugNAME.indexOf(device) !== -1) {
        adapter.log.info(device + ' | ' + out);
    } else {
        let check = 'off';
        if ((info === 'state' || info === 'switch' || info === 'value' || info === 'boolean') && logEventFHEMstate)
            check = 'on';
        if (info === 'reading' && logEventFHEMreading)
            check = 'on';
        if (info === 'global' && logEventFHEMglobal)
            check = 'on';
        if (check === 'on') {
            adapter.log.info(out);
        } else {
            adapter.log.debug(fn + tE + out);
        }
    }
}
function eventNOK(ff, event, id, text, mode, device, cb) {
    let fn = ff + '[eventNOK] ';
    let alias = '----';
    if (fhemObjects[id]) {
        alias = fhemObjects[id].native.Attributes.alias;
    }
    let out = 'unhandled event FHEM: ' + alias + ' | ' + event + ' > no sync  - ' + text;
    if (mode === 'warn') {
        logWarn(fn, out);
        cb && cb();
    } else if (mode === 'info') {
        if (debugNAME.indexOf(device) !== -1) {
            adapter.log.info(device + ' | ' + out);
        } else if (logUnhandledEventFHEM) {
            adapter.log.info(out);
        } else {
            adapter.log.debug(fn + t + out);
        }
        cb && cb();
    } else if (mode === 'debug') {
        if (debugNAME.indexOf(device) !== -1) {
            logWarn(fn, device + ' | ' + out);
        } else {
            adapter.log.debug(fn + t + out);
        }
        cb && cb();
    } else if (mode === 'json') {
        let more = ' >> jsonlist2 ' + device;
        if (debugNAME.indexOf(device) !== -1) {
            logWarn(fn, device + ' | ' + out + more);
        } else if (logUnhandledEventFHEM) {
            adapter.log.info(out + more);
        } else {
            adapter.log.debug(fn + t + out + more);
        }
        doJsonlist(ff, device, () => {
            cb && cb();
        });
    } else {
        logError(fn, 'wrong mode: ' + mode + ' (allowed: info,warn,debug) - ' + out);
        cb && cb();
    }
}
function doJsonlist(ff, device, cb) {
    let fn = ff + '[doJsonlist] ';
    if (device !== lastNameQueue || device === lastNameQueue && lastNameTS + 2000 < Date.now()) {
        logDebug(fn, device, 'meta ' + device, 'D');
        eventIOB.push({
            command: 'meta',
            name: device
        });
        checkQueue(fn);
        lastNameQueue = device;
        lastNameTS = Date.now();
        cb && cb();
    } else {
        logDebug(fn, device, 'no jsonlist2 ' + device + ' = ' + lastNameQueue, 'D');
        cb && cb();
    }
}
// get
function getUnit(name) {
    name = name.toLowerCase();
    // if (Utemperature.indexOf(name) !== -1) {
    //    return '°C';
    if (name.indexOf('temp') !== -1 && name.indexOf('time') === -1) {
        return '°C';
    } else if (name.indexOf('power') !== -1) {
        return 'W';
    } else if (name.indexOf('energy') !== -1) {
        return 'Wh';
    } else if (name.indexOf('humidity') !== -1) {
        return '%';
    } else if (name.indexOf('pressure') !== -1) {
        return 'hPa';
    } else if (name.indexOf('wind_speed') !== -1) {
        return 'kmh';
    } else if (name.indexOf('voltage') !== -1) {
        return 'V';
    } else if (name.indexOf('percent') !== -1 && name.indexOf('cpu') === -1) {
        return '%';
    }
    return undefined;
}
// convert
function convertNameIob(ff, id) {
    let fn = ff + '[convertNameIob] ';
    let idFHEM = id.replace(/[-#:~]/g, '_'); //29.01.21
    idFHEM = idFHEM.replace(/\{/g, '_');
    idFHEM = idFHEM.replace(/\}/g, '_');
    if (id !== idFHEM)
        logDebug(fn, id, 'convertNameIob: ' + id + ' --> ' + idFHEM, 'D');
    return idFHEM;
}
function convertNameFHEM(ff, name) {
    let fn = ff + '[convertNameFHEM] ';
    //Conversion - e.g. for FHEM HPSU https://forum.fhem.de/index.php/topic,106503.0.htm HPSUVal.Betriebsart_[mode_01] ==> HPSUVal~Betriebsart_{mode_01}
    let id = name.replace(/\[/g, '{');
    id = id.replace(/\]/g, '}');
    // Device HPSU? 
    if (id.startsWith('HPSU')) {
        id = id.replace(/\./g, '~');
    } else {
        id = id.replace(/\./g, '_');
    }
    if (name !== id)
        logDebug(fn, name, 'convertNameFHEM: ' + name + ' --> ' + id, 'D');
    return id;
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
function convertOnOff(ff, val) {
    let fn = ff + '[convertOnOff] ';
    let back = val;
    if (val === '1' || val === 1 || val === 'on' || val === 'true' || val === true)
        back = 'on';
    if (val === '0' || val === 0 || val === 'off' || val === 'false' || val === false)
        back = 'off';
    adapter.log.debug(fn + val + ' > ' + back);
    return back;
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
function convertFhemSensor(ff, val, device, type) {
    let fn = ff + '[convertFhemSensor] ';
    val = val.toLowerCase();
    let valR = [val, val, val, val];
    if (val === 'open' || val === 'opened')
        valR = [true, 'sensor', 'value.sensor', 2];
    if (val === 'close' || val === 'closed')
        valR = [false, 'sensor', 'value.sensor', 0];
    if (val === 'present')
        valR = [true, 'indicator.presence', 'value', 2];
    if (val === 'absent')
        valR = [false, 'indicator.presence', 'value', 0];
    if (val === 'motion')
        valR = [true, 'sensor.motion', 'value', 2];
    if (val === 'nomotion')
        valR = [false, 'sensor.motion', 'value', 0];
    if ('SONOS MQTT HMLAN FB_CALLMONITOR'.indexOf(type) !== -1)
        valR = [val, val, val, val];
    logDebug(fn, device, 'convertFhemSensor: ' + val + ' > ' + valR, 'D');
    return valR;
}
// more
function getAlive(ff) {
    let fn = ff + '[getAlive] ';
    adapter.log.debug(fn + 'alive true - start');
    adapter.setState('info.Info.alive', true, true);
    if (logDevelop)
        adapter.log.warn('Anzahl: setState ' + numEvent + '/' + Math.round(timeEvent / numEvent) + 'ms writeValue ' + numWriteValue + '/' + Math.round(timeWriteValue / numWriteValue) + ' ms writeOut ' + numWriteOut + '/' + Math.round(timeWriteOut / numWriteOut) + ' ms');
    adapter.setState('info.Debug.numberIn', numEvent, true);
    adapter.setState('info.Debug.timeIn', Math.round(timeEvent / numEvent), true);
    adapter.setState('info.Debug.numberOut', (numWriteOut + numWriteValue), true);
    adapter.setState('info.Debug.timeOut', Math.round((timeWriteOut + timeWriteValue) / (numWriteOut + numWriteValue)), true);
    numEvent = 0;
    timeEvent = 0;
    numWriteOut = 0;
    timeWriteOut = 0;
    numWriteValue = 0;
    timeWriteValue = 0;
    if (adapter.__timeouts.getAlive) {
        clearTimeout(adapter.__timeouts.getAlive);
        adapter.log.debug(ff + fn + 'alive reset timer');
    }
    adapter.__timeouts.getAlive = setTimeout(function () {
        adapter.__timeouts.getAlive = null;
        logError(fn, 'lost Connection FHEM --> ioBroker');
        adapter.log.debug(ff + fn + 'alive false');
        adapter.setState('info.Info.alive', false, true);
    }, 6 * 60000);
}
function setState(ff, id, val, ack, ts, cb) {
    let fn = ff + '[setState] ';
    if (!id) {
        adapter.log.warn(fn + 'no id - return');
        cb && cb();
        return;
    }
    setStateQueue.push({
        id: id,
        val: val,
        ack: ack,
        ts: ts
    });
    if (!firstRun)
        processSetState(fn);
    cb && cb();
    return;
}
function processSetState(ff, cb) {
    let fn = ff + '[processSetState] ';
    if (!setStateQueue.length) {
        cb && cb();
        return;
    }
    if (!connected) {
        cb && cb();
        return;
    }
    const command = setStateQueue.shift();
    if (command === undefined) {
        cb && cb();
        return;
    }
    setStateDo(fn, command, () => setImmediate(processSetState, ff, cb));
    logDebug(fn, command.id, command.id + ' ' + command.val + ' / todo: ' + setStateQueue.length + ' (' + (Math.round((Date.now() - command.ts))) + ')', 'D');
}
function setStateDo(ff, command, cb) {
    let fn = ff + ' ' + '[setStateDo] ';
    logDebug(fn, command.id, 'stateChange:setStateDo ' + command.id + ' ' + command.val + ' (' + (Date.now() - command.ts) + ' ms)', 'D');
    if (syncUpdate) {
        setStateDoWrite(ff, command, () => {
            cb && cb();
            return;
        });
    } else {
        if (fhemObjects[command.id] && "value" in fhemObjects[command.id]) {
            if (fhemObjects[command.id].value.val != command.val) {
                setStateDoWrite(ff, command, () => {
                    cb && cb();
                    return;
                });
            } else {
                cb && cb();
                return;
            }
        } else {
            setStateDoWrite(ff, command, () => {
                cb && cb();
                return;
            });
        }
    }
}
function setStateDoWrite(ff, command, cb) {
    let fn = ff + '[setStateDoWrite] ';
    adapter.setState(command.id, command.val, command.ack, command.ts, e => {
        if (e) {
            logError(fn, command.id + ': ' + e);
            cb && cb();
            return;
        } else {
            cb && cb();
            if (fhemObjects[command.id] && "value" in fhemObjects[command.id]) {
                fhemObjects[command.id].value.val = command.val;
            }
            let dif = Date.now() - command.ts;
            logDebug(fn, command.id, 'stateChange:setStateDo ' + command.id + ' ' + command.val + ' (' + dif + ' ms)', 'D');
            numEvent = numEvent + 1;
            timeEvent = timeEvent + dif;
            //TEST
            if (logDevelop & !firstRun) {
                if (dif > 1000)
                    adapter.log.warn(setStateQueue.length + ' (' + dif + ' ms) setStateDo: ' + command.id + ' ' + command.val);
            }
            logDebug(fn, command.id, command.id + ' ' + command.val + ' (' + dif + ' ms)', 'D');
            return;
        }
    });
}
function setStateLog(ff, id, val, ack, ts, cb) {
    let fn = ff + '[setStateLog] ';
    if (!id) {
        adapter.log.warn(fn + 'no id - return');
        cb && cb();
        return;
    }
    setStateLogQueue.push({
        id: id,
        val: val,
        ack: ack,
        ts: ts
    });
    if (!aktiv)
        processSetStateLog(fn);
    cb && cb();
    return;
}
function processSetStateLog(ff, cb) {
    let fn = ff + '[processSetStateLog] ';
    aktiv = true;
    if (!setStateLogQueue.length) {
        aktiv = false;
        cb && cb();
        return;
    }
    if (!connected) {
        aktiv = false;
        cb && cb();
        return;
    }
    const command = setStateLogQueue.shift();
    if (command === undefined) {
        aktiv = false;
        cb && cb();
        return;
    }
    setStateLogDo(fn, command, () => setImmediate(processSetStateLog, ff, cb));
    logDebug(fn, command.id, command.id + ' ' + command.val + ' / todo: ' + setStateLogQueue.length + ' (' + (Math.round((Date.now() - command.ts))) + ')', 'D');
}
function setStateLogDo(ff, command, cb) {
    let fn = ff + ' ' + '[setStateLogDo] ';
    adapter.setState(command.id, command.val, command.ack, e => {
        if (e) {
            logError(fn, command.id + ': ' + e);
            cb && cb();
            return;
        } else {
            cb && cb();
            return;
        }
    });
}
function sendFHEM(ff, cmd, detect, cb) {
    let fn = ff + ' ' + '[sendFHEM] ';
    logDebug(fn, '', 'cmd = ' + cmd + ' / detect=' + detect, 'D');
    if (autoConfigFHEM || !detect) {
        eventIOB.push({
            command: 'write',
            id: adapter.namespace + '.info.Commands.sendFHEM',
            val: cmd
        });
        checkQueue(fn);
        if (detect)
            adapter.log.info('detect ' + detect + ' and "' + adapter.namespace + '.info.Configurations.autoConfigFHEM" = true  > ' + cmd + ' | more info README.md');
        cb && cb();
    } else if (detect) {
        adapter.log.warn('detect ' + detect + ': missing "' + cmd + '" > set manually in FHEM or automatically "' + adapter.namespace + '.info.Configurations.autoConfigFhem" = true | more info README.md');
        cb && cb();
    }
}
function logStateChange(fn, id, val, text, typ) {
    let parts = id.split('.');
    let search = parts[2];
    if (fhemObjects[id]) {
        search = fhemObjects[id].native.Name;
    }
    if (typ === 'pos') {
        text = 'stateChange (out): ' + id + ' | ' + val + ' > ' + text;
        if (debugNAME.indexOf(search) !== -1 || debugNAME.indexOf(parts[2]) !== -1) {
            adapter.log.info(search + ' | ' + text);
        } else if (logEventIOB) {
            adapter.log.info(text);
        } else {
            adapter.log.debug(search + ' | ' + fn + ' > ' + text);
        }
    } else if (typ === 'neg') {
        text = 'unhandled stateChange: ' + id + ' | ' + val + ' > ' + text;
        logWarn(fn, text);
    } else {
        logWarn(fn, 'wrong typ of logStateChange!');
    }
}
function logDebug(func, id, text, typ, cb) {
    if (typ === 'D' && !logDevelop) {
        return;
    } else {
        let parts = id.split('.');
        let partsE = id.split(' ');
        let search = parts[2];
        if (fhemObjects[id])
            search = fhemObjects[id].native.Name;
        if (debugNAME.indexOf(id) !== -1)
            search = id;
        if (debugNAME.indexOf(partsE[1]) !== -1)
            search = partsE[1];
        if (debugNAME.indexOf(partsE[3]) !== -1)
            search = partsE[3];
        if (debugNAME.indexOf(search) !== -1 || debugNAME.indexOf(parts[2]) !== -1) {
            adapter.log.info(search + ' | ' + text);
            cb && cb();
        } else {
            adapter.log.debug(func + text);
            cb && cb();
        }
    }
}
function logWarn(ff, text) {
    let fn = ff + '[logWarn] ';
    adapter.log.warn(text);
    if (advancedFunction)
        setStateLog(fn, 'info.Info.lastWarn', text, true, Date.now());
}
function logError(ff, text) {
    let fn = ff + '[logError] ';
    text = text + ' ' + ff;
    adapter.log.error(text);
    if (advancedFunction)
        setStateLog(fn, 'info.Info.lastError', text, true, Date.now());
}
function logInfo(ff, text, cb) {
    let fn = ff + '[logInfo] ';
    if (advancedFunction)
        setStateLog(fn, 'info.Info.lastInfo', text, true, Date.now());
    if (!logNoInfo) {
        adapter.log.info(text);
        cb && cb();
    } else {
        adapter.log.debug(text);
        cb && cb();
    }
}
//end ==================================================================================================================================
function main() {
    let fn = '[main] ';
    adapter.log.debug(fn + 'start');
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
    telnetIn.on('data', data => eventFHEM(fn, data));
    telnetIn.on('end', () => {
        adapter.log.debug('[main] telnetIn.on end');
        if (connected) {
            adapter.log.debug('Disconnected');
            connected = false;
            adapter.setState('info.connection', false, true);
            adapter.log.error('Disconnected telnet FHEM ' + adapter.config.host + ':' + adapter.config.port + ' (telnetIn) > adapter restart!');
            adapter.restart();
        }
    });
    telnetIn.on('close', () => {
        adapter.log.debug('[main] telnetIn.on close');
        if (connected) {
            adapter.log.debug('Disconnected');
            connected = false;
            adapter.setState('info.connection', false, true);
        }
    });
    telnetIn.on('error', err => {
        adapter.log.error(err + ' (telnetIn)');
    });
    telnetOut = new Telnet({
        host: adapter.config.host,
        port: adapter.config.port,
        password: adapter.config.password,
        reconnectTimeout: adapter.config.reconnectTimeout,
        prompt: adapter.config.prompt
    });
    telnetOut.on('ready', () => {
        adapter.log.debug(fn + 'telnetOut.on ready');
        if (!connected) {
            firstRun = true;
            firstCheck(fn, () => {
                logInfo(fn, 'STEP 01 ===== buildDate ' + buildDate + ' - check objects ' + adapter.namespace + '.info');
                myObjects(fn, () => {
                    logInfo(fn, 'STEP 02 ===== Devices to sync (SYNC) - check ' + adapter.namespace + '.' + 'info.Configurations (value)');
                    getConfigurationsSYNC(fn, () => {
                        logInfo(fn, 'STEP 03 ===== select function of Adapter (FUNCTION)  - check ' + adapter.namespace + '.' + 'info.Configurations (true)');
                        getConfigurationsFUNCTION(fn, () => {
                            logInfo(fn, 'STEP 04 ===== select messages ioBroker admin LOG - check ' + adapter.namespace + '.' + 'info.Settings (true)');
                            getSettings(fn, () => {
                                logInfo(fn, 'STEP 05 ===== Activate Debug-Mode for channel(s) - check ' + adapter.namespace + '.' + 'info.Debug.activate');
                                getDebug(fn, () => {
                                    logInfo(fn, 'STEP 06 ===== check Subscribe - check ' + adapter.namespace + '.info.Configurations.allowedIOBin');
                                    checkSubscribe(fn, () => {
                                        logInfo(fn, 'STEP 07 ===== connect FHEM telnet');
                                        syncFHEM(fn, () => {
                                            if (!connected)
                                                return;
                                            logInfo(fn, 'STEP 10 ===== check delete unused objects');
                                            unusedObjects(fn, '*', () => {
                                                if (!connected)
                                                    return;
                                                logInfo(fn, 'STEP 11 ==== check/create FHEM dummy Devices in room ioB_IN/ioB_System');
                                                syncStatesIOB(() => {
                                                    adapter.setState('info.Info.alive', false, true);
                                                    if (fhemObjects[adapter.namespace + '.send2ioB']) {
                                                        logWarn('no', '> please use ' + adapter.namespace + '.send2ioB instead of send2ioB > delete send2ioB');
                                                        sendFHEM(fn, 'delete send2ioB');
                                                    }
                                                    let newID;
                                                    newID = adapter.namespace + '.send2ioB';
                                                    logInfo(fn, '> dummy ' + newID + ' - use to set objects/states of ioBroker from FHEM');
                                                    if (!fhemIgnore[newID]) {
                                                        sendFHEM(fn, 'define ' + newID + ' dummy');
                                                        sendFHEM(fn, 'attr ' + newID + ' alias ' + newID);
                                                        sendFHEM(fn, 'attr ' + newID + ' room ioB_System');
                                                        sendFHEM(fn, 'attr ' + newID + ' comment Auto-created by ioBroker ' + adapter.namespace);
                                                    }
                                                    newID = adapter.namespace + '.alive';
                                                    logInfo(fn, '> dummy ' + newID + ' - use to check alive FHEM Adapter in FHEM');
                                                    if (!fhemIgnore[newID]) {
                                                        sendFHEM(fn, 'define ' + newID + ' dummy');
                                                        sendFHEM(fn, 'attr ' + newID + ' alias ' + newID);
                                                        sendFHEM(fn, 'attr ' + newID + ' room ioB_System');
                                                        sendFHEM(fn, 'attr ' + newID + ' useSetExtensions 1');
                                                        sendFHEM(fn, 'attr ' + newID + ' setList on:noArg off:noArg');
                                                        sendFHEM(fn, 'attr ' + newID + ' comment Auto-created by ioBroker ' + adapter.namespace);
                                                    } else {
                                                        sendFHEM(fn, 'deleteattr ' + newID + ' event-on-change-reading');
                                                    }
                                                    if (!connected)
                                                        return;
                                                    logInfo(fn, 'STEP 12 ==== activate alive and save FHEM');
                                                    logInfo(fn, '> activate ' + adapter.namespace + '.alive room ioB_System every 5 minutes');
                                                    setAlive();
                                                    logInfo(fn, '> save FHEM: Wrote configuration to fhem.cfg');
                                                    sendFHEM(fn, 'save');
                                                    if (!connected)
                                                        return;
                                                    logInfo(fn, 'STEP 13 ==== processed saved stateChange(s) of ioBroker');
                                                    logInfo(fn, '> processed ' + eventIOB.length + ' stateChange(s) of ioBroker saved during synchro');
                                                    processQueue(fn, () => {
                                                        if (!connected)
                                                            return;
                                                        logInfo(fn, 'STEP 14 ==== processed saved event(s) of FHEM ');
                                                        logInfo(fn, '> processed ' + setStateQueue.length + ' event(s) of FHEM saved during synchro');
                                                        processSetState(fn, () => {
                                                            logInfo(fn, 'STEP 15 ==== info Synchro');
                                                            adapter.log.debug('fhemIgnore = ' + JSON.stringify(fhemIgnore));
                                                            adapter.setState('info.Info.TEST', JSON.stringify(fhemIgnore), true);
                                                            adapter.log.debug('fhemIN = ' + JSON.stringify(fhemIN));
                                                            adapter.log.debug('fhemINs = ' + JSON.stringify(fhemINs));
                                                            adapter.log.debug('fhemIgnoreConfig = ' + JSON.stringify(fhemIgnoreConfig));
                                                            adapter.getStates('info.Info.*', (e, obj) => {
                                                                e && logError(fn, e);
                                                                if (obj) {
                                                                    let end = 0;
                                                                    for (const id in obj) {
                                                                        if (!obj.hasOwnProperty(id)) {
                                                                            continue;
                                                                        }
                                                                        adapter.getObject(id, (e, objO) => {
                                                                            e && logError(fn, e);
                                                                            if (objO) {
                                                                                logInfo(fn, '> ' + objO.common.name + ' = ' + obj[id].val + ' - ' + id);
                                                                            }
                                                                            end++;
                                                                            if (end === Object.keys(obj).length) {
                                                                                logWarn(fn, '> more info FHEM Adapter visit ' + linkREADME);
                                                                                if (logNoInfo)
                                                                                    adapter.log.info('END ===== Synchronised FHEM in ' + Math.round((Date.now() - tsStart)) + ' ms :-)');
                                                                                logInfo(fn, 'END ===== Synchronised FHEM in ' + Math.round((Date.now() - tsStart)) + ' ms :-)');
                                                                                synchro = false;
                                                                                firstRun = false;
                                                                                processSetState(fn);
                                                                            }
                                                                        });
                                                                    }
                                                                }
                                                            });
                                                        });
                                                    });
                                                });
                                            });
                                        });
                                    });
                                });
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
            adapter.log.error('Disconnected telnet FHEM ' + adapter.config.host + ':' + adapter.config.port + ' (telnetOut) > adapter restart!');
            adapter.restart();
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
    telnetOut.on('error', err => {
        adapter.log.error(err + ' (telnetOut)');
    });
}
process.on('uncaughtException', err => {
    adapter.log.warn('Exception: ' + err);
    err.stack && adapter.log.warn(err.stack);
    telnetOut.destroy();
    telnetIn.destroy();
});
// If started as allInOne mode => return function to create instance
// @ts-ignore
if (module.parent) {
    module.exports = startAdapter;
} else {
// or start the instance directly
    startAdapter();
}
