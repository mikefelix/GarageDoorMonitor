const TuyDevice = require('./tuya_legacy/index.js'),
      log = require('./log.js');

module.exports = class Tuya {
    constructor(config, device){
        this.name = device.name;
        this.index = device.index;
        this.log = log('Tuya ' + this.name);
        this.log.info(`Initializing ${this.name}.`);

        this.device = new TuyDevice({
            id: device.id,
            key: device.key,
            ip: device.ip
        });
    }

    async getState() {
        try {
            let status = await this.device.get({schema: true});
            this.log.debug(`Got device status ${JSON.stringify(status)}.`);
            let res = {on: status.dps[this.index]}; 
            this.log.debug(`Returning ${JSON.stringify(res)}`);
            return res;
        }
        catch (e) { 
            this.log.error('Error retrieving state: ' + e);
            return {error: e};
        }
    }
    
    async _set(setting) {
        try {
            if (setting === undefined){
                setting = !(await this.device.get({dps: this.index}));
            }

            this.log.debug(`Turn ${setting ? 'on' : 'off'} ${this.name} at index ${this.index}.`); 
            await this.device.set({dps: this.index, set: setting }); 
            let res = await this.device.get({dps: this.index}); 
            this.log.debug(`${this.name} is now ${res}.`);
            return res;
        }
        catch (e){
            this.log.error(`Error for ${this.name}: ${e}`);
        }
    }

    logAt(level){
        this.log.setLevel(level);
    }

    on() { return this._set(true); }
    off() { return this._set(false); }
    toggle() { return this._set(); }
}
