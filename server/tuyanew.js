const TuyDevice = require('tuyapi'),
      log = require('./log.js');

module.exports = class Tuyanew {
    constructor(config, device){
        this.name = device.name;
        this.index = device.index;
        this.log = log('Tuyanew ' + this.name);
        this.log.info(`Initializing ${this.name}.`);

        this.device = new TuyDevice({
            id: device.id,
            key: device.key,
            ip: device.ip,
            version: 3.3
        });

        this.device.on('connected', () => {
           this.log.trace('Connected to device!');
        });
        
        this.device.on('disconnected', () => {
            this.log.trace('Disconnected from device.');
        });
        
        this.device.on('error', error => {
            this.log.error('Error!' + error);
        });
    }

    async getState() {
        try {
            await this.device.find();
            await this.device.connect();

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
        finally {
            this.device.disconnect();
        }
    }
    
    async _set(setting) {
        try {
            await this.device.find();
            await this.device.connect();

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
        finally {
            this.device.disconnect();
        }
    }

    logAt(level){
        this.log.setLevel(level);
    }

    on() { return this._set(true); }
    off() { return this._set(false); }
    toggle() { return this._set(); }
}
