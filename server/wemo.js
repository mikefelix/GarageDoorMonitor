let log = require('./log.js')('Wemo'),
    Q = require('q'),
    timeout = require('./timeout.js');

module.exports = class Wemo {
    constructor(bulbs){
        log.info(`Initializing Wemo.`);
        this.reset();
        this.bulbs = bulbs;
        this.clients = {};
        this.timeouts = {};

        /*
        wemo.discover((err, info) => {
            if (err){
                log.error('Error on discovery: ' + err);
            }
            else {
                log.debug('on startup, discovered ' + info.friendlyName);
                let client = wemo.client(info);
                this.clients[info.friendlyName] = client;
            }
        });
        */
    }

    reset(){
        let client = require('wemo-client');
        this.wemo = new client();
        this.clients = {};
        this.timeouts = {};
    }

    getState(){
        let promiseTimer = timeout(15000, null);
        let promises = [];

        for (let i = 0; i < this.bulbs.length; i++){
            let bulb = this.bulbs[i];
            try {
                log.debug(`Get state for ${bulb}.`);
                promises.push(promiseTimer(this.getBulbState(bulb), 'get bulb ' + bulb));
            }
            catch (e){
                log.error(`Error getting wemo state for bulb ${bulb}`);
            }
        }

        return Q.all(promises).then(states => {
            let totalState = {};
            for (let i = 0; i < this.bulbs.length; i++){
                let bulb = this.bulbs[i];
                log.debug(`State for ${bulb} is ${JSON.stringify(states[i])}.`);

                if (states[i]){
                    totalState[bulb] = states[i];
                    delete this.timeouts[bulb];
                }
                else {
                    this.timeouts[bulb] == (this.timeouts[bulb] || 0) + 1;
                    if (this.timeouts[bulb] >= 5){
                        log.error(`Too many timeouts for ${bulb}. Resetting devices.`);
                        this.reset();
                    }

                    totalState[this.bulbs[i]] = {offline: true};
                }

            }

            return totalState;
        });
    }

    async getBulbState(bulb){
        try {
            bulb = this._lowercase(bulb);
            let client = await this._getClient(bulb);
            log.debug(`got a client for ${bulb}`);
            let state = await this._getClientState(client);
            log.debug(`got state for ${bulb}: ${state}`);
            return {on: state === '1' || state === 1 || state === true};
        }
        catch (e){
            log.error(`Error getting state for ${bulb}: ${e}`);
            return {offline: true};
        }
    }

    async on(name){
        name = this._lowercase(name);
        return await this._changeState(name, true);
    }

    async off(name){ 
        name = this._lowercase(name);
        return await this._changeState(name, false);
    }

    async toggle(name){ 
        name = this._lowercase(name);
        return await this._changeState(name);
    }
    
    async _changeState(name, newState, retrying){
        log.debug(`Change ${name} to ${newState}${retrying ? ' (retrying)' : ''}.`);
        try {
            let client = await this._getClient(name);
            log.debug('Client found for ' + name + ': '); 
            return await this._setClientState(client, newState);
        }
        catch (err) {
            if (retrying){
                log.error(`Failed on retry to change state for ${name}: ${err}`);
                return false
            }
            else {
                log.info('Retrying changeState:', name);
                return await this._changeState(name, newState, true);
            }
        }
    }

    _getClient(name, forceDiscover){
        log.trace(`wemo: get client for ${name}`);
        return new Promise((resolve, reject) => {
            name = name.substring(0, 1).toUpperCase() + name.substring(1);

            let client = this.clients[name];
            if (client) {
                log.debug(`Already had client for ${name}.`);
                resolve(client);
            }
            else {
                try {
                    this.wemo.discover((err, deviceInfo) => {
                        try {
                            if (err){
                                log.error('Error: ' + err);
                            }
                            else if (deviceInfo){
                                log.info(`Wemo device ${deviceInfo.friendlyName} is at ${deviceInfo.host}:${deviceInfo.port}`);

                                if (deviceInfo.friendlyName == name){
                                    this.clients[name] = this.wemo.client(deviceInfo);
                                    resolve(this.clients[name]);
                                }
                            }
                            else 
                                log.warn('No device info?');
                        }
                        catch (e){
                            log.error("Can't discover devices: " + e);
                            reject(e);
                        }
                    });
                }
                catch (e) {
                    log.error(`Failed to discover Wemo devices.`);
                    log.error(e);
                }
            }
        });
    }

    _getClientState(client){
        return new Promise((resolve, reject) => {
            try {
                 client.getBinaryState((err, state) => {
                     if (err){
                         log.error(`Error getting state: ${err}`);
                         reject(err);
                     }
                     else {
                         resolve(state);
                     }
                 });
            }
            catch (e){
                log.error(`Failed to get state for ${client.name}. ${e}`);
                reject(e);
            }
        });
    }

    _setClientState(client, newState){
        return new Promise((resolve, reject) => {
            try {
                client.getBinaryState((err, state) => {
                    state = state === 1 || state === '1' || state === true;
                    if (err) {
                        log.error("Error getting wemo state: " + err);
                        reject(err);
                    }
                    else if (newState === undefined){
                        log.debug("Toggling state from " + state + ".");
                        client.setBinaryState(state ? 0 : 1);
                        resolve(true);
                    }
                    else if (state != !!newState){
                        log.debug("Setting to state " + newState + ".");
                        client.setBinaryState(newState ? 1 : 0);
                        resolve(true);
                    }
                    else {
                        log.debug("Was already in state " + state + ".");
                        //resolve(false);
                        resolve(true);
                    }
                });
            }
            catch (e) {
                log.error("Can't communicate with Wemo: " + e);
                reject(e);
            }
        });
    }

    _lowercase(name){
        return name.substring(0, 1).toUpperCase() + name.substring(1);
    }
}
