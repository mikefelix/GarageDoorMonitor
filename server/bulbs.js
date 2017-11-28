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
            let res = this.hue.on(bulbName);

            if (time){
                doAfterSeconds(() => this.hue.off(bulbName), time);
            }

            return await res;
        }
        else if (this._isWemo(bulbName)){
            let res = this.wemo.on(bulbName.substring(0, 1).toUpperCase() + bulbName.substring(1));

            if (time){
                doAfterSeconds(() => this.wemo.off(bulbName), time);
            }

            return await res;
        }
        else {
            throw 'Unknown bulb ' + bulbName;
        }
    }

    async off(bulbName){
        if (this._isHue(bulbName)){
            return await this.hue.off(bulbName);
        }
        else if (this._isWemo(bulbName)){
            return await this.wemo.off(bulbName.substring(0, 1).toUpperCase() + bulbName.substring(1));
        }
        else {
            throw 'Unknown bulb ' + bulbName;
        }
    }

    async toggle(bulbName, time){
        if (this._isHue(bulbName)){
            let toggled = this.hue.toggle(bulbName);

            if (time){
                doAfterSeconds(() => this.hue.toggle(bulbName), time);
            }
                    
            return await toggled;
        }
        else if (this._isWemo(bulbName)){
            let bulb = bulbName.substring(0, 1).toUpperCase() + bulbName.substring(1)
            let res = this.wemo.toggle(bulb);

            if (time){
                doAfterSeconds(() => this.wemo.toggle(bulbName), time);
            }

            return await res;
        }
        else {
            throw 'Unknown bulb ' + bulbName;
        }
    }
}
