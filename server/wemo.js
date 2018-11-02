const WemoClient = require('wemo-client'),
      log = require('./log.js')('Wemo'),
      Q = require('q'),
      timeout = require('./timeout.js'),
      wemo = new WemoClient();

module.exports = class Wemo {
    constructor(bulbs){
        this.clients = {};
        this.bulbs = bulbs;
        wemo.discover(info => {
            log.debug('on startup, discovered ' + info.friendlyName);
            let client = wemo.client(info);
            this.clients[info.friendlyName] = client;
        });
    }

    getState(){
        let promiseTimer = timeout(5000, null);

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
                log.debug(`State for ${this.bulbs[i]} is ${states[i]}.`);
                totalState[this.bulbs[i]] = states[i];
            }

            return totalState;
        });
    }

    async getBulbState(bulb){
        bulb = this._lowercase(bulb);
        let client = await this._getClient(bulb);
        let state = await this._getClientState(client);
        return {on: state === '1' || state === 1 || state === true};
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
                throw err;
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
            //forceDiscover = true; // TODO: needed?
            //if (forceDiscover)
                //delete this.clients[name];

            let client = this.clients[name];
            if (client) {
                resolve(client);
            }
            else {
                try {
                    wemo.discover(deviceInfo => {
                        try {
                            if (deviceInfo){
                                log.trace(`Wemo device ${deviceInfo.friendlyName} is at ${deviceInfo.host}:${deviceInfo.port}`);

                                if (deviceInfo.friendlyName == name){
                                    this.clients[name] = wemo.client(deviceInfo);
                                    resolve(this.clients[name]);
                                }
                            }
                            else 
                                log.warn('No device info?');
                        }
                        catch (e){
                            log.error("Cab't discover devices: " + e);
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
                     if (err)
                        reject(err);
                     else 
                        resolve(state);
                 });
            }
            catch (e){
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
