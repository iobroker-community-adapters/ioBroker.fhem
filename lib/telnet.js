'use strict';

const events = require('events');
const net    = require('net');
const util   = require('util');

// define a constructor (object) and inherit EventEmitter functions
function Telnet(options) {
    if (!(this instanceof Telnet)) return new Telnet();

    const that = this;
    this.params = {
        port:       options.port     || 7072,
        host:       options.host     || '127.0.0.1',
        password:   options.password || '',
        _reconnect: options.reconnectTimeout || 10000,
        _readOnly:  options.readOnly || false,
        prompt:     options.prompt   || 'fhem'
    };
    this.connectTimeout = null;
    this.requestCB  = null;
    this.result     = '';
    this.ready      = false;
    this.shutdown   = false;

    this.connect = function () {
        let buffer = '';
        that.ready = false;

        if (this.connectTimeout) {
            clearTimeout(this.connectTimeout);
            this.connectTimeout = null;
        }

        this.telnetSocket = net.createConnection(this.params, () => {
            // write password
            if (that.params.password) {
                that.telnetSocket.write(that.params.password + '\n');
                that.telnetSocket.write('\n\n');
            } else {
                that.telnetSocket.write('\n\n\n');
            }
        });

        this.telnetSocket.on('error', error => {
            buffer = null;
            if (that.telnetSocket) {
                that.emit('error', error);
                that.telnetSocket.destroy();
                that.telnetSocket = null;
            }
            if (!that.shutdown && !that.connectTimeout) that.connectTimeout = setTimeout(that.connect.bind(that), that.params._reconnect);
        });

        this.telnetSocket.on('end', () => {
            buffer = null;
            if (that.telnetSocket) {
                that.telnetSocket.destroy();
                that.telnetSocket = null;
                that.emit('end');
            }
            if (!that.shutdown && !that.connectTimeout) that.connectTimeout = setTimeout(that.connect.bind(that), that.params._reconnect);
        });

        this.telnetSocket.on('close', () => {
            buffer = null;
            if (that.telnetSocket) {
                that.telnetSocket.destroy();
                that.telnetSocket = null;
                that.emit('close');
            }
            if (!that.shutdown && !that.connectTimeout) that.connectTimeout = setTimeout(that.connect.bind(that), that.params._reconnect);
        });

        this.telnetSocket.on('data', data => {
            if (that.shutdown) {
                return;
            }

            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines[lines.length - 1];
            lines.pop();
            for (let line = 0; line < lines.length; line++) {
                if (that.ready && lines[line] === that.params.prompt + ' ') {
                    continue;
                }

                // if event connection
                if (that.params._readOnly) {
                    // if no prompt yet received
                    if (!that.ready) {
                        // wait for prompt
                        if (lines[line] === that.params.prompt + ' ') {
                            that.ready = true;
                            // send "inform" command
                            setTimeout(() => that.telnetSocket.write('inform on\n'), 100);
                        }
                    } else {
                        // emit command
                        that.emit('data', lines[line]);
                    }
                } else {
                    // if command connection
                    // if no prompt yet received
                    if (!that.ready) {
                        // wait for prompt
                        if (lines[line] === that.params.prompt + ' ') {
                            that.ready = true;
                            that.emit('ready');
                        }
                    } else
                    // command finished
                    if (lines[line] === that.params.prompt + ' ') {
                        if (that.requestCB) {
                            that.requestCB(null, that.result);
                            that.result    = '';
                            that.requestCB = null;
                        }
                    } else if (that.requestCB && lines[line].trim()) {
                        that.result += lines[line] + '\n';
                    } // else ignore
                }
            }

            // if prompt
            if (buffer === that.params.prompt + ' ') {
                buffer = '';
                if (that.params._readOnly) {
                    if (!that.ready) {
                        that.ready = true;
                        that.telnetSocket && setTimeout(() =>
                            that.telnetSocket && that.telnetSocket.write('inform on\n'), 100);
                    }
                } else {
                    if (!that.ready) {
                        that.ready = true;
                        that.emit('ready');
                    } else if (that.requestCB) {
                        // command finished
                        that.requestCB(null, that.result);
                        that.result    = '';
                        that.requestCB = null;
                    }
                }
            }
        });
    };

    this.send = function (cmd, cb) {
        if (!cmd) return;
        if (cmd[cmd.length - 1] !== '\n') {
            cmd += '\n';
        }

        if (that.telnetSocket) {
            that.telnetSocket.write(cmd);
        } else {
            that.emit('error', 'Socket not exists');
        }

        if (cb) {
            this.result = null;
            this.result = '';
            this.requestCB = cb;
        }
    };

    this.destroy = function () {
        this.shutdown = true;
        if (this.connectTimeout) {
            clearTimeout(this.connectTimeout);
            this.connectTimeout = null;
        }

        if (this.telnetSocket) {
            this.telnetSocket.destroy();
            this.telnetSocket = null;
        }
    };

    this.isReady = function () {
        return this.ready;
    };

    this.isCommandRunning = function () {
        return !!this.requestCB;
    };

    this.connect();

    return this;
}

util.inherits(Telnet, events.EventEmitter);

module.exports = Telnet;

