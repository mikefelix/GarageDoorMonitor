let {get, put} = require('request'),
    EtekClient = require('./etek-client.js'),
    log = require('./log.js')('Etek'),
    Q = require('q');

module.exports = class Etek {
    constructor(config, bulbs, meterBulbs){
        log.debug(`Etek starting with ${config.login}/${config.password}/${config.baseUrl}`);
        this.client = new EtekClient(config.login, config.password, config.baseUrl);
        this.bulbs = bulbs;
        this.meterBulbs = meterBulbs;
    }

    async getState(){
        try {
            let devices = await this.client.getDevices();
            let result = {};
            for (let i in devices){
                let device = devices[i];
                if (this.bulbs.indexOf(device.name) >= 0){
                    let meter;
                    if (this.meterBulbs.indexOf(device.name) >= 0){
                        log.debug(`get meter: ${device.id}`);
                        meter = await this.client.getMeter(device.id);
                    }

                    result[device.name] = {
                        on: device.on,
                        power: meter !== undefined ? meter.power : undefined
                    };
                }
            }

            return result;
        }
        catch (e){
            log.error(`Can't connect to etek. ${e}`);
            return {};
        }
    }

    async getMeter(name){
        try {
            let device = await this.client.getDevice(name);
            let meter = await this.client.getMeter(device.id);
            return meter.power;
        }
        catch (e){
            log.error(`Can't connect to etek for meter. ${e}`);
            return 0;
        }
    }

    async getBulbState(name){
        try {
            let device = await this.client.getDevice(name);
            let meter = await this.client.getMeter(device.id);
            return {
                on: device.on,
                power: meter
            };
        }
        catch (e){
            log.error(`Can't connect to etek for device ${name}. ${e}`);
            return {};
        }
    }

    async toggle(name, timeout) {
        try {
            let device = await this.client.getDevice(name);
            if (device.on) {
                log.debug(`Toggling device ${device.name} (${device.id}) off.`);
                let state = await this.client.turnOff(device.id);
                log.debug(`Toggled off. New state is ${state.on}.`);
                return true;
            }
            else {
                log.debug(`Toggling device ${device.name} (${device.id}) on.`);
                let state = await this.client.turnOn(device.id);
                log.debug(`Toggled on. New state is ${state.on}.`);
                return true;
            }
        } 
        catch (e){
            log.error(`Can't connect to toggle device ${name}. ${e}`);
            return false;
        }
    }

    async on(name, timeout) {
        try {
            let device = await this.client.getDevice(name);
            log.debug(`Turning device ${device.name} (${device.id}) on.`);
            await this.client.turnOn(device.id);
            return true;
        } 
        catch (e){
            log.error(`Can't connect to toggle device ${name}. ${e}`);
            return false;
        }
    }

    async off(name) {
        try {
            let device = await this.client.getDevice(name);
            log.debug(`Turning device ${device.name} (${device.id}) off.`);
            await this.client.turnOff(device.id);
            return true;
        } 
        catch (e){
            log.error(`Can't connect to toggle device ${name}. ${e}`);
            return false;
        }
    }

    /*async _getDevices() {
        if (!this.devices) {
            await this.client.login(this.login, this.password);
            this.devices = await this.client.getDevices();
            setTimeout(() => delete this.devices, 5000);
        }

        return this.devices;
    }

    async _getDevice(name) {
        let devices = await this._getDevices();
        let device = devices.find(d => d.name == name);
        if (!device) throw 'Cannot find device ' + name;
        return device;
    }*/

}

