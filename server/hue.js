let {get, put} = require('request'),
    format = require('./format.js'),
    Q = require('q');

module.exports = class Hue {
    constructor(address, bulbs){
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
                    totalState[name] = !!(totalState[name] || state);
                }
                catch (e){
                    console.log(`Error getting hue state for bulb ${name}: ${e}`);
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
                let body = await this._req(get, bulbs[i]);        
                if (!body) throw 'Response is empty';
                state |= /"on": ?true/.test(body);
            }
            catch (e){
                console.log(`Error getting bulb state for ${bulb}: ${e}`);
                return false;
            }
        }

        return !!state;
    }

    async toggle(bulb, timeout) {
        console.log(`Toggle ${bulb} at ${format(new Date())}`);
        let bulbs = this._getBulbNumbers(bulb);
        let promises = [];
        if (typeof bulbs[0] == 'string'){
            for (let i = 0; i < bulbs.length; i++){
                console.log(`As part of "toggle" for ${bulb}, toggling ${bulbs[i]}`);
                promises.push(this.toggle(bulbs[i], timeout));
            }
        }
        else {
            for (let i = 0; i < bulbs.length; i++){
                let bulb = bulbs[i];
                let body = await this._req(get, bulb);
                let on = !!body && /"on": ?true/.test(body);
                console.log(`Bulb ${bulb} was ${on}, so toggling.`);
                promises.push(this._req(put, `${bulb}/state`, JSON.stringify({on: !on}))
                    .then(res => /"success"/.test(res))
                );

                if (timeout)
                    setTimeout(() => this.toggle(bulb), timeout);
            }
        }

        let values = await Q.all(promises);
        return values.reduce((a,b) => a || b); 
    }

    async on(bulb, timeout) {
        console.log(`Turn on ${bulb} at ${format(new Date())}`);
        let bulbs = this._getBulbNumbers(bulb);
        let promises = [];

        if (typeof bulbs[0] == 'string'){
            for (let i = 0; i < bulbs.length; i++){
                //console.log(`As part of "on" for ${bulb}, turning on ${bulbs[i]}`);
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

        let values = await Q.all(promises);
        return values.reduce((a,b) => a || b);
    }

    async off(bulb) {
        console.log(`Turn off ${bulb} at ${format(new Date())}`);
        let bulbs = this._getBulbNumbers(bulb);
        let promises = [];

        if (typeof bulbs[0] == 'string'){
            for (let i = 0; i < bulbs.length; i++){
                //console.log(`As part of "off" for ${bulb}, turning off ${bulbs[i]}`);
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

        let values = await Q.all(promises);
        return values.reduce((a,b) => a || b);
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
            let o = {
                headers: {'content-type' : 'application/json'},
                url: `${this.hueAddress}/${endpoint}`
            }
            
            if (body)
                o.body = body;

            //console.log('Requesting', url, 'with body', body);
            method(o, (err, res, body) => {
                if (err){
                    if (retrying){
                        reject(err);
                    }
                    else {
                        console.log('Retrying', url);
                        req(method, url, body, true)
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

