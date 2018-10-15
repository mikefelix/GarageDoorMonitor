let {get, put} = require('request'),
    format = require('./format.js'),
    log = require('./log.js')('Hue', 4),
    Q = require('q');

module.exports = class Hue {
    constructor(address, bulbs){
        log(4, `Hue starting at ${address}`);
        this.hueAddress = address;
        this.bulbs = bulbs;
    }

    async getState(){
        let totalState = {};
        let keys = Object.keys(this.bulbs);
        for (let i = 0; i < keys.length; i++){
            let name = keys[i];
            let bulbs = this.bulbs[name];
            for (let j = 0; j < bulbs.length; j++){
                try {
                    let state = await this.getBulbState(bulbs[j]);
                    log(5, `state ${JSON.stringify(state)}`);
                    if (!totalState[name]) totalState[name] = {on: false};
                    totalState[name].on = (totalState[name].on || state.on);
                }
                catch (e){
                    log(1, `Error getting hue state for bulb ${name}: ${e}`);
                }
            }
        }

        return totalState;
    }

    async getBulbState(bulb){
        let bulbs = this._getBulbNumbers(bulb);
        let state = false;

        for (let i = 0; i < bulbs.length; i++){
            try {
                let num = bulbs[i];
                if (!/[0-9+]/.test(num)) {
                    let arr = this._getBulbNumbers(num);
                    if (!arr.length) log(1, 'ERROR: ' + (typeof arr) + ' is not an array');
                    else num = arr[0];
                }

                if (!/[0-9+]/.test(num)) {
                    log(1, 'ERROR: Cannot get bulb number for ' + num);
                }

                let body = await this._req(get, num);
                log(5, 'Body for ' + bulb + ': ' + body);
                if (!body) throw 'Response is empty';
                state |= /"on": ?true/.test(body);
            }
            catch (e){
                log(1, `Error getting bulb state for ${bulb}: ${e}`);
                return false;
            }
        } 

        return {on: !!state};
    }

    async toggle(bulb, timeout) {
        log(`Toggle ${bulb} at ${format(new Date())}`);
        let bulbs = this._getBulbNumbers(bulb);
        let promises = [];
        if (typeof bulbs[0] == 'string'){
            for (let i = 0; i < bulbs.length; i++){
                log(`As part of "toggle" for ${bulb}, toggling ${bulbs[i]}`);
                promises.push(this.toggle(bulbs[i], timeout));
            }
        }
        else {
            for (let i = 0; i < bulbs.length; i++){
                let bulb = bulbs[i];
                let body = await this._req(get, bulb);
                let on = !!body && /"on": ?true/.test(body);
                log(`Bulb ${bulb} was ${on}, so toggling.`);
                promises.push(this._req(put, `${bulb}/state`, JSON.stringify({on: !on}))
                    .then(res => /"success"/.test(res))
                );

                if (timeout)
                    setTimeout(() => this.toggle(bulb), timeout);
            }
        }

        /*let values = await Q.all(promises);
        return values.reduce((a,b) => a || b); */
        await Q.all(promises);
        return true;
    }

    async on(bulb, timeout) {
        log(`Turn on ${bulb} at ${format(new Date())}`);
        let bulbs = this._getBulbNumbers(bulb);
        let promises = [];

        if (typeof bulbs[0] == 'string'){
            for (let i = 0; i < bulbs.length; i++){
                log(`As part of "on" for ${bulb}, turning on ${bulbs[i]}`);
                promises.push(this.on(bulbs[i], timeout));
            }
        }
        else {
            for (let i = 0; i < bulbs.length; i++){
                let bulb = bulbs[i];
                promises.push(this._req(put, `${bulb}/state`, JSON.stringify({on:true}))
                    .then(res => /"success"/.test(res))
                ); 

                if (timeout)
                    setTimeout(() => this.toggle(bulb), timeout);
            }
        }

        /*let values = await Q.all(promises);
        return values.reduce((a,b) => a || b);*/
        return true;
    }

    async off(bulb) {
        log(`Turn off ${bulb} at ${format(new Date())}`);
        let bulbs = this._getBulbNumbers(bulb);
        let promises = [];

        if (typeof bulbs[0] == 'string'){
            for (let i = 0; i < bulbs.length; i++){
                log(`As part of "off" for ${bulb}, turning off ${bulbs[i]}`);
                promises.push(this.off(bulbs[i]));
            }

        }
        else {
            for (let i = 0; i < bulbs.length; i++){
                let bulb = bulbs[i];
                promises.push(this._req(put, `${bulb}/state`, JSON.stringify({on:false}))
                    .then(res => /"success"/.test(res))
                );
            }
        }

        /*let values = await Q.all(promises);
        return values.reduce((a,b) => a || b);*/
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

    _req(method, endpoint, body, retrying) {
        return new Promise((resolve, reject) => {
            let url = `${this.hueAddress}/${endpoint}`;
            let o = { headers: {'content-type' : 'application/json'}, url };
            
            if (body)
                o.body = body;

            //sole.log((method == get ? 'GET' : 'PUT'), endpoint, (body ? 'with body: ' + body : ""));
            method(o, (err, res, body) => {
                if (err){
                    if (retrying){
                        reject(err);
                    }
                    else {
                        log(2, 'Retrying', url);
                        this._req(method, url, body, true)
                          .then(res2 => resolve(res2))
                          .catch(err2 => reject(err2));
                    }
                }
                else {
                    resolve(body);
                }
            });
        });
    }    

}

