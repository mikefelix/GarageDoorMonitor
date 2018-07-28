let {get, put} = require('request'),
    EtekClient = require('./etek-client.js'),
    log = require('./log.js')('Etek', false),
    Q = require('q');

module.exports = class Etek {
    constructor(login, password, baseUrl, bulbs){
        log(`Etek starting with ${login}/${password}/${baseUrl}`);
        this.client = new EtekClient(login, password, baseUrl);
        this.bulbs = bulbs;
    }

    async getState(){
        let devices = await this.client.getDevices();
        let result = {};
        for (let i in devices){
            let device = devices[i];
            if (this.bulbs.indexOf(device.name) >= 0){
                let meter = await this.client.getMeter(device.id);
                result[device.name] = {
                    on: device.on,
                    power: meter.power
                };
            }
        }

        return result;
    }

    async getMeter(name){
        let device = await this.client.getDevice(name);
        let meter = await this.client.getMeter(device.id);
        return meter.power;
    }

    async getBulbState(name){
        let device = await this.client.getDevice(name);
        let meter = await this.client.getMeter(device.id);
        return {
            on: device.on,
            power: meter
        };
    }

    async toggle(name, timeout) {
        let device = await this.client.getDevice(name);
        if (device.on) {
            log(`Toggling device ${device.name} off.`);
            let state = await this.client.turnOff(device.id);
            log(`Toggled off. New state is ${state.on}.`);
            return true;
        }
        else {
            log(`Toggling device ${device.name} on.`);
            let state = await this.client.turnOn(device.id);
            log(`Toggled on. New state is ${state.on}.`);
            return true;
        }
    }

    async on(name, timeout) {
        let device = await this.client.getDevice(name);
        log(`Turning device ${device.name} on.`);
        await this.client.turnOn(device.id);
        return true;
    }

    async off(name) {
        let device = await this.client.getDevice(name);
        log(`Turning device ${device.name} off.`);
        await this.client.turnOff(device.id);
        return true;
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

