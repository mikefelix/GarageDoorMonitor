const util = require('util'),
      exec = util.promisify(require('child_process').exec);
      Garage = require('./garage.js'),
      Scheduler = require('./scheduler.js'),
      Bulbs = require('./bulbs.js'),
      Weather = require('./weather.js'),
      Thermostat = require('./thermostat.js'),
      Alarm = require('./alarm.js'),
      Fermenter = require('./fermenter.js'),
      timeout = require('./timeout.js'),
      Q = require('q'),
      log = require('./log.js')('Devices');

module.exports = class Devices {
    constructor(bulbs, alarm, garagedoor, therm, fermenter, weather, readonly){
        this.bulbs = bulbs;
        this.bulbs.fireEvent = this.eventFired.bind(this);
        this.alarm = alarm;
        this.alarm.fireEvent = this.eventFired.bind(this);
        this.garagedoor = garagedoor;
        this.garagedoor.fireEvent = this.eventFired.bind(this);
        this.therm = therm;
        this.therm.fireEvent = this.eventFired.bind(this);
        this.fermenter = fermenter;
        this.fermenter.fireEvent = this.eventFired.bind(this);
        this.weather = weather;
        this.weather.fireEvent = this.eventFired.bind(this);
        this.readonly = readonly;
        this.presence = {};
        //this.readonlyCache = {};
    }

    reset(){
        this.bulbs.reset();
    }

    eventFired(event){
        if (event == 'garageOpenedAtNight')
            this.bulbs.on('outside', 180, event);
    }

    on(name, reason){
        log.debug(`turnOn ${name} because ${reason}`);
        if (name == 'housefan')
            return this.therm.set('fan', 30);
        else if (name == 'alarm')
            return this.alarm.on();
        else
            return this.bulbs.on(name, reason);
    }

    off(name, reason){
        log.debug(`turnOff ${name} because ${reason}`);
        if (name == 'housefan')
            return false;
        else if (name == 'alarm')
            return this.alarm.off();
        else
            return this.bulbs.off(name, reason);
    }

    getDeviceState(name){
        let get;
        if (name == 'readonly')
            get = this.getAllReadonlyState.bind(this);
        else if (this.hasOwnProperty(name))
            get = this[name].getState.bind(this[name]);
        else if (this.readonly.hasOwnProperty(name))
            get = this.getReadonlyDeviceState.bind(this, name);
        else
            get = this.bulbs.getState.bind(this.bulbs, name);

        log.trace(`Getting state for ${name}.`);
        return timeout(8000, {offline: true})(get(), `get ${name} state`);
    }

    async getReadonlyDeviceState(name){ 
        let on = await this.hostIsUp(this.readonly[name]);
        return { ip: this.readonly[name], readonly: true, on };

        //let ret = this.readonlyCache[name];
        //if (!ret) {
            //let on = await this.hostIsUp(this.readonly[name]);
            //ret = { ip: this.readonly[name], readonly: true, on };

            //if (on) {
             //   log.info(`Caching presence of ${name} for 4 minutes.`);
              //  this.readonlyCache[name] = ret;
               // setTimeout(() => delete this.readonlyCache[name], 
                //        1000 * 60 * 60 * 4)
            //}
        //}

        //return ret;
    }

    getAllReadonlyState(){
        let names = Object.keys(this.readonly);
        return Q.all(names.map(name => this.getDeviceState(name))).then(states => {
            let state = {};
            for (let i in names){
                state[names[i]] = states[i];
            }

            return state;
        });
    }

    getState(){
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
    }

    async hostIsUp(host) {
        if (/[a-z]/i.test(host)){
            host = this.addresses[host];
        }

        if (!host) {
            log.error(`No host: ${host}`);
            return false;
        }

        if (this.presence[host] > 0){
            this.presence[host]--;
            return true;
        }

        log.debug(`Ping ${host}`);

        try {
            const { stdout, stderr } = await exec('ping -w 1 ' + host); 

            if (stderr) {
                log.debug("Failed to ping. " + stderr);
            }
            else {
                let [m, num] = stdout.match(/([0-9]+) received/);
                if (num === undefined){
                    log.error("Cannot find packets received in output:");
                    log(stdout);
                }

                if (num > 0){
                    this.presence[host] = 5;
                    return true;
                }
            }
        }
        catch (e) {
            log.debug(`Ping failed to ${host}.`);
        }    

        return false;
    }
}
