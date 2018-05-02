let axios = require("axios"),
    log = require("./log.js")("Therm");
        
module.exports = class Thermostat {
    constructor(thermId, structureId, nestToken){
        this.thermId = thermId;
        this.structureId = structureId;
        this.nestToken = nestToken;
    }

    async getState(){
        let therm = this._trimThermResponse(await this._callThermostat());
        let struc = this._trimThermResponse(await this._callThermostat('away'));
        return Object.assign(struc, therm);
    }

    async set(prop, value){
        return await this._callThermostat(prop, value);
    }

    _trimThermResponse(res){
        if (!res || !res.data) return undefined;
        let data = res.data;
        if (data.away)
            return { away: data.away == 'away' };

        let fanTimeout = data.fan_timer_timeout;
        let fanOffTime = (!fanTimeout || fanTimeout == '1970-01-01T00:00:00.000Z') ? undefined : format(fanTimeout);
        let state = data.hvac_state;
        if (state == 'off' && fanOffTime)
            state = 'fan';

        return {
            temp: data.ambient_temperature_f,
            humidity: data.humidity,
            state,
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
            if (prop == 'fan' && !value){
                data = {
                    fan_timer_active: false
                };
            }
            else if (prop == 'away'){
                if (value !== undefined)
                    data = { away: (value ? 'home' : 'away') };
            }

            let method = data ? 'PUT' : 'GET';

            //log(`${method} to ${url}`);
            let req = await axios({ method, url, data, headers: {
                    'Authorization': auth,
                    'Content-type': 'application/json'
                }
            });
            
            return req;
        }
        catch (err){
            log('Error: ' + err);
        }
    }
}
