let axios = require('axios').create(),
    format = require('./format.js'),
    log = require('./log.js')('Fermenter'),
    qs = require('querystring'),
    timeout = require('./timeout.js');

axios.interceptors.request.use(request => {
            return request
})

axios.interceptors.response.use(response => {
            return response
})

module.exports = class Fermenter {
    constructor(url){
        this.url = url;
    }

    off(){
        return this.close();
    }

    async _post(type, data){
        let payload = `messageType=${type}&message=${data || ''}`;
        log.debug(this.url + " -- " + payload);
        let res = await axios.post(this.url, payload);
        log.debug(type + " complete.");
        return res.data;
    }

    wait(time){
        return new Promise(function(resolve, reject){
            setTimeout(resolve, time);
        })
    }

    async getState(){
        try {
            let data = await this._post('lcd');
            log.debug('Getting devices.');
            let devices = await this._post('getDeviceList');
            if (typeof devices != 'object'){
                log.debug('Refreshing devices.');
                await this._post('refreshDeviceList');
                await this.wait(1000);
                devices = await this._post('getDeviceList');
            }

            if (typeof devices != 'object'){
                throw 'Cannot get device list. ' + devices;
            }

            let heater = devices != null &&
                devices.deviceList != null &&
                devices.deviceList.installed != null &&
                devices.deviceList.installed.length == 4;

            return {
                mode: data[0].substring(7).replace('Const.', 'constant').replace(/ +$/, ''),
                beerTemp: data[1].substring(7, 11), 
                beerSetting: data[1].substring(13, 17),
                fridgeTemp: data[2].substring(7, 11), 
                fridgeSetting: data[2].substring(13, 17),
                heater,
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
            await this.wait(500);
            return await this.getState();
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
                //let res = await this._post('applyDevice', '%7B%22i%22%3A%222%22%2C%22c%22%3A%220%22%2C%22b%22%3A%220%22%2C%22f%22%3A%222%22%2C%22h%22%3A%221%22%2C%22p%22%3A%222%22%2C%22x%22%3A%220%22%7D');
                let res = await this._post('applyDevice', '{"i":"2","c":"1","b":"0","f":"0","h":"1","p":"2","x":"0"}');
                log.info('Disable heater result: ' + JSON.stringify(res.data));
            }
            else { // enable heater
                log.info('Enabling heater.');
                //let res = await this._post('applyDevice', '%7B%22i%22%3A%222%22%2C%22c%22%3A%221%22%2C%22b%22%3A%220%22%2C%22f%22%3A%222%22%2C%22h%22%3A%221%22%2C%22p%22%3A%222%22%2C%22x%22%3A%220%22%7D');
                let res = await this._post('applyDevice', '{"i":"2","c":"1","b":"1","f":"2","h":"1","p":"2","x":"0"}');
                log.info('Enable heater result: ' + JSON.stringify(res));
            }
            
            await this.wait(500);
            return await this.getState();
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
            await this._post(beer == 'beer' ? 'setBeer' : 'setFridge', temp);

            await this.wait(500);
            return await this.getState();
        }
        catch (e){
            log.error(`Could not set ${beer ? 'beer' : 'fridge'} to ${temp} with drift ${drift}: ${e}`);
            return false;
        }
    }

    logAt(level){
        log.setLevel(level);
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
