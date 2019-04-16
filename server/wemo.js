let log = require('./log.js'),
    Q = require('q'),
    util = require('util'),
    timeout = require('./timeout.js');

module.exports = class Wemo {
    constructor(config, name){
        this.name = name;
        this.log = log('Wemo ' + this.name);
        this.log.info(`Initializing ${name}.`);
        this.reset();
    }

    async reset(){
        let underlying = require('wemo-client');
        this.underlying = new underlying();
        await this.getClient(true);
    }

    async getState(){
        try {
            let state = await this.getClientState();
            this.log.debug(`got state for ${this.name}: ${state}`);
            return {on: state === '1' || state === 1 || state === true};
        }
        catch (e){
            this.log.error(`Error getting state for ${this.name}: ${e}`);
            return {offline: true};
        }
    }

    on(){
        try {
            return this.changeState(true);
        }
        catch (e){
            return {offline: true};
        }
    }

    off(){ 
        try {
            return this.changeState(false);
        }
        catch (e){
            return {offline: true};
        }
    }

    toggle(){ 
        return this.changeState();
    }
    
    async changeState(newState, retrying){
        this.log.debug(`Change ${this.name} to ${newState}${retrying ? ' (retrying)' : ''}.`);
        try {
            let client = await this.getClient();
            this.log.debug('Client found for ' + this.name + ': '); 
            return await this.setClientState(newState);
        }
        catch (err) {
            if (retrying){
                this.log.error(`Failed on retry to change state for ${this.name}: ${err}`);
                return false
            }
            else {
                this.log.info('Retrying changeState:', this.name);
                return await this.changeState(newState, true);
            }
        }
    }

    getClient(forceDiscover){
        this.log.trace(`wemo: get client for ${this.name}`);
        return new Promise((resolve, reject) => {
            let name = this.name.substring(0, 1).toUpperCase() + this.name.substring(1);

            if (!forceDiscover && this.client) {
                this.log.debug(`Already had client for ${name}.`);
                resolve(this.client);
            }
            else {
                try {
                    this.underlying.discover((err, deviceInfo) => {
                        try {
                            if (err){
                                this.log.error('Error: ' + err);
                            }
                            else if (deviceInfo){
                                if (deviceInfo.friendlyName.toLowerCase() == name.toLowerCase()){
                                    this.log.info(`Wemo device ${deviceInfo.friendlyName} is at ${deviceInfo.host}:${deviceInfo.port}`);
                                    this.client = this.underlying.client(deviceInfo);
                                    resolve(this.client);
                                }
                            }
                            else {
                                this.log.warn('No device info?');
                            }
                        }
                        catch (e){
                            this.log.error("Can't discover devices: " + e);
                            reject(e);
                        }
                    });
                }
                catch (e) {
                    this.log.error(`Failed to discover Wemo devices.`);
                    this.log.error(e);
                }
            }
        });
    }

    async getClientState(){
        try {
            let client = await this.getClient();
            if (!client) throw `Can't get client for ${this.name}`;
            let get = util.promisify(client.getBinaryState.bind(client));
            return await get();
        }
        catch (e){
            this.log.error(`Failed to get state for ${this.name}. ${e}`);
        }
    }

    async setClientState(newState){
        try {
            let client = await this.getClient();
            if (!client) throw `Can't get client for ${this.name}`;
            let set = util.promisify(client.setBinaryState.bind(client));
            let get = util.promisify(client.getBinaryState.bind(client));
            let state = await get();
            state = state === 1 || state === '1' || state === true;
            if (newState === undefined){
                this.log.debug("Toggling state from " + state + ".");
                await set(state ? 0 : 1);
            }
            else if (state != !!newState){
                this.log.debug("Setting to state " + newState + ".");
                await set(newState ? 1 : 0);
            }
            else {
                this.log.debug("Was already in state " + state + ".");
            }

            return true;
        }
        catch (e) {
            this.log.error("Can't communicate with Wemo: " + e);
            return false;
        }
    }
}
