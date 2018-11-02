let FormData = require('form-data'),
    log = require('./log.js')('Etek-client');

module.exports = class EtekCityClient {
    constructor(username, password, baseUrl) {
        const HyperRequest = require('hyper-request');
        this.client = new HyperRequest({
            baseUrl: baseUrl,
            disablePipe: true,
            respondWithProperty: false,
            parserFunction: function (data) {
                return JSON.parse(data.replace(/\\/g, '').replace('"[', '[').replace(']"', ']'));
            }
        });

        this.username = username;
        this.password = password;
        //this.logIn();
    }

    static get HISTORIC_STAT_TYPES() {
        return {
            DAY: 'day',
            MONTH: 'month',
            YEAR: 'year',
            EXT_DAY: 'extDay'
        }
    };

    async logIn() {
        let formData = new FormData();
        formData.append('Account', this.username);
        formData.append('Password', this.password);
        formData.append('AppVersion', '1.70.2');
        formData.append('AppVersionCode', '111');
        formData.append('OS', 'Android');
        formData.append('DevToken', 'AkuEZmg_eu5m14eQRDxqYBsUzR-I7ZjaQtmKvU5Mw5a2');
        log.debug('POST /login');
        try {
            let response = await this.client.post('/login', {
                headers: Object.assign({
                    password: this.password,
                    account: this.username,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }, formData.getHeaders())
            });
            
            this.token = response.tk;
            this.uniqueId = response.id;
            log.debug(`Logged into vesync with ${this.uniqueId}/${this.token}`);
            return true;
        }
        catch (err){
            log.error(1, 'Login error: ' + err);
            return false;
        }
    }

    _transformResponse(device){
        return {
            id: device.id,
            name: device.deviceName,
            status: device.relay,
            on: device.relay == 'open'
        };
    }

    async getDevices(){
        try {
            if (!this.token){
                log.debug('Logging in...');
                if (!await this.logIn()){ 
                    log.error('Login failed.');
                    return {};
                }
            }

            let response = await this.client.post('/loadMain', {
                headers: {
                    tk: this.token,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            response.devices.map(device => log.debug(`device ${device.deviceName} is ${device.id}`));
            return response.devices
                .map(device => this._transformResponse(device));
        }
        catch (err){
            log.error('getDevices error: ' + err);
            return {};
        }
    }

    async getDevice(name){
        try {
            if (!this.token){
                log.debug('Logging in...');
                if (!await this.logIn()){ 
                    log.error('Login failed.');
                    return undefined;
                }
            }

            let response = await this.client.post('/loadMain', {
                headers: {
                    tk: this.token,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            response.devices.map(device => log.debug(`device ${name} is ${device.id}`));
            return response.devices
                .filter(device => device.deviceName == name)
                .map(device => this._transformResponse(device))[0];
        }
        catch (err){
            log.error('getDevice error: ' + err);
            return undefined;
        }
    }

    async turnOn(deviceId) {
        if (!this.token) throw 'Not logged in.';
        let formData = new FormData();
        formData.append('cid', deviceId);
        formData.append('uri', '/relay');
        formData.append('action', 'open');

        try {
            log.debug(`curl -X POST https://server1.vesync.com:4007/devRequest -H "tk: ${this.token}" -H "id: ${this.uniqueId}" -H "uniqueId: ${this.uniqueId}" --data "cid=${deviceId}&uri=/relay&action=open"`);
            let response = await this.client.post('/devRequest', {
                headers: Object.assign({
                    tk: this.token,
                    id: this.uniqueId,
                    uniqueId: this.uniqueId,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }, formData.getHeaders()),
                body : {
                    cid : deviceId,
                    uri : '/relay',
                    action : 'open'
                }
            });
            
            log.debug('POST complete.');

            return this._transformResponse(response);
        }
        catch (err){
            log.error('turnOn error: ' + err);
        }
    }

    async turnOff(deviceId) {
        if (!this.token) throw 'Not logged in.';
        let formData = new FormData();
        formData.append('cid', deviceId);
        formData.append('uri', '/relay');
        formData.append('action', 'break');

        try {
            log.debug(`curl -X POST https://server1.vesync.com:4007/devRequest -H "tk: ${this.token}" -H "id: ${this.uniqueId}" -H "uniqueId: ${this.uniqueId}" --data "cid=${deviceId}&uri=/relay&action=break"`);
            let response = await this.client.post('/devRequest', {
                headers: Object.assign({
                    tk: this.token,
                    id: this.uniqueId,
                    uniqueId: this.uniqueId,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }, formData.getHeaders()),
                body : {
                    cid : deviceId,
                    uri : '/relay',
                    action : 'break'
                }
            });

            log.debug('POST complete.');

            return this._transformResponse(response);
        }
        catch (err){
            log.error('turnOff error: ' + err);
        }
    }

    getMeter(deviceId) {
        let formData = new FormData();
        formData.append('cid', deviceId);
        formData.append('uri', '/getRuntime');

        return this.client.post('/devRequest', {
            headers: Object.assign({
                tk: this.token,
                id: this.uniqueId,
                uniqueId: this.uniqueId,
                cid : deviceId,
                'Content-Type': 'application/x-www-form-urlencoded',
            }, formData.getHeaders()),
            body : {
                cid : deviceId,
                uri : '/getRuntime'
            }
        }).then(response => {
            if (response.power && response.power !== 'NaN'){
                response.power = this.parseNumeric(response.power).current;
            }
            if (response.voltage && response.power !== 'NaN'){
                response.voltage = this.parseNumeric(response.voltage).current;
            }
            if (response.current && response.power !== 'NaN'){
                response.current = this.parseNumeric(response.current).current;
            }
            return response;
        });
    }

    _round(value) {
        return Math.round(value / 3600 * 1000) / 1000;
    }

    getStats(deviceId,
             reqDate = new Date().toISOString().slice(0,10).replace(/-/g,''),
             timeZoneOffset = new Date().getTimezoneOffset() / -60,
             round = true,
             type = EtekCityClient.HISTORIC_STAT_TYPES.EXT_DAY) {

        let formData = new FormData();
        formData.append('cid', deviceId);
        formData.append('date', reqDate);
        formData.append('Type', type);
        formData.append('zoneOffset', timeZoneOffset);

        return this.client.post('/loadStat', {
            headers: Object.assign({
                tk: this.token,
                id: this.uniqueId,
                uniqueId: this.uniqueId,
                cid : deviceId,
                'Content-Type': 'application/x-www-form-urlencoded',
            }, formData.getHeaders()),
            body : {
                cid : deviceId,
                date : reqDate,
                Type: type,
                zoneOffset: timeZoneOffset
            }
        }).then(response => {
            if (type === EtekCityClient.HISTORIC_STAT_TYPES.EXT_DAY) {
                return {
                    //API has it spelt cuurentDay...dont ask
                    currentDay: round ? this._round(response.cuurentDay) : response.cuurentDay,
                    sevenDay: round ? this._round(response.sevenDay) : response.sevenDay,
                    thirtyDay: round ? this._round(response.thirtyDay) : response.thirtyDay
                };
            }
            else if (Array.isArray(response)){
                return response.map(e => { return { value : e }; });//future put timestamp in
            }
            return response;
        });
    }

    // This is pulled directly(ported to javascript) from the Mobile apps Java source code
    parseNumeric(input) {
        let split = input.split(':');
        let v_stat = parseInt(split[0], 16);
        let v_imm = parseInt(split[1], 16);

        let current = (v_stat >> 12) + ( (4095 & v_stat) / 1000.0 );
        let instant = (v_imm >> 12) + ( (4095 & v_imm) / 1000.0 );
        return { current, instant };
    }

};
