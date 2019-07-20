const util = require('util'),
      Hue = require('./hue.js'),
      Wemo = require('./wemo.js'),
      Etek = require('./etek.js'),
      Tuya = require('./tuya.js'),
      TuyaNew = require('./tuyanew.js'),
      Readonly = require('./readonly.js'),
      Alarm = require('./alarm.js'),
      Thermostat = require('./thermostat.js'),
      Garage = require('./garage.js'),
      Weather = require('./weather.js'),
      Fermenter = require('./fermenter.js'),
      timeout = require('./timeout.js'),
      Q = require('q'),
      log = require('./log.js')('Devices');

module.exports = class Devices {
    //constructor(bulbs, alarm, garagedoor, therm, fermenter, weather, readonly){
    constructor(config){
        this.devices = {};
        this.history = {};
        this.deviceTypes = {};
        this.deviceConfig = {
            etek: config.etek,
            hue: config.hue,
            wemo: config.wemo,
            tuya: config.tuya
        };

        if (config.etek){
            for (let device of (config.etek.devices || [])){ 
                this.deviceTypes[device] = 'etek';
                this.init(device); 
            }
        }

        if (config.hue){
            for (let device of (config.hue.devices || [])){ 
                this.deviceTypes[device.name] = 'hue';
                this.init(device); 
            }
        }

        if (config.wemo){
            for (let device of (config.wemo.devices || [])){ 
                this.deviceTypes[device] = 'wemo';
                this.init(device); 
            }
        }

        if (config.tuya){
            for (let device of (config.tuya.devices || [])){ 
                this.deviceTypes[device.name] = 'tuya';
                this.init(device); 
            }
        }

        if (config.tuyanew){
            for (let device of (config.tuyanew.devices || [])){ 
                this.deviceTypes[device.name] = 'tuyanew';
                this.init(device); 
            }
        }

        if (config.alarm){
            this.alarm = this.devices.alarm = new Alarm(config.alarm);
            this.devices.alarm.fireEvent = this.eventFired.bind(this);
        }

        /*if (config.garage){
            this.garagedoor = this.devices.garagedoor = new Garage(config.garage);
            this.devices.garagedoor.fireEvent = this.eventFired.bind(this);
        }*/

        if (config.weather){
            this.weather = this.devices.weather = new Weather(config.weather);
            this.devices.weather.fireEvent = this.eventFired.bind(this);
        }

        if (config.nest){
            this.therm = this.devices.therm = new Thermostat(config.nest.thermostatId, config.nest.structureId, config.nest.token, config.useExtraFan);
            this.devices.therm.fireEvent = this.eventFired.bind(this);
            this.devices.hvac = {
                getState: async () => {
                    let thermState = await this.devices.therm.getState();
                    if (!thermState){
                        return {};
                    }
                    else {
                        let weather = this.devices.weather,
                            temp = thermState.temp, 
                            target = thermState.target,
                            nearTarget;

                        if (weather && this.therm.useExtraFan){
                            let weatherState = await weather.getState();
                            if (thermState.mode == 'cool'){
                                //log.info(weatherState)
                                nearTarget = weatherState && temp >= target && temp - target <= 2;
                            }
                            else if (thermState.mode == 'heat'){
                                nearTarget = weatherState && temp <= target && target - temp <= 2;
                            }
                            else {
                                nearTarget = false;
                            }
                        }

                        return {
                            humidity: thermState.humidity,
                            away: thermState.away,
                            temp,
                            target,
                            nearTarget,
                            state: thermState.state,
                            mode: thermState.mode,
                            on: thermState.state == 'heating' || thermState.state == 'cooling'
                        }
                    }
                }
            };

            this.devices.housefan = {
                getState: async () => {
                    let thermState = await this.devices.therm.getState();
                    if (!thermState){
                        return {};
                    }
                    else {
                        return {
                            on: thermState.on,
                            offTime: thermState.fanOffTime
                        }
                    }
                }
            };
        }
        else log.error(`Not setting up thermostat.`);

        if (config.fermenter){
            this.fermenter = this.devices.fermenter = new Fermenter(config.fermenter);
            this.devices.fermenter.fireEvent = this.eventFired.bind(this);
        }

        if (config.devices){
            for (let dev in config.devices){
                this.devices[dev] = new Readonly(null, {name: dev, ip: config.devices[dev]});
            }
        }

        if (config.aliases){
            this.aliases = config.aliases;
        }

        log.info(`Devices initialized: ${Object.keys(this.devices)}`);
    }

    init(device, type) {
        let name = typeof device == 'string' ? device : device.name;
        if (!type) type = this.deviceTypes[name];
        if (!type) {
            log.error('Unknown device type for ' + name);
            return;
        }

        let clazz;
        if (type == 'etek')
            clazz = Etek;
        else if (type == 'wemo')
            clazz = require('./wemo.js');
        else if (type == 'hue')
            clazz = Hue;
        else if (type == 'tuya')
            clazz = Tuya;
        else if (type == 'tuyanew')
            clazz = TuyaNew;
        else
            throw 'No constructor for type ' + type;

        let conf = this.deviceConfig[type];
        log.info(`Create new ${type} ${name}.`);
        this.devices[name] = new clazz(conf, device);
        this.devices[name].type = 'device';
        this.history[name] = {};
    }

    getDeviceNameByIp(ip){
        for (let dev in this.devices){
            if (this.devices[dev].ip == ip){
                log.info(`${ip} is ${dev}.`);
                return dev;
            }
        }

        throw 'No device for ip ' + ip;
    }

    reset(device){
        if (device.match(/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/)){
            let ip = device;
            device = this.getDeviceNameByIp(ip);
            if (!device) {
                log.error(`Cannot find device by IP ${ip}.`);
                return;
            }
        }
            
        this.init(device);
    }

    eventFired(event){
        if (event == 'garageOpenedAtNight')
            this.devices.outside.on(180, event);
    }

    on(name){
        log.debug(`turnOn ${name}`);
        if (name == 'housefan')
            return this.devices.therm.set('fan', 30);
        else {
            if (!this.devices[name])
                throw 'Unknown device ' + name;
            else
                return this.devices[name].on();
        }
    }

    off(name){
        log.debug(`turnOff ${name}`);
        if (name == 'housefan')
            return false;
        else {
            if (!this.devices[name])
                throw 'Unknown device ' + name;
            else
                return this.devices[name].off();
        }
    }

    getState(name){
        if (!name){
            let promises = [];
            for (let dev in this.devices){
                let device = this.devices[dev];
                if (!device) log.error(`No device for ${device}!`);
                promises.push(device.getState());
            }

            return Promise.all(promises).then(states => {
                let result = {};
                for (let dev in this.devices){
                    result[dev] = states.shift();
                }

                return result;
            });
        }
        else {
            let device = this.devices[name];
            if (!device) {
                log.error(`No device for ${name}!`);
                return;
            }
            
            let promise = device.getState().then(dev => this.transform(name, dev));
            return timeout(8000, {name, offline: true})(promise, `get ${name} state`);
        }
    }

    transform(name, dev){
        dev.name = name;
        if (this.aliases[name]){
            dev.alias = this.aliases[name];
        }

        log.debug(`Response for ${name}:`);
        log.debug(dev);
        return dev;
    }

    logAt(level){
        log.setLevel(level);
    }
}
