let {get, post} = require('request');

function req(method, url, body, retrying) {
    return new Promise((resolve, reject) => {
        let o = {
            headers: {'content-type' : 'application/json'},
            url: url
        }
        
        if (body)
            o.body = body;

        method(o, (err, res, body) => {
            console.log('Requesting', url);
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

module.exports = class Hue {
    constructor(address, bulbs){
        this.hueAddress = address;
        this.bulbs = bulbs;
    }

    _getBulbNumbers(bulb){
        if (typeof bulb == 'string')
            return this.bulbs[bulb];
        else if (typeof bulb == 'number')
            return [bulb];
        else
            return bulb;
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
                    console.log(name, state);
                }
                catch (e){
                    console.log(`Error getting hue state for bulb ${name}: ${e}`);
                }
            }
        }

        console.log('hue state in hue is'); console.dir(totalState);
        return totalState;
    }

    async getBulbState(bulb){
        let bulbs = this._getBulbNumbers(bulb);
        let state = false;

        for (let i = 0; i < bulbs.length; i++){
            try {
                let body = await req(get, `${this.hueAddress}/${bulbs[i]}`);        
                state |= body && /"on": ?true/.test(body); 
            }
            catch (e){
                console.log(`Error getting bulb state for ${bulb}: ${e}`);
                return false;
            }
        }

        return state;
    }

    async toggle(bulb, timeout) {
        console.log(`Toggle ${bulb} at ${new Date()}`);
        let bulbs = this._getBulbNumbers(bulb);

        let ret = false;
        for (let i = 0; i < bulbs.length; i++){
            let bulb = bulbs[i];
            let body = await req(get, `${this.hueAddress}/${bulb}`);
            let on = body && /"on": ?true/.test(body);
            req(post, `${this.hueAddress}/${bulb}/state`, JSON.stringify({on}));
            ret |= on;
            if (timeout)
                setTimeout(() => this.toggle(bulb), timeout);
        }

        return ret;
    }

    async on(bulb, timeout) {
        console.log(`Turn on ${bulb} at ${new Date()}`);
        let bulbs = this._getBulbNumbers(bulb);

        for (let i = 0; i < bulbs.length; i++){
            let bulb = bulbs[i];
            req(post, `${this.hueAddress}/${bulb}/state`, JSON.stringify({on:true}));
            if (timeout)
                setTimeout(() => this.toggle(bulb), timeout);
        }
    }

    async off(bulb) {
        console.log(`Turn off ${bulb} at ${new Date()}`);
        let bulbs = this._getBulbNumbers(bulb);

        for (let i = 0; i < bulbs.length; i++){
            let bulb = bulbs[i];
            req(post, `${this.hueAddress}/${bulb}/state`, JSON.stringify({on:false}));
        }
    }

}

