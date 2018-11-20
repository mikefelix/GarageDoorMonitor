const TuyAPI = require('tuyapi');
const log = require('./log.js')('Tuya');

module.exports = class Tuya {
    constructor(config){
        this.switches = {};
        this.devices = {};
        for (let conf of config){
            let dev = this.devices[conf.id] = new TuyAPI({
                id: conf.id,
                key: conf.key,
                ip: conf.ip
            });

            let switches = conf.switches;
            for (let i in switches){
                this.switches[switches[i]] = {
                    device: dev,
                    deviceId: conf.id,
                    index: +i + 1
                };
            }
        }
    }

    getDeviceStates() {
        let promises = [];
        let ids = Object.keys(this.devices);

        for (let id of ids){
            promises.push(this.devices[id].get({schema: true}));
        }

        return Promise.all(promises).then(results => {
            let state = {}; 
            for (let index in ids){
                log.debug(`Got state for device ${ids[index]}: ${JSON.stringify(results[index])}`);
                state[ids[index]] = results[index].dps;
            }

            return state;
        });
    }

    async getState() {
        try {
            let deviceStates = await this.getDeviceStates();
            let state = {};
            for (let sw in this.switches){
                let swit = this.switches[sw];
                let device = swit.device;
                let devState = deviceStates[swit.deviceId];
                log.debug(`State for switch ${sw} is ${devState[swit.index]} -- index ${swit.index} in device ${swit.deviceId}: ${JSON.stringify(devState)}.`);
                state[sw] = { on: devState[swit.index] };
            }
            
            log.debug(state);
            return state;
        }
        catch (e) {
            log.error("Can't get device states. " + e);
        }
    }

    async getBulbState(name) {
        let swit = this.switches[name];
        if (!swit) throw 'Unknown device ' + name;

        try {
            let status = await swit.device.get({schema: true});
            log.debug(`Got device status ${JSON.stringify(status)}.`);
            let res = {on: status.dps[swit.index]}; 
            log.debug(`Returning ${JSON.stringify(res)}`);
            return res;
        }
        catch (e) { 
            log.error('Error retrieving state: ' + e);
            return {error: e};
        }
    }
    
    async _set(name, setting, timeout) {
        try {
            let swit = this.switches[name];
            if (!swit) throw 'Unknown device ' + name;

            if (setting === undefined){
                setting = !(await swit.device.get({dps: swit.index}));
            }

            log.debug(`Turn ${setting ? 'on' : 'off'} ${name} at index ${swit.index}.`); 
            await swit.device.set({dps: swit.index, set: setting }); 
            let res = await swit.device.get({dps: swit.index}); 
            log.debug(`${name} is now ${res}.`);
            return res;
        }
        catch (e){
            log.error('Error: ' + e);
        }
    }

    on(name) { return this._set(name, true); }
    off(name) { return this._set(name, false); }
    toggle(name) { return this._set(name); }
}
