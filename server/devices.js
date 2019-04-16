const util = require('util'),
      Hue = require('./hue.js'),
      Wemo = require('./wemo.js'),
      Etek = require('./etek.js'),
      Tuya = require('./tuya.js'),
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

        let init = (underlying, conf, device) => {
            let name = typeof device == 'string' ? device : device.name;
            this.devices[name] = new underlying(conf, device);
            this.devices[name].type = 'device';
            this.history[name] = {};
        }

        if (config.etek){
            for (let device of (config.etek.devices || [])){ init(Etek, config.etek, device); }
        }

        if (config.hue){
            for (let device of (config.hue.devices || [])){ init(Hue, config.hue, device); }
        }

        if (config.wemo){
            for (let device of (config.wemo.devices || [])){ init(Wemo, config.wemo, device); }
        }

        if (config.tuya){
            for (let device of (config.tuya.devices || [])){ init(Tuya, config.tuya, device); }
        }

        if (config.alarm){
            this.alarm = this.devices.alarm = new Alarm(config.alarm);
            this.devices.alarm.fireEvent = this.eventFired.bind(this);
        }

        /*if (config.garage){
            this.garagedoor = this.devices.garagedoor = new Garage(config.garage);
            this.devices.garagedoor.fireEvent = this.eventFired.bind(this);
        }*/

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
                        return {
                            humidity: thermState.humidity,
                            away: thermState.away,
                            temp: thermState.temp,
                            target: thermState.target,
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

        if (config.weather){
            this.weather = this.devices.weather = new Weather(config.weather);
            this.devices.weather.fireEvent = this.eventFired.bind(this);
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

    reset(){
        //this.bulbs.reset();
    }

    eventFired(event){
        if (event == 'garageOpenedAtNight')
            this.devices.outside.on(180, event);
    }

    on(name, reason){
        log.debug(`turnOn ${name} because ${reason}`);
        if (name == 'housefan')
            return this.devices.therm.set('fan', 30);
        else {
            if (!this.devices[name])
                throw 'Unknown device ' + name;
            else
                return this.devices[name].on();
        }
    }

    off(name, reason){
        log.debug(`turnOff ${name} because ${reason}`);
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
            return timeout(8000, {offline: true})(promise, `get ${name} state`);
        }
    }

    transform(name, dev){
        if (this.aliases[name]){
            dev.alias = this.aliases[name];
        }

        log.debug(`Response for ${name}:`);
        log.debug(dev);
        return dev;
    }

    /*getState(){
        let promises = ['therm', 'garagedoor', 'bulbs', 'weather', 'alarm', 'readonly']
            .map(name => this.getDeviceState(name));

        return Q.all(promises).then(states => {
            let [thermState, garageState, bulbState, weatherState, alarmState, readonlyState] = states;
            let state = {
                away: thermState && thermState.away,
                garagedoor: garageState,
                alarm: alarmState,
                bulbs: bulbState, //deprecated
                devices: bulbState,
                hvac: {
                    humidity: thermState.humidity,
                    away: thermState.away,
                    temp: thermState.temp,
                    target: thermState.target,
                    state: thermState.state,
                    mode: thermState.mode,
                    on: thermState.state == 'heating' || thermState.state == 'cooling'
                },
                housefan: {
                    on: thermState.on,
                    offTime: thermState.fanOffTime
                },
                weather: {
                    temp: weatherState ? weatherState.temp : undefined
                },
                times: Times.get(true)
            };

            for (let dev in readonlyState){
                log.debug(`Adding readonly ${dev}.`);
                state.devices[dev] = readonlyState[dev];
            }

            let temp = state.hvac.temp, target = state.hvac.target;
            if (this.therm.useExtraFan){
                if (state.hvac.mode == 'cool'){
                    state.hvac.nearTarget = (!weatherState || weatherState.temp >= 76) &&
                        temp >= target && 
                        temp - target <= 2;
                }
                else if (state.hvac.mode == 'heat'){
                    state.hvac.nearTarget = (!weatherState || weatherState.temp <= 50) &&
                        temp <= target && 
                        target - temp <= 2;
                }
                else {
                    state.hvac.nearTarget = false;
                }
            }

            state.history = state.bulbs.history;
            delete state.bulbs.history;
            return state;
        }).catch(e => {
            log.error(`Caught an exception in devices.getState: ${e}`);
        });
    }*/
}
