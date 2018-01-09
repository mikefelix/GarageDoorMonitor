let {get, put} = require('request'),
    EtekClient = require('./etek-client.js'),
    Q = require('q');

module.exports = class Etek {
    constructor(login, password){
        this.client = new EtekClient();
        this.login = login;
        this.password = password;
    }

    async getState(){
        let devices = await this._getDevices();
        let state = {};
        for (let d of devices){
            state[d.name] = (d.status == 'open');
        }

        return state;
    }

    async getBulbState(name){
        let device = await this._getDevice(name);
        return device.status == 'open';
    }

    async toggle(name, timeout) {
        let device = await this._getDevice(name);
        if (device.status === 'open') {
            console.log(`Toggling device ${device.name} off.`);
            return this.client.turnOff(device.id).then(state => state.relay != 'open');
        }
        else {
            console.log(`Toggling device ${device.name} on.`);
            return this.client.turnOn(device.id).then(state => state.relay == 'open');
        }
    }

    async on(name, timeout) {
        let device = await this._getDevice(name);
        console.log(`turning device ${device.name} on`);
        return this.client.turnOn(device.id).then(state => state.relay == 'open');;
    }

    async off(name) {
        let device = await this._getDevice(name);
        console.log(`turning device ${device.name} off`);
        return this.client.turnOff(device.id).then(state => state.relay != 'open');;
    }

    _getDevices() {
        return this.client.login(this.login, this.password).then(() => { return this.client.getDevices(); } );
    }

    async _getDevice(name) {
        let devices = await this._getDevices();
        let device = devices.find(d => d.name == name);
        if (!device) throw 'Cannot find device ' + name;
        return device;
    }

}

