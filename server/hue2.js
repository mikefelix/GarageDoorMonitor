let format = require('./format.js'),
    log = require('./log.js')('Hue'),
    Q = require('q'),
    HyperRequest = require('hyper-request');

module.exports = class Hue {
    constructor(address, bulbs){
        this.hueAddress = address;
        this.bulbs = bulbs;
        this.client = new HyperRequest({
            baseUrl: hueAddress,
            disablePipe: true,
            respondWithProperty: false
        });
    }

    async getState(){
        let totalState = {};
        for (let name of Object.keys(this.bulbs)){
            for (let bulb of this.bulbs[name]){
                try {
                    let state = await this.getBulbState(bulb);
                    totalState[name] = !!(totalState[name] || state);
                }
                catch (e){
                    log(`Error getting hue state for bulb ${name}: ${e}`);
                }
            }
        }

        return totalState;
    }

    async getBulbState(bulb){
        let bulbs = this._getBulbNumbers(bulb);
        let state = false;

        for (let num of bulbs){
            try {
                if (!/[0-9+]/.test(num)) {
                    let arr = this._getBulbNumbers(num);
                    if (!arr.length) log('ERROR: ' + (typeof arr) + ' is not an array');
                    else num = arr[0];
                }

                if (!/[0-9+]/.test(num)) {
                    log('ERROR: Cannot get bulb number for ' + num);
                }

                let body = await this.client.get(`/${num}`, {
                    headers: {'content-type' : 'application/json'}
                });

                if (!body) throw 'Response is empty';
                state |= /"on": ?true/.test(body);
            }
            catch (e){
                log(`Error getting bulb state for ${bulb}: ${e}`);
                return false;
            }
        }

        return !!state;
    }

    async toggle(bulb) {
        log(`Toggle ${bulb}.`);
        let bulbs = this._getBulbNumbers(bulb);
        let promises = [];
        if (typeof bulbs[0] == 'string'){
            for (let subBulb of bulbs){
                log(`As part of "toggle" for ${bulb}, toggling ${subBulb}`);
                promises.push(this.toggle(subBulb));
            }
        }
        else {
            for (let bulb of bulbs){
                let body = await this.client.get(`/${bulb}`, {
                    headers: {'content-type' : 'application/json'}
                });

                let on = !!body && /"on": ?true/.test(body);

                log(`Bulb ${bulb} was ${on}, so toggling.`);
                promises.push(this.client.put(`/${bulb}/state`, {
                    headers: {'content-type' : 'application/json'},
                    json: {on: !on}
                }));
            }
        }

        await Q.all(promises);
        return true;
    }

    async on(bulb) {
        log(`Turn on ${bulb}.`);
        let bulbs = this._getBulbNumbers(bulb);
        let promises = [];

        if (typeof bulbs[0] == 'string'){
            for (let subBulb of bulbs){
                log(`As part of "on" for ${bulb}, turning on ${subBulb}`);
                promises.push(this.on(subBulb));
            }
        }
        else {
            for (let bulb of bulbs){
                promises.push(this.client.put(`/${bulb}/state`, {
                    headers: {'content-type' : 'application/json'},
                    json: {on: true}
                }));
            }
        }

        await Q.all(promises);
        return true;
    }

    async off(bulb) {
        log(`Turn off ${bulb}.`);
        let bulbs = this._getBulbNumbers(bulb);
        let promises = [];

        if (typeof bulbs[0] == 'string'){
            for (let subBulb of bulbs){
                log(`As part of "off" for ${bulb}, turning off ${subBulb}`);
                promises.push(this.off(subBulb));
            }

        }
        else {
            for (let bulb of bulbs){
                promises.push(this.client.put(`/${bulb}/state`, {
                    headers: {'content-type' : 'application/json'},
                    json: {on: false}
                }));
            }
        }

        await Q.all(promises);
        return true;
    }

    _getBulbNumbers(bulb){
        if (typeof bulb == 'string')
            return this.bulbs[bulb];
        else if (typeof bulb == 'number')
            return [bulb];
        else
            return bulb;
    }

}

