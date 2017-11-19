let Hue = require('./hue.js'),
    Wemo = require('./wemo.js');

let isWemo = function(name) {
    name = name.toLowerCase();
    return name == 'aquarium' || name == 'lamp';
}

let isHue = function(name) {
    name = name.toLowerCase();
    return name == 'breezeway' || name == 'garage' || name == 'driveway' || name == 'driveway';
}

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

    async getBulbState(name){
        if (isHue(name)){
            return await this.hue.getBulbState(name);
        }
        else if (isWemo(name)){
            return await this.wemo.getBulbState(name);
        }
    }

    async getState(){
        let hueState = await this.hue.getState();
        let wemoState = await this.wemo.getState();
        let state = Object.assign(wemoState, hueState);
        return state;
    }

    async on(bulbName, time){
        if (isHue(bulbName)){
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
        else if (isWemo(bulbName)){
            this.wemo.on(bulbName.substring(0, 1).toUpperCase() + bulbName.substring(1));
            if (time){
                doAfterSeconds(() => {
                    this.wemo.off(bulbName);
                }, time);
            }

            return true;
        }
        else {
            return false;
        }
    }

    async off(bulbName){
        if (isHue(bulbName)){
            let bulbs = this.hueBulbs[bulbName];
            for (let i = 0; i < bulbs.length; i++)
                this.hue.off(bulbs[i]);

            return true;
        }
        else if (isWemo(bulbName)){
            this.wemo.off(bulbName.substring(0, 1).toUpperCase() + bulbName.substring(1));
            return true;
        }
        else {
            return false;
        }
    }

    async toggle(bulbName, time){
        if (isHue(bulbName)){
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
                    
            return true;
        }
        else if (isWemo(bulbName)){
            let bulb = bulbName.substring(0, 1).toUpperCase() + bulbName.substring(1)
            this.wemo.toggle(bulb);

            if (time){
                doAfterSeconds(() => {
                    this.wemo.toggle(bulb);
                }, time);
            }

            return true;
        }
        else {
            return false;
        }
    }
}
