let axios = require('axios'),
    format = require('./format.js'),
    log = require('./log.js')('Fermenter'),
    qs = require('querystring'),
    timeout = require('./timeout.js');

module.exports = class Fermenter {
    constructor(url){
        this.url = url;
    }

    off(){
        return this.close();
    }

    async _post(type, data){
        let payload = `messageType=${type}&message=${data || ''}`;
        log.info(payload);
        let res = await axios.post(this.url, payload);
        return res.data;
    }

    async getState(){
        try {
            let data = await this._post('lcd');
            return {
                mode: data[0].substring(7).replace('Const.', 'constant'),
                beerTemp: data[1].substring(7, 11), 
                beerSetting: data[1].substring(13, 17),
                fridgeTemp: data[2].substring(7, 11), 
                fridgeSetting: data[2].substring(13, 17),
                state: data[3].replace(/\s+/g, ' ').replace(/([0-9+])h([0-9]+)m[0-9]+/, '$1:$2')
            };
        }
        catch (e){
            log.error('Could not communicate with fermenter: ' + e);
            return {};
        }
    }

    async off(){
        try {
            let res = await this._post('setOff');
            return true;
        }
        catch (e){
            log.error('Could not turn off fermenter.' + e);
            return false;
        }
    }

    async heater(enable){
        try {
            if (!enable) { // disable heater
                log.info('Disabling heater.');
                let res = await this._post('applyDevice', '%7B%22i%22%3A%222%22%2C%22c%22%3A%220%22%2C%22b%22%3A%220%22%2C%22f%22%3A%222%22%2C%22h%22%3A%221%22%2C%22p%22%3A%222%22%2C%22x%22%3A%220%22%7D');
                log.info('Disable heater result: ' + JSON.stringify(res.data));
            }
            else { // enable heater
                log.info('Enabling heater.');
                let res = await this._post('applyDevice', '%7B%22i%22%3A%222%22%2C%22c%22%3A%221%22%2C%22b%22%3A%220%22%2C%22f%22%3A%222%22%2C%22h%22%3A%221%22%2C%22p%22%3A%222%22%2C%22x%22%3A%220%22%7D');
                log.info('Enable heater result: ' + JSON.stringify(res));
            }
            
            return true;
        }
        catch (e){
            log.error(`Could not set heater to ${enable}: ${e}`);
            return false;
        }
    }

    async set(beer, temp, drift){
        try {
            if (temp < 32 || temp > 85)
                throw 'Temp out of range: ' + temp;

            if (drift) { // disable heater
                let res = await this._post('applyDevice', '%7B%22i%22%3A%222%22%2C%22c%22%3A%220%22%2C%22b%22%3A%220%22%2C%22f%22%3A%222%22%2C%22h%22%3A%221%22%2C%22p%22%3A%222%22%2C%22x%22%3A%220%22%7D');
                log.info('Disable heater: ' + JSON.stringify(res.data));
            }
            else { // enable heater
                let res = await this._post('applyDevice', '%7B%22i%22%3A%222%22%2C%22c%22%3A%221%22%2C%22b%22%3A%220%22%2C%22f%22%3A%222%22%2C%22h%22%3A%221%22%2C%22p%22%3A%222%22%2C%22x%22%3A%220%22%7D');
                log.info('Enable heater: ' + JSON.stringify(res));
            }
            
            temp = parseFloat("" + temp);
            log.info('Set beer to ' + temp);
            let res = await this._post(beer == 'beer' ? 'setBeer' : 'setFridge', temp);
            return true;
        }
        catch (e){
            log.error(`Could not set ${beer ? 'beer' : 'fridge'} to ${temp} with drift ${drift}: ${e}`);
            return false;
        }
    }

    /*
     * Set beer temp: 
     * messageType=setBeer&message=63.9
     *
     * Enable heater:
     * messageType=applyDevice&message=%7B%22i%22%3A%222%22%2C%22c%22%3A%221%22%2C%22b%22%3A%220%22%2C%22f%22%3A%222%22%2C%22h%22%3A%221%22%2C%22p%22%3A%222%22%2C%22x%22%3A%220%22%7D
     *
     * Disable heater:
     * messageType=applyDevice&message=%7B%22i%22%3A%222%22%2C%22c%22%3A%220%22%2C%22b%22%3A%220%22%2C%22f%22%3A%222%22%2C%22h%22%3A%221%22%2C%22p%22%3A%222%22%2C%22x%22%3A%220%22%7D
     * */
}
