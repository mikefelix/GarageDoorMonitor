let Hue = require('./hue.js'),
    Wemo = require('./wemo.js');

let doAfterSeconds = (doThis, after) => {
    setTimeout(doThis, after * 1000);
}

module.exports = class Bulbs {
    constructor(hueAddress){
        this.wemoBulbs = ['lamp', 'aquarium'];
        this.hueBulbs = {
            garage: [1],
            breezeway: [2],
            driveway: [3,4],
            outside: [1,2,3,4]
        };
        this.hue = new Hue(hueAddress, this.hueBulbs);
        this.wemo = new Wemo(this.wemoBulbs);
    }

    _isHue(name){
        return this.hueBulbs.hasOwnProperty(name.toLowerCase());
    }

    _isWemo(name){
        return this.wemoBulbs.indexOf(name.toLowerCase()) >= 0;
    }

    async getBulbState(name){
        try {
            if (this._isHue(name)){
                let state = await this.hue.getBulbState(name);
                return state;
            }
            else if (this._isWemo(name)){
                let state = await this.wemo.getBulbState(name);
                return state;
            }
        }
        catch (e){
            console.log("Couldn't get state for bulb", name, ":", e);
            return false;
        }
    }

    async getState(){
        let hueState = await this.hue.getState();
        let wemoState = await this.wemo.getState();
        let state = Object.assign(wemoState, hueState);
        return state;
    }

    async on(bulbName, time){
        if (this._isHue(bulbName)){
            let bulbs = this.hueBulbs[bulbName];
            for (let i = 0; i < bulbs.length; i++)
                this.hue.on(bulbs[i]);

            if (time){
                doAfterSeconds(() => {
                    for (let i = 0; i < bulbs.length; i++)
                        this.hue.off(bulbs[i]);
                }, time);
            }

            return true;
        }
        else if (this._isWemo(bulbName)){
            this.wemo.on(bulbName.substring(0, 1).toUpperCase() + bulbName.substring(1));
            if (time){
                doAfterSeconds(() => {
                    this.wemo.off(bulbName);
                }, time);
            }

            return true;
        }
        else {
            throw 'Unknown bulb ' + bulbName;
        }
    }

    async off(bulbName){
        if (this._isHue(bulbName)){
            let bulbs = this.hueBulbs[bulbName];
            for (let i = 0; i < bulbs.length; i++)
                this.hue.off(bulbs[i]);

            return true;
        }
        else if (this._isWemo(bulbName)){
            this.wemo.off(bulbName.substring(0, 1).toUpperCase() + bulbName.substring(1));
            return true;
        }
        else {
            throw 'Unknown bulb ' + bulbName;
        }
    }

    async toggle(bulbName, time){
        if (this._isHue(bulbName)){
            let bulbs = this.hueBulbs[bulbName];
            let state = false;
            for (let i = 0; i < bulbs.length; i++)
                state |= this.hue.toggle(bulbs[i]);

            if (time){
                doAfterSeconds(() => {
                    for (let i = 0; i < bulbs.length; i++)
                        this.hue.toggle(bulbs[i]);
                }, time);
            }
                    
            return state;
        }
        else if (this._isWemo(bulbName)){
            let bulb = bulbName.substring(0, 1).toUpperCase() + bulbName.substring(1)
            let res = this.wemo.toggle(bulb);

            if (time){
                doAfterSeconds(() => {
                    this.wemo.toggle(bulb);
                }, time);
            }

            return res;
        }
        else {
            throw 'Unknown bulb ' + bulbName;
        }
    }
}
