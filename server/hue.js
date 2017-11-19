let {get, post} = require('request');

function req(method, url, body, retrying) {
    return new Promise((resolve, reject) => {
        let o = {
            headers: {'content-type' : 'application/json'},
            url: url
        }
        
        if (body)
            o.body = body;

//        console.log(`${retrying ? 'Retry' : 'Try'} request to ${url}.`);
        method(o, (err, res, body) => {
            if (err){
                if (retrying){
 //                   console.log(`Rejecting retried promise in hue request to ${url}: ${err}`);
                    reject(err);
                }
                else {
  //                  console.log(`Retrying request to ${url} because ${err}`);
                    req(method, url, body, true)
                      .then(res2 => resolve(res2))
                      .catch(err2 => reject(err2));
                }
            }
            else {
   //             console.log(`Resolving promise in hue request to ${url}`);
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

    async getState(){
        let totalState = {};
        let keys = Object.keys(this.bulbs);
        for (let i = 0; i < keys.length; i++){
            let name = keys[i];
            let bulbs = this.bulbs[name];
            for (let j = 0; j < bulbs.length; j++){
                try {
                    totalState[name] |= await this.getBulbState(bulbs[j]);
                }
                catch (e){
                    console.log(`Error getting hue state for bulb ${name}`);
                }
            }
        }

        return totalState;
    }

    async getBulbState(bulbs){
        if (typeof bulb == 'string')
            bulbs = this.bulbs[bulb];
        else if (typeof bulb == 'number')
            bulbs = [bulbs];

        let state = false;
        for (let i = 0; i < bulbs.length; i++){
            let bulb = bulbs[i];
            try {
                let body = await req(get, `${this.hueAddress}/${bulb}`);        
                state |= body && /"on": ?true/.test(body); 
            }
            catch (e){
                console.log(`Error getting bulb state for ${bulb}`);
                return false;
            }
        }

        return state;
    }

    async toggle(bulbs, timeout) {
        console.log(`Toggle ${bulbs} at ${new Date()}`);
        if (typeof bulbs == 'number')
            bulbs = [bulbs];

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

    async on(bulbs, timeout) {
        console.log(`Turn on ${bulbs} at ${new Date()}`);
        if (typeof bulbs == 'number')
            bulbs = [bulbs];

        for (let i = 0; i < bulbs.length; i++){
            let bulb = bulbs[i];
            req(post, `${this.hueAddress}/${bulb}/state`, JSON.stringify({on:true}));
            if (timeout)
                setTimeout(() => this.toggle(bulb), timeout);
        }
    }

    async off(bulbs) {
        console.log(`Turn off ${bulbs} at ${new Date()}`);
        if (typeof bulbs == 'number')
            bulbs = [bulbs];

        for (let i = 0; i < bulbs.length; i++){
            let bulb = bulbs[i];
            req(post, `${this.hueAddress}/${bulb}/state`, JSON.stringify({on:false}));
        }
    }

}

