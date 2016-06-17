/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var utils   = require(__dirname + '/lib/utils'); 
var Telnet  = require(__dirname + '/lib/telnet');

var adapter = utils.adapter('fhem');

// Telnet sessions
var telnetOut = null; // read config and write values
var telnetIn  = null; // receive events

var connected   = false;
var queue       = [];
var fhemObjects = {};

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
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
adapter.on('stateChange', function (id, state) {
    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        if (!connected) {
            adapter.log.warn('Cannot send command to "' + id + '", because not connected');
            return;
        }
        if (id === adapter.namespace + '.' + '.info.resync') {
            queue.push({command: 'resync'});
            processQueue();
        } else if (fhemObjects[id]){
            queue.push({command: 'write', id: id, val: state.val});
            processQueue();
        }
    }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj == 'object' && obj.message) {
        if (obj.command == 'send') {
            // e.g. send email or pushover or whatever
            console.log('send command');

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});

function getUnit(name) {
    name = name.toLowerCase();
    if (name.indexOf('temperature') !== -1) {
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

function parseEvent(event) {
    //2016-02-26 10:19:07 TRX_WEATHER Energie statEnergy_total: Hour: 0.2625 Day: 7.5566 Month: 432.0465 Year: 871.7210 (since: 2016-01-09 )
    //HTTPMOD wetter_prenzelberg dewpointTemperature: 17.4
    if (!event) return;
    adapter.log.debug('Event: "' + event + '"');

    var ts = undefined;
    if (event[4] === '-' && event[7] === '-') {
        ts = new Date(event.substring(0, 19)).getTime();
        event = event.substring(20);
    }
    var pos = event.indexOf(':');
    if (pos !== -1) {
        var name = event.substring(0, pos);
        event = event.substring(pos + 2);
        var parts = name.split(' ');
        // first ignore
        var id = adapter.namespace + '.' + parts[1].replace(/\./g, '_') + '.' + parts[2].replace(/\./g, '_');
        if (fhemObjects[id]) {
            var val = convertFhemValue(event);

            if (fhemObjects[id].common.type === 'boolean') val = !!event;

            adapter.setForeignState(id, {val: val, ack: true, ts: ts});
        } else {
            if (event.indexOf(':') !== -1) {
                adapter.log.debug('Found strange value for "' + id + '": ' + event);
            } else {
                adapter.log.info('Unknown state "' + parts[1] + '.' + parts[2]);
                queue.push({command: 'meta', name: parts[1], attr: parts[2], val: event});
                processQueue();
            }
        }
    } else {
        adapter.log.warn('Unknown event "' + event + '"');
    }
}

function syncStates(states, cb) {
    if (!states || !states.length) {
        cb();
        return;
    }
    var state = states.shift();
    var id = state.id;
    delete state.id;

    adapter.setForeignState(id, state, function (err) {
        if (err) adapter.log.error(err);
        setTimeout(syncStates, 0, states, cb);
    });
}

function syncObjects(objects, cb) {
    if (!objects || !objects.length) {
        cb();
        return;
    }
    var obj = objects.shift();
    fhemObjects[obj._id] = obj;

    adapter.getForeignObject(obj._id, function (err, oldObj) {
        if (err) adapter.log.error(err);

        if (!oldObj) {
            adapter.log.debug('Create "' + obj._id + '"');
            adapter.setForeignObject(obj._id, obj, function (err) {
                if (err) adapter.log.error(err);

                setTimeout(syncObjects, 0, objects, cb);
            });
        } else {
            if (JSON.stringify(obj.native) !== JSON.stringify(oldObj.native)) {
                oldObj.native = obj.native;

                adapter.log.debug('Update "' + obj._id + '"');
                adapter.setForeignObject(obj._id, oldObj, function (err) {
                    if (err) adapter.log.error(err);
                    setTimeout(syncObjects, 0, objects, cb);
                });
            } else {
                setTimeout(syncObjects, 0, objects, cb);
            }
        }
    });

}

function syncRoom(room, members, cb) {
    adapter.getForeignObject('enum.rooms.' + room, function (err, obj) {
        if (!obj) {
            obj = {
                _id:   'enum.rooms.' + room,
                type: 'enum',
                common: {
                    name:    room,
                    members: members
                },
                native: {

                }
            };
            adapter.log.debug('Update "' + obj._id + '"');
            adapter.setForeignObject(obj._id, obj, function (err) {
                if (err) adapter.log.error(err);
                cb();
            });
        } else {
            obj.common  = obj.common || {};
            obj.common.members = obj.common.members || [];
            var changed = false;
            for (var m = 0; m < members.length; m++) {
                if (obj.common.members.indexOf(members[m]) === -1) {
                    changed = true;
                    obj.common.members.push(members[m]);
                }
            }
            if (changed) {
                adapter.log.debug('Update "' + obj._id + '"');
                adapter.setForeignObject(obj._id, obj, function (err) {
                    if (err) adapter.log.error(err);
                    cb();
                });
            } else {
                cb();
            }
        }
    });
}

function syncRooms(rooms, cb) {
    for (var r in rooms) {
        if (rooms[r]) {
            syncRoom(r, rooms[r], function () {
                setTimeout(syncRooms, 0, rooms, cb);
            });
            rooms[r] = null;
            return;
        }
    }

    if (cb) cb();
}

function parseObjects(objs, cb) {
    var rooms   = {};
    var objects = [];
    var states  = [];
    var id;
    var obj;
    var name;
    var ignoreStates = ['getConfig', 'getRegRaw', 'regBulk', 'regSet', 'deviceMsg', 'CommandAccepted'];

    objs.push(
            {
                "Name":"wiga_licht",
                "PossibleSets":"clear:readings,trigger,register,oldRegs,rssi,msgEvents,attack,all getConfig getRegRaw inhibit:on,off off on on-for-timer on-till peerBulk peerIODev press pressS:wiga_fb19_5,wiga_fb19_6,16B1A703,16B1A704,self01 pressL:wiga_fb19_5,wiga_fb19_6,16B1A703,16B1A704,self01 regBulk regSet sign:on,off statusRequest toggle",
                "PossibleAttrs":"verbose:0,1,2,3,4,5 room group comment:textField-long alias eventMap userReadings:textField-long do_not_notify:1,0 showtime:1,0 rawToReadable unit expert:0_defReg,1_allReg,2_defReg+raw,3_allReg+raw,4_off,8_templ+default,12_templOnly,251_anything param actAutoTry:0_off,1_on aesCommReq:1,0 ignore:1,0 dummy:1,0 IODev IOList IOgrp rssiLog:1,0 actCycle hmKey hmKey2 hmKey3 serialNr firmware .stc .devInfo actStatus autoReadReg:0_off,1_restart,2_pon-restart,3_onChange,4_reqStatus,5_readMissing,8_stateOnly burstAccess:0_off,1_auto msgRepeat hmProtocolEvents:0_off,1_dump,2_dumpFull,3_dumpTrigger aesKey:5,4,3,2,1,0  repPeers peerIDs tempListTmpl levelRange levelMap event-on-change-reading event-on-update-reading event-aggregator event-min-interval stateFormat:textField-long timestamp-on-change-reading model:ASH550,ASH550I,CCU-FHEM,CMM,DORMA_BRC-H,DORMA_RC-H,DORMA_atent,HM-CC-RT-DN,HM-CC-RT-DN-BoM,HM-CC-SCD,HM-CC-TC,HM-CC-VD,HM-Dis-EP-WM55,HM-Dis-TD-T,HM-Dis-WM55,HM-ES-PMSw1-DR,HM-ES-PMSw1-Pl,HM-ES-PMSw1-Pl-DN-R1,HM-ES-PMSw1-Pl-DN-R2,HM-ES-PMSw1-Pl-DN-R3,HM-ES-PMSw1-Pl-DN-R4,HM-ES-PMSw1-Pl-DN-R5,HM-ES-PMSw1-SM,HM-ES-TX-WM,HM-LC-BL1-FM,HM-LC-BL1-PB-FM,HM-LC-BL1-SM,HM-LC-Bl1-FM-2,HM-LC-Bl1-SM-2,HM-LC-Bl1PBU-FM,HM-LC-DDC1-PCB,HM-LC-DIM1L-CV,HM-LC-DIM1L-PL,HM-LC-DIM1T-CV,HM-LC-DIM1T-FM,HM-LC-DIM1T-PL,HM-LC-DIM2L-CV,HM-LC-DIM2L-SM,HM-LC-DIM2T-SM,HM-LC-Dim1L-CV-2,HM-LC-Dim1L-CV-644,HM-LC-Dim1L-Pl-2,HM-LC-Dim1L-Pl-3,HM-LC-Dim1L-Pl-644,HM-LC-Dim1PWM-CV,HM-LC-Dim1PWM-CV-2,HM-LC-Dim1T-CV-2,HM-LC-Dim1T-CV-644,HM-LC-Dim1T-FM-2,HM-LC-Dim1T-FM-644,HM-LC-Dim1T-FM-LF,HM-LC-Dim1T-Pl-2,HM-LC-Dim1T-Pl-3,HM-LC-Dim1T-Pl-644,HM-LC-Dim1TPBU-FM,HM-LC-Dim1TPBU-FM-2,HM-LC-Dim2L-SM-2,HM-LC-Dim2L-SM-644,HM-LC-Dim2T-SM,HM-LC-Dim2T-SM-2,HM-LC-RGBW-WM,HM-LC-SW1-BA-PCB,HM-LC-SW1-FM,HM-LC-SW1-PB-FM,HM-LC-SW1-PL,HM-LC-SW1-PL-OM54,HM-LC-SW1-PL2,HM-LC-SW1-SM,HM-LC-SW1-SM-ATMEGA168,HM-LC-SW2-DR,HM-LC-SW2-FM,HM-LC-SW2-PB-FM,HM-LC-SW2-SM,HM-LC-SW4-BA-PCB,HM-LC-SW4-DR,HM-LC-SW4-PCB,HM-LC-SW4-SM,HM-LC-SW4-SM-ATMEGA168,HM-LC-SW4-WM,HM-LC-Sw1-DR,HM-LC-Sw1-FM-2,HM-LC-Sw1-PCB,HM-LC-Sw1-Pl-3,HM-LC-Sw1-Pl-CT-R1,HM-LC-Sw1-Pl-CT-R2,HM-LC-Sw1-Pl-CT-R3,HM-LC-Sw1-Pl-CT-R4,HM-LC-Sw1-Pl-CT-R5,HM-LC-Sw1-Pl-DN-R1,HM-LC-Sw1-Pl-DN-R2,HM-LC-Sw1-Pl-DN-R3,HM-LC-Sw1-Pl-DN-R4,HM-LC-Sw1-Pl-DN-R5,HM-LC-Sw1-SM-2,HM-LC-Sw1PBU-FM,HM-LC-Sw2-DR-2,HM-LC-Sw2-FM-2,HM-LC-Sw2PBU-FM,HM-LC-Sw4-DR-2,HM-LC-Sw4-PCB-2,HM-LC-Sw4-SM-2,HM-LC-Sw4-WM-2,HM-MOD-Em-8,HM-MOD-Re-8,HM-OU-CF-PL,HM-OU-CFM-PL,HM-OU-CFM-TW,HM-OU-CM-PCB,HM-OU-LED16,HM-PB-2-FM,HM-PB-2-WM,HM-PB-2-WM55,HM-PB-2-WM55-2,HM-PB-4-WM,HM-PB-4DIS-WM,HM-PB-4DIS-WM-2,HM-PB-6-WM55,HM-PBI-4-FM,HM-RC-12,HM-RC-12-B,HM-RC-12-SW,HM-RC-19,HM-RC-19-B,HM-RC-19-SW,HM-RC-2-PBU-FM,HM-RC-4,HM-RC-4-2,HM-RC-4-3,HM-RC-4-3-D,HM-RC-4-B,HM-RC-8,HM-RC-Dis-H-x-EU,HM-RC-KEY3,HM-RC-KEY3-B,HM-RC-Key4-2,HM-RC-Key4-3,HM-RC-P1,HM-RC-SEC3,HM-RC-SEC3-B,HM-RC-Sec4-2,HM-RC-Sec4-3,HM-SCI-3-FM,HM-SEC-KEY,HM-SEC-KEY-O,HM-SEC-KEY-S,HM-SEC-MDIR,HM-SEC-MDIR-2,HM-SEC-MDIR-3,HM-SEC-RHS,HM-SEC-RHS-2,HM-SEC-SC,HM-SEC-SC-2,HM-SEC-SCo,HM-SEC-SD,HM-SEC-SD-2,HM-SEC-SFA-SM,HM-SEC-TIS,HM-SEC-WDS,HM-SEC-WDS-2,HM-SEC-WIN,HM-SEN-EP,HM-SEN-MDIR-SM,HM-SWI-3-FM,HM-Sec-Cen,HM-Sec-Sir-WM,HM-Sen-DB-PCB,HM-Sen-LI-O,HM-Sen-MDIR-O,HM-Sen-MDIR-O-2,HM-Sen-MDIR-WM55,HM-Sen-RD-O,HM-Sen-Wa-Od,HM-Sys-sRP-Pl,HM-TC-IT-WM-W-EU,HM-WDC7000,HM-WDS10-TH-O,HM-WDS100-C6-O,HM-WDS100-C6-O-2,HM-WDS20-TH-O,HM-WDS30-OT2-SM,HM-WDS30-OT2-SM-2,HM-WDS30-T-O,HM-WDS40-TH-I,HM-WDS40-TH-I-2,HM-WS550,HM-WS550LCB,HM-WS550LCW,HM-WS550Tech,IS-WDS-TH-OD-S-R3,KFM-Display,KFM-Sensor,KS550,KS550LC,KS550TECH,KS888,OLIGO-smart-iq-HM,PS-Th-Sens,PS-switch,ROTO_ZEL-STG-RM-DWT-10,ROTO_ZEL-STG-RM-FDK,ROTO_ZEL-STG-RM-FEP-230V,ROTO_ZEL-STG-RM-FSA,ROTO_ZEL-STG-RM-FST-UP4,ROTO_ZEL-STG-RM-FWT,ROTO_ZEL-STG-RM-FZS,ROTO_ZEL-STG-RM-FZS-2,ROTO_ZEL-STG-RM-HS-4,ROTO_ZEL-STG-RM-WT-2,Roto_ZEL-STG-RM-FFK,Roto_ZEL-STG-RM-FSS-UP3,S550IA,Schueco_263-130,Schueco_263-131,Schueco_263-132,Schueco_263-133,Schueco_263-134,Schueco_263-135,Schueco_263-144,Schueco_263-145,Schueco_263-146,Schueco_263-147,Schueco_263-155,Schueco_263-157,Schueco_263-158,Schueco_263-160,Schueco_263-162,Schueco_263-167,Schueco_263-xxx,SensoTimer-ST-6,WDF-solar,WS888 subType:AlarmControl,KFM100,THSensor,blindActuator,blindActuatorSol,dimmer,keyMatic,motionAndBtn,motionDetector,outputUnit,powerMeter,powerSensor,pushButton,remote,repeater,rgb,senBright,sensRain,sensor,singleButton,siren,smokeDetector,swi,switch,thermostat,threeStateSensor,timer,tipTronic,virtual,winMatic cmdIcon devStateIcon devStateStyle icon sortby webCmd widgetOverride userattr",
                "Internals": {
                    "DEF": "192B1C01",
                    "NAME": "wiga_licht",
                    "NR": "31",
                    "NTFY_ORDER": "50-wiga_licht",
                    "STATE": "off",
                    "TYPE": "CUL_HM",
                    "chanNo": "01",
                    "device": "wiga_sw_rechts",
                    "peerList": "wiga_fb19_5,wiga_fb19_6,16B1A703,16B1A704,self01,"
                },
                "Readings": {
                    "CommandAccepted": { "Value":"yes", "Time":"2016-06-17 19:55:19" },
                    "R-16B1A703-lgActionType": { "Value":"jmpToTarget", "Time":"2016-05-21 21:26:22" },
                    "R-16B1A703-shActionType": { "Value":"jmpToTarget", "Time":"2016-05-21 21:26:22" },
                    "R-16B1A704-lgActionType": { "Value":"jmpToTarget", "Time":"2016-05-21 21:26:23" },
                    "R-16B1A704-shActionType": { "Value":"jmpToTarget", "Time":"2016-05-21 21:26:23" },
                    "R-self01-lgActionType": { "Value":"jmpToTarget", "Time":"2016-05-21 21:26:24" },
                    "R-self01-shActionType": { "Value":"jmpToTarget", "Time":"2016-05-21 21:26:24" },
                    "R-sign": { "Value":"off", "Time":"2016-05-21 21:26:18" },
                    "R-wiga_fb19_5-lgActionType": { "Value":"jmpToTarget", "Time":"2016-05-21 21:26:20" },
                    "R-wiga_fb19_5-shActionType": { "Value":"jmpToTarget", "Time":"2016-05-21 21:26:20" },
                    "R-wiga_fb19_6-lgActionType": { "Value":"jmpToTarget", "Time":"2016-05-21 21:26:21" },
                    "R-wiga_fb19_6-shActionType": { "Value":"jmpToTarget", "Time":"2016-05-21 21:26:21" },
                    "RegL_01.": { "Value":"08:00 00:00", "Time":"2016-05-21 21:26:18" },
                    "RegL_03.16B1A703": { "Value":"02:00 03:00 04:32 05:64 06:00 07:FF 08:00 09:FF 0A:01 0B:14 0C:63 82:00 83:00 84:32 85:64 86:00 87:FF 88:00 89:FF 8A:21 8B:14 8C:63 00:00", "Time":"2016-05-21 21:26:22" },
                    "RegL_03.16B1A704": { "Value":"02:00 03:00 04:32 05:64 06:00 07:FF 08:00 09:FF 0A:01 0B:14 0C:63 82:00 83:00 84:32 85:64 86:00 87:FF 88:00 89:FF 8A:21 8B:14 8C:63 00:00", "Time":"2016-05-21 21:26:23" },
                    "RegL_03.self01": { "Value":"02:00 03:00 04:32 05:64 06:00 07:FF 08:00 09:FF 0A:01 0B:14 0C:63 82:00 83:00 84:32 85:64 86:00 87:FF 88:00 89:FF 8A:21 8B:14 8C:63 00:00", "Time":"2016-05-21 21:26:24" },
                    "RegL_03.wiga_fb19_5": { "Value":"02:00 03:00 04:32 05:64 06:00 07:FF 08:00 09:FF 0A:01 0B:14 0C:63 82:00 83:00 84:32 85:64 86:00 87:FF 88:00 89:FF 8A:21 8B:14 8C:63 00:00", "Time":"2016-05-21 21:26:20" },
                    "RegL_03.wiga_fb19_6": { "Value":"02:00 03:00 04:32 05:64 06:00 07:FF 08:00 09:FF 0A:01 0B:14 0C:63 82:00 83:00 84:32 85:64 86:00 87:FF 88:00 89:FF 8A:21 8B:14 8C:63 00:00", "Time":"2016-05-21 21:26:21" },
                    "deviceMsg": { "Value":"off (to HMLAN1)", "Time":"2016-06-17 19:55:19" },
                    "level": { "Value":"0", "Time":"2016-06-17 19:55:19" },
                    "pct": { "Value":"0", "Time":"2016-06-17 19:55:19" },
                    "peerList": { "Value":"wiga_fb19_5,wiga_fb19_6,16B1A703,16B1A704,self01,", "Time":"2016-06-17 19:41:46" },
                    "recentStateType": { "Value":"ack", "Time":"2016-06-17 19:55:19" },
                    "state": { "Value":"off", "Time":"2016-06-17 19:55:19" },
                    "timedOn": { "Value":"off", "Time":"2016-06-17 19:55:19" },
                    "trigLast": { "Value":"wiga_fb19_6:short", "Time":"2016-06-01 21:52:02" },
                    "trig_wiga_fb19_5": { "Value":"short", "Time":"2016-06-01 21:50:49" },
                    "trig_wiga_fb19_6": { "Value":"short", "Time":"2016-06-01 21:52:02" }
                },
                "Attributes": {
                    "model": "HM-LC-SW4-DR",
                    "peerIDs": "00000000,1174FE05,1174FE06,16B1A703,16B1A704,192B1C01,",
                    "room": "Wintergarten",
                    "webCmd": "statusRequest:toggle:on:off"
                }
            });

    for (var i = 0; i < objs.length; i++) {
        try {
            name = objs[i].Name.replace(/\./g, '_');

            if (objs[i].Attributes && objs[i].Attributes.room === 'hidden') continue;

            id = adapter.namespace + '.' + name;

            objects.push({
                _id:  id,
                type: 'channel',
                common: {
                    name: objs[i].Name
                },
                native: objs[i]
            });

            if (objs[i].Attributes && objs[i].Attributes.room) {
                var rrr = objs[i].Attributes.room.split(',');
                for (var r = 0; r < rrr.length; r++) {
                    rrr[r] = rrr[r].trim();
                    rooms[rrr[r]] = rooms[rrr[r]] || [];
                    rooms[rrr[r]].push(adapter.namespace + '.' + name);
                }
            }

            /*if (objs[i].PossibleAttrs) {
             var attrs = objs[i].PossibleAttrs.split(' ');
             for (var a = 0; a < attrs.length; a++) {
             if (!attrs[a]) continue;
             var parts = attrs[a].split(':');
             id = adapter.namespace + '.' + name + '.' + parts[0].replace(/\./g, '_');
             obj = {
             _id:  id,
             type: 'state',
             common: {
             name:   objs[i].Name + ' ' + parts[0],
             read:   true,
             write:  false
             },
             native: {
             Name: objs[i].Name,
             Attribute: parts[0]
             }
             };

             if (parts[1]) {
             var states = parts[1].split(',');
             obj.common.states = JSON.stringify(states);
             if (parseFloat(states[0]) == states[0]) {
             obj.common.type = 'number';
             }
             }
             objects.push(obj);
             //console.log('   ' + obj._id + ': ' + (parts[1] || ''));
             }
             }*/
            var isOn  = false;
            var isOff = false;

            if (objs[i].PossibleSets) {
                var attrs = objs[i].PossibleSets.split(' ');
                for (var a = 0; a < attrs.length; a++) {
                    if (!attrs[a]) continue;
                    var parts = attrs[a].split(':');

                    // ignore some useless "sets"
                    if (ignoreStates.indexOf(parts[0]) !== -1) continue;

                    id = adapter.namespace + '.' + name + '.' + parts[0].replace(/\./g, '_');

                    if (parts[0] === 'off') isOff = true;
                    if (parts[0] === 'on')  isOn  = true;

                    obj = {
                        _id:  id,
                        type: 'state',
                        common: {
                            name:   objs[i].Name + ' ' + parts[0],
                            read:   false,
                            write:  true
                        },
                        native: {
                            Name: objs[i].Name,
                            Attribute: parts[0]
                        }
                    };
                    if (parts[1]) {
                        var states = parts[1].split(',');
                        obj.common.states = JSON.stringify(states);
                        if (parseFloat(states[0]) == states[0]) {
                            obj.common.type = 'number';
                        }
                    }

                    obj.common.type = obj.common.type || 'string';
                    obj.common.role = 'state';

                    if (parts[0].indexOf('RGB') !== -1) {
                        obj.common.role = 'light.color.rgb';
                        obj.native.rgb = true;
                    }
                    if (parts[0].indexOf('HSV') !== -1) {
                        obj.common.role = 'light.color.hsv';
                        obj.native.hsv = true;
                    }
                    objects.push(obj);

                    //console.log('   ' + obj._id + ': ' + (parts[1] || ''));
                }
            }

            if (objs[i].Readings) {
                for (var attr in objs[i].Readings) {
                    // ignore some useless states
                    if (ignoreStates.indexOf(attr) !== -1) continue;

                    id = adapter.namespace + '.' + name + '.' + attr.replace(/\./g, '_');
                    obj = {
                        _id:  id,
                        type: 'state',
                        common: {
                            name:   objs[i].Name + ' ' + attr,
                            read:   true,
                            write:  false,
                            unit:   getUnit(attr)
                        },
                        native: {
                            Name: objs[i].Name,
                            Attribute: attr
                        }
                    };

                    if (objs[i].Readings[attr]) {
                        var val = convertFhemValue(objs[i].Readings[attr].Value);
                        obj.common.type = typeof val;
                        obj.common.role = 'state';
                        states.push({id: obj._id, val: val, ts: new Date(objs[i].Readings[attr].Time).getTime(), ack: true});
                        objects.push(obj);
                    }
                    if (isOff && isOn && attr === 'state') {
                        obj.common.write  = true;
                        obj.native.onoff  = true;
                        obj.common.role   = 'switch';
                    }
                }
                delete objs[i].Readings;
            }

            /*id = adapter.namespace + '.' + name + '.lastError';
             obj = {
             _id:  id,
             type: 'state',
             common: {
             name:   objs[i].Name + ' lastError',
             read:   true,
             write:  false,
             def:    '',
             type:   'string',
             role:   'error'
             },
             native: objs[i]
             };
             objects.push(obj);*/

            /*id = adapter.namespace + '.' + objs[i].Name + '.validity';
             obj = {
             _id:  id,
             type: 'state',
             common: {
             name:   objs[i].Name + ' validity',
             read:   true,
             write:  false,
             def:    '',
             type:   'string',
             role:   'state.quality'
             },
             native: objs[i]
             };
             objects.push(obj);*/

        } catch (err) {
            adapter.log.error('Cannot process object: ' + JSON.stringify(objs[i]));
            adapter.log.error('Cannot process object: ' + err);
        }
    }

    syncObjects(objects, function () {
        syncRooms(rooms, function () {
            syncStates(states, cb);
        });
    });
}

function startSync(cb) {
    // send command JsonList2
    telnetOut.send('jsonlist2', function (err, result) {
        if (err) {
            adapter.log.error(err);
        }

        if (!connected) {
            adapter.log.debug('Connected');
            connected = true;
            adapter.setState('info.connection', true, true);
        }
        
        if (result) {
            var objects = null;
            try {
                objects = JSON.parse(result)
            } catch (e) {
                adapter.log.error('Cannot parse answer for jsonlist2: ' + e);
            }
            if (objects) {
                parseObjects(objects.Results, function () {
                    adapter.log.info('Synchronised!');
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

function convertFhemValue(val) {
    val = val.trim();
    if (val === 'true')     return true;
    if (val === 'false')    return false;
    if (val === 'on')       return true;
    if (val === 'off')      return false;
    if (val === 'ok')       return 'ok'; // what can it be?
    var f = parseFloat(val);
    if (f == val) return f;
    return val;
}

function readValue(id, cb) {
    telnetOut.send('get ' + fhemObjects[id].native.Name + ' ' + fhemObjects[id].native.Attribute, function (err, result) {
        if (err) adapter.log.error('writeValue: ' + err);
        //MeinWetter city => Berlin
        if (result) {
            result = convertFhemValue(result.substring(fhemObjects[id].native.Name.length + fhemObjects[id].native.Attribute + 5));
            if (result !== '') {
                adapter.setForeignState(id, result, true);
            }
        }

        if (cb) cb();
    });
}

function writeValue(id, val, cb) {
    var cmd;
    if (val === undefined || val === null) val = '';

    // May be RGB
    if (typeof val === 'string' && val[0] === '#' && val.length > 3) return val.substring(1);

    if (fhemObjects[id].native.rgb) {
        // todo
    }
    if (fhemObjects[id].native.onoff) {
        cmd = 'set ' + fhemObjects[id].native.Name + ' ';
        if (val === '1' || val === 1 || val === 'on' || val === 'true' || val === true) {
            cmd += 'on';
        } else {
            cmd += 'off';
        }
    } else {
        cmd = 'set ' + fhemObjects[id].native.Name + ' ' + fhemObjects[id].native.Attribute + ' ' + val;
    }

    adapter.log.debug('Control: "' + cmd + '"');

    telnetOut.send(cmd, function (err, result) {
        if (err) adapter.log.error('writeValue: ' + err);
        if (cb) cb();
    });
}

function requestMeta(name, attr, value, cb) {
    if (cb) cb();
    var _id =  adapter.namespace + '.' + name.replace(/\./g, '_') + '.' + attr.replace(/\./g, '_');
    if (fhemObjects[_id]) {
        parseEvent(name + ' ' + attr + ' ' + value);
        if (cb) {
            cb();
            cb = null;
        }
    } else {
        telnetOut.send('JsonList2 ' + name, function (err, result) {
            var objects = null;
            try {
                objects = JSON.parse(result)
            } catch (e) {
                adapter.log.error('Cannot parse answer for jsonlist2: ' + e);
            }
            if (objects) {
                parseObjects(objects.Results, function () {
                    var id = adapter.namespace + '.' + name.replace(/\./g, '_') + '.' + attr.replace(/\./g, '_');
                    if (fhemObjects[id]) {
                        parseEvent(name + ' ' + attr + ' ' + value);
                    } else {
                        adapter.log.warn('Readings "' + attr + '" still not found in "' + name + '" after JsonList2');
                    }
                    if (cb) {
                        cb();
                        cb = null;
                    }
                });
            } else if (cb) {
                cb();
                cb = null;
            }
        });
    }
}

function processQueue() {
    if (telnetOut.isCommandRunning() || !queue.length) return;
    var command = queue.shift();
    if (command.command === 'resync') {
        startSync(function () {
            setTimeout(processQueue, 0);
        });
    } else if (command.command === 'read') {
        readValue(command.id, function () {
            setTimeout(processQueue, 0);
        });
    } else if (command.command === 'write') {
        writeValue(command.id, command.val, function () {
            setTimeout(processQueue, 0);
        });
    } else if (command.command === 'meta') {
        requestMeta(command.name, command.attr, command.val, function () {
            setTimeout(processQueue, 0);
        });
    } else {
        adapter.log.error('Unknown task: ' + command.command);
        setTimeout(processQueue, 0);
    }
}

function main() {
    adapter.config.host = adapter.config.host || '127.0.0.1';
    adapter.config.port = parseInt(adapter.config.port, 10) || 7072;
    adapter.config.reconnectTimeout = parseInt(adapter.config.reconnectTimeout, 10) || 30000;

    // in this template all states changes inside the adapters namespace are subscribed
    adapter.subscribeStates('*');

    telnetIn = new Telnet({
        host:               adapter.config.host,
        port:               adapter.config.port,
        reconnectTimeout:   adapter.config.reconnectTimeout,
        readOnly:           true
    });
    telnetIn.on('data', function (data) {
        parseEvent(data);
    });

    telnetOut = new Telnet({
        host:             adapter.config.host,
        port:             adapter.config.port,
        reconnectTimeout: adapter.config.reconnectTimeout
    });
    
    telnetOut.on('ready', function () {
        if (!connected) {
            startSync();
        }
    });
    telnetOut.on('end', function () {
        if (connected) {
            adapter.log.debug('Disconnected');
            connected = false;
            adapter.setState('info.connection', false, true);
        }
    });
    telnetOut.on('close', function () {
        if (connected) {
            adapter.log.debug('Disconnected');
            connected = false;
            adapter.setState('info.connection', false, true);
        }
    });
}
