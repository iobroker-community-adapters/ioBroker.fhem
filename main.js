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
            var setStates = {};

            if (objs[i].PossibleSets) {
                var attrs = objs[i].PossibleSets.split(' ');
                for (var a = 0; a < attrs.length; a++) {
                    if (!attrs[a]) continue;
                    var parts = attrs[a].split(':');

                    // ignore some useless "sets"
                    if (ignoreStates.indexOf(parts[0]) !== -1) continue;

                    var stateName = parts[0].replace(/\./g, '_');
                    id = adapter.namespace + '.' + name + '.' + stateName;


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
                    setStates[stateName] = obj;

                    //console.log('   ' + obj._id + ': ' + (parts[1] || ''));
                }
            }

            if (objs[i].Readings) {
                for (var attr in objs[i].Readings) {
                    // ignore some useless states
                    if (ignoreStates.indexOf(attr) !== -1) continue;

                    var stateName = attr.replace(/\./g, '_');
                    id = adapter.namespace + '.' + name + '.' + stateName;
                    var combined = false;
                    if (setStates[stateName]) {
                        combined = true;
                        obj = setStates[stateName];
                        obj.common.read = true;
                        obj.common.unit = getUnit(attr);
                    } else {
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
                    }

                    if (objs[i].Readings[attr]) {
                        var val = convertFhemValue(objs[i].Readings[attr].Value);
                        obj.common.type = obj.common.type || typeof val;
                        obj.common.role = obj.common.role || 'state';

                        states.push({
                            id:     obj._id, 
                            val:    val, 
                            ts:     objs[i].Readings[attr].Time ? new Date(objs[i].Readings[attr].Time).getTime() : new Date().getTime(), 
                            ack:    true
                        });

                        // detect on/off state
                        if (isOff && isOn && attr === 'state') {
                            obj.common.write = true;
                            obj.native.onoff = true;
                            obj.common.role  = 'switch';
                        }

                        if (!combined) objects.push(obj);
                    }
                }
                delete objs[i].Readings;
            }
            setStates = null;

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
        if (err) adapter.log.error('readValue: ' + err);
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
    if (typeof val === 'string' && val[0] === '#' && val.length > 3) val = val.substring(1);

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
