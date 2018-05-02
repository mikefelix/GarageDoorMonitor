const WemoClient = require('wemo-client'),
      log = require('./log.js')('Wemo'),
      wemo = new WemoClient();

module.exports = class Wemo {
    constructor(bulbs){
        this.clients = {};
        this.bulbs = bulbs;
        wemo.discover(info => {
            log('on startup, discovered ' + info.friendlyName);
            let client = wemo.client(info);
            this.clients[info.friendlyName] = client;
        });
    }

    async getState(){
        let totalState = {};
        for (let i = 0; i < this.bulbs.length; i++){
            let bulb = this.bulbs[i];
            try {
                totalState[bulb] = await this.getBulbState(bulb);
            }
            catch (e){
                log(`Error getting wemo state for bulb ${bulb}`);
            }
        }

        return totalState;
    }

    async getBulbState(bulb){
        bulb = this._lowercase(bulb);
        let client = await this._getClient(bulb);
        let state = await this._getClientState(client);
        return state === '1' || state === 1 || state === true;
    }

    on(name, timeout){
        name = this._lowercase(name);
        return this._changeState(name, true);
    }

    off(name){ 
        name = this._lowercase(name);
        return this._changeState(name, false);
    }

    toggle(name, timeout){ 
        name = this._lowercase(name);
        return this._changeState(name);
    }
    
    async _changeState(name, newState, retrying){
        log(`Change ${name} to ${newState} (retrying ${!!retrying})`);
        try {
            let client = await this._getClient(name);
            //log('Client found for ' + name + ': '); console.dir(client);
            return await this._setClientState(client, newState);
        }
        catch (err) {
            if (retrying){
                throw err;
            }
            else {
                log('Retrying changeState:', name);
                return await this._changeState(name, newState, true);
            }
        }
    }

    _getClient(name, forceDiscover){
        //log(`wemo: get client for ${name}`);
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
                                log(`Wemo device ${deviceInfo.friendlyName} is at ${deviceInfo.host}:${deviceInfo.port}`);

                                if (deviceInfo.friendlyName == name){
                                    this.clients[name] = wemo.client(deviceInfo);
                                    resolve(this.clients[name]);
                                }
                            }
                            else 
                                log('No device info?');
                        }
                        catch (e){
                            log("Can't discover devices: " + e);
                            reject(e);
                        }
                    });
                }
                catch (e) {
                    log(`Failed to discover Wemo devices.`);
                    log(e);
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
                        log("Error getting wemo state: " + err);
                        reject(err);
                    }
                    else if (newState === undefined){
                        log("Toggling state from " + state + ".");
                        client.setBinaryState(state ? 0 : 1);
                        resolve(true);
                    }
                    else if (state != !!newState){
                        log("Setting to state " + newState + ".");
                        client.setBinaryState(newState ? 1 : 0);
                        resolve(true);
                    }
                    else {
                        log("was already in state " + state + ".");
                        //resolve(false);
                        resolve(true);
                    }
                });
            }
            catch (e) {
                log("Can't communicate with Wemo: " + e);
                reject(e);
            }
        });
    }

    _lowercase(name){
        return name.substring(0, 1).toUpperCase() + name.substring(1);
    }
}
