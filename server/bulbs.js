let Hue = require('./hue.js'),
    Wemo = require('./wemo.js'),
    Etek = require('./etek.js'),
    format = require('./format.js');

let doAfterSeconds = (after, doThis) => {
    setTimeout(doThis, after * 1000);
}

module.exports = class Bulbs {
    constructor(hueAddress, etekCreds){
        this.wemoBulbs = ['lamp', 'aquarium'];
        this.etekBulbs = ['coffee', 'wine'];
        this.hueBulbs = {
            garage: [1],
            breezeway: [2],
            driveway: [3,4],
            outside: ['garage','breezeway','driveway']
        };

        this.hue = new Hue(hueAddress, this.hueBulbs);
        this.wemo = new Wemo(this.wemoBulbs);
        this.etek = new Etek(etekCreds[0], etekCreds[1]);
        this.history = {};

        for (let bulb in this.hueBulbs){
            this.history[bulb] = {};
        }

        for (let bulb of this.wemoBulbs){
            this.history[bulb] = {};
        }
    }

    async getBulb(name){
        try {
            let state;
            if (this._isHue(name)){
                state = await this.hue.getBulbState(name);
            }
            else if (this._isWemo(name)){
                state = await this.wemo.getBulbState(name);
            }
            else if (this._isEtek(name)){
                state = await this.etek.getBulbState(name);
            }

            return {
                state: state,
                history: this.history[name]
            };
        }
        catch (e){
            console.log("Couldn't get state for bulb", name, ":", e);
            return false;
        }
    }

    on(bulbName){ return this._handle(bulbName, 'on', this._getSource(arguments), this._getDelay(arguments)); }
    off(bulbName){ return this._handle(bulbName, 'off', this._getSource(arguments), this._getDelay(arguments)); }
    toggle(bulbName){ return this._handle(bulbName, 'toggle', this._getSource(arguments), this._getDelay(arguments)); }

    async getState(){
        let hueState = await this.hue.getState();
        let wemoState = await this.wemo.getState();
        let etekState = await this.etek.getState();
        let state = Object.assign(wemoState, hueState);
        state = Object.assign(state, etekState);
        state.history = this.history;
        return state;
    }

    _isHue(name){
        return this.hueBulbs.hasOwnProperty(name.toLowerCase());
    }

    _isWemo(name){
        return this.wemoBulbs.indexOf(name.toLowerCase()) >= 0;
    }

    _isEtek(name){
        return this.etekBulbs.indexOf(name.toLowerCase()) >= 0;
    }

    _getSource(args){
        let source;
        if (typeof args[1] == 'string') source = args[1]; 
        if (typeof args[2] == 'string') source = args[2]; 
        return source;
    }

    _getDelay(args){
        if (typeof args[1] == 'number') return args[1]; 
        if (typeof args[2] == 'number') return args[2]; 
        return undefined;
    }

    _record(bulbName, action, source){
        let record = this.history[bulbName];
        if (!record) 
            throw 'Cannot get history for ' + bulbName;

        let event = record[action];
        if (!event) 
            event = record[action] = {};

        event.date = format(new Date(), true);
        event.source = source;
        
        if (this._isHue[bulbName]){
            for (let bulb in this.hueBulbs[bulbName]){
                if (typeof bulb == 'string'){
                    this._record(bulb, action, source);
                }
            }
        }
    }

    _handle(bulbName, action, source, delay){
        let handler;
        if (this._isHue(bulbName))
            handler = this.hue;
        else if (this._isWemo(bulbName))
            handler = this.wemo;
        else if (this._isEtek(bulbName))
            handler = this.etek;
        else 
            throw 'Unknown bulb ' + bulbName;

        let act, react;
        if (action == 'on')
            [act, react] = [handler.on, handler.off];
        else if (action == 'off')
            [act, react] = [handler.off, undefined];
        else if (action == 'toggle')
            [act, react] = [handler.toggle, handler.toggle];
        else
            throw 'Unknown action ' + action;

        if (delay && react){
            doAfterSeconds(delay, () => {
                this._record(bulbName, 'undo ' + action, 'delay');
                react.call(handler, bulbName, delay);
            });
        }

        let res = act.call(handler, bulbName);
        if (action == 'toggle')
            action = action + (res ? ' on' : ' off');

        this._record(bulbName, action, source || 'unknown');
        return res;
    }

}
