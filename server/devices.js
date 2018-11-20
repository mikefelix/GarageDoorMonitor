const Garage = require('./garage.js'),
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
    constructor(bulbs, alarm, garagedoor, therm, fermenter, weather){
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
        if (this.hasOwnProperty(name))
            get = this[name].getState.bind(this[name]);
        else
            get = this.bulbs.getState.bind(this.bulbs, name);

        return timeout(7000, {})(get(), `get ${name} state`);
    }

    getState(){
        let promises = ['therm', 'garagedoor', 'bulbs', 'weather', 'alarm']
            .map(name => this.getDeviceState(name));
        return Q.all(promises).then(states => {
            let [thermState, garageState, bulbState, weatherState, alarmState] = states;
            let state = {
                away: thermState && thermState.away,
                garagedoor: garageState,
                alarm: alarmState,
                bulbs: bulbState,
                hvac: {
                    humidity: thermState.humidity,
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
        });
    }
}
