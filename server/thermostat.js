let axios = require("axios"),
    format = require('./format.js'),
    Q = require('q'),
    log = require("./log.js")("Therm");
        
module.exports = class Thermostat {
    constructor(thermId, structureId, nestToken, useExtraFan){
        //log(`Therm starting with ${thermId}/${structureId}/${nestToken}`);
        this.thermId = thermId;
        this.structureId = structureId;
        this.nestToken = nestToken;
        this.refreshAwayEvery = 5;
        this.refreshAwayCounter = 0;
        this.away = false;
        this.canCall = true;
        this.backoff = 1;
        this.useExtraFan = useExtraFan;
    }

    refreshState(){
        let getAway;
        if (this.refreshAwayCounter == 0){
            getAway = this._callThermostat('away')
                .then(res => {
                    if (!res || !res.data){
                        log.error('No data found in away response.');
                        this.away = false;
                    } 
                    else {
                        let away = res.data.away != 'home';
                        if (away != this.away) 
                            log.info(`Set away to ${away} (${res.data.away}).`);

                        this.away = away;
                    }
                })
                .catch(err => log.error(`Error getting away state: ${err}`));
        }
        
        this.refreshAwayCounter = (this.refreshAwayCounter + 1) % this.refreshAwayEvery;

        let getTherm = this._callThermostat()
            .then(res => this.state = this._trimThermResponse(res))
            .catch(err => log.error(`Error getting therm state: ${err}`));

        return getAway ?
            Q.all([getAway, getTherm]) :
            getTherm;
    }

    async getState(){
        if (this.canCall){
            //log('getState() is calling.');
            await this.refreshState();
            this.canCall = false;
            setTimeout(() => this.canCall = true, this.backoff * 57000);
        }
        //else log('getState()');

        return this.state;
    }

    async set(prop, value){
        log.info(`Set ${prop} to ${value}.`);
        return await this._callThermostat(prop, value);
    }

    async moveTemp1(){
        let state = await this.getState();
        if (state.target_temperature_f){
            if (state.mode == 'cool'){
                await this.set('target_temperature_f', state.target_temperature_f - 1);
            }
            else if (state.mode == 'heat'){
                await this.set('target_temperature_f', state.target_temperature_f + 1);
            }
        }
    }

    _trimThermResponse(res){
        if (!res || !res.data) return {};
        let data = res.data;
        if (!data)
            throw 'No data found in response.';

        let fanTimeout = data.fan_timer_timeout;
        let fanOffTime = (!fanTimeout || fanTimeout == '1970-01-01T00:00:00.000Z') ? undefined : format(fanTimeout);
        let state = data.hvac_state;
        if (state == 'off' && fanOffTime)
            state = 'fan';

        return {
            away: this.away,
            temp: data.ambient_temperature_f,
            target: data.target_temperature_f,
            humidity: data.humidity,
            state,
            on: state != 'off',
            mode: data.hvac_mode,
            fanOffTime
        };
    }

    async _callThermostat(prop, value){
        try {
            let url = prop == 'away' ? 
                `https://developer-api.nest.com/structures/${this.structureId}` :
                `https://developer-api.nest.com/devices/thermostats/${this.thermId}`;

            let auth = 'Bearer ' + this.nestToken;

            let data;
            if (prop == 'fan' && value){
                data = {
                    fan_timer_active: true,
                    fan_timer_duration: value
                };
            }
            else if (prop == 'fan' && !value){
                data = {
                    fan_timer_active: false
                };
            }
            else if (prop == 'away'){
                if (value !== undefined)
                    data = { away: (value ? 'home' : 'away') };
            }

            let method = data ? 'PUT' : 'GET';

            log.debug(`${method} to ${url} with data: ${JSON.stringify(data)} and auth: ${auth}`);
            let res = await axios({ method, url, data, headers: {
                    'Authorization': auth,
                    'Content-type': 'application/json'
                }
            });
            
            if (prop == 'fan' && value && this.state.state == 'off')
                this.state.state = 'fan';
                
            return res;
        }
        catch (err){
            log.error(`Error while calling Nest (${prop ? prop : 'therm'}): ${err}`);
            if (/429/.test(err)){
                this.backoff = this.backoff + 1;
                log.info(`429 from Nest. Increasing backoff to ${this.backoff}.`);
            }

            return undefined;
        }
    }
}
