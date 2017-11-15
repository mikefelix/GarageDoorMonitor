let {get, post} = require('request');

function req(method, url, body) {
    new Promise((resolve, reject) => {
        let o = {
            headers: {'content-type' : 'application/json'},
            url: url
        }
        
        if (body)
            o.body = body;

        method(o, (err, res, body) => {
            if (err)
                reject(err);
            else
                resolve(body);
        });
    });
}    

class Hue {
    constructor(address){
        this.hueAddress = address;
    }

    async getState(bulb){
        let body = await req(get, `${this.hueAddress}/${bulb}`);        
        return body && /"on": ?true/.test(body); 
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

module.exports = Hue;
