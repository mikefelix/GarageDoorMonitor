let {get, put} = require('request'),
    format = require('./format.js'),
    log = require('./log.js'),
    Q = require('q');

module.exports = class Hue {
    constructor(config, device){
        this.log = log('Hue ' + device.name);
        this.nums = device.bulbs;
        this.name = device.name;
        this.log.info(`Initializing ${this.name} with bulbs ${this.nums}.`);
        this.hueAddress = `http://${config.ip}/api/${config.key}/lights`;
    }

    async getState(){
        this.log.debug(`Get state for ${this.name}.`);
        let state = false;

        for (let num of this.nums){
            try {
                let body = await this._req(get, num);
                this.log.trace('Body for ' + num + ': ' + body);
                if (!body) throw 'Response is empty';
                state |= /"on": ?true/.test(body);
            }
            catch (e){
                this.log.error(`Error getting state for ${num}: ${e}`);
                return {offline: true};;
            }
        } 

        return {on: !!state};
    }

    async toggle() {
        let promises = [];
        for (let num of this.nums){
            this.log.debug(`Toggle ${num}.`);
            let body = await this._req(get, num);
            let on = !!body && /"on": ?true/.test(body);
            this.log.debug(`Bulb ${num} was ${on}, so toggling.`);
            promises.push(this._req(put, `${num}/state`, json.stringify({on: !on}))
                .then(res => /"success"/.test(res))
            );
        }

        await Q.all(promises);
        return true;
    }

    async on() {
        for (let num of this.nums){
            this.log.debug(`Turn on ${num}.`);
            this._req(put, `${num}/state`, JSON.stringify({on:true}));
        }

        return true;
    }

    async off() {
        for (let num of this.nums){
            this.log.debug(`Turn off ${num}.`);
            this._req(put, `${num}/state`, JSON.stringify({on:false}));
        }

        return true;
    }

    _req(method, endpoint, body, retrying) {
        return new Promise((resolve, reject) => {
            let url = `${this.hueAddress}/${endpoint}`;
            let o = { headers: {'content-type' : 'application/json'}, url };
            
            if (body)
                o.body = body;

            method(o, (err, res, body) => {
                if (err){
                    if (retrying){
                        reject(err);
                    }
                    else {
                        this.log.warn('Retrying ' + url);
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

    logAt(level){
        this.log.setLevel(level);
    }
}

