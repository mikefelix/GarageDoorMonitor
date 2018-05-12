let Hue = require('./hue.js'),
    Wemo = require('./wemo.js'),
    Etek = require('./etek.js'),
    log = require('./log.js')('Bulbs'),
    format = require('./format.js');

let doAfterSeconds = (after, doThis) => {
    setTimeout(doThis, after * 1000);
}

module.exports = class Bulbs {
    constructor(hueAddress, etekCreds){
        this.wemoBulbs = ['lamp', 'aquarium'];
        this.etekBulbs = ['coffee', 'fan', 'wine', 'office', 'vent', 'stereo'];
        this.hueBulbs = {
            garage: [1],
            breezeway: [2],
            driveway: [3,4],
            //outside: ['garage','breezeway','driveway']
            outside: ['garage','breezeway']
        };

        this.hue = new Hue(hueAddress, this.hueBulbs);
        this.wemo = new Wemo(this.wemoBulbs);
        this.etek = new Etek(etekCreds[0], etekCreds[1]);
        this.history = {};

        for (let bulb of this.etekBulbs){
            this.history[bulb] = {};
        }

        for (let bulb in this.hueBulbs){
            this.history[bulb] = {};
        }

        for (let bulb of this.wemoBulbs){
            this.history[bulb] = {};
        }
    }

    async getBulb(name){
        try {
            let handler = this._getHandler(name);
            //log(`Get bulb ${name}`);
            let state = await handler.getBulbState(name);

            return {
                state: state,
                history: this.history[name]
            };
        }
        catch (e){
            log(`Couldn't get state for bulb ${name}: ${e}`);
            return false;
        }
    }

    async on(bulbName){ 
        await this._handle(bulbName, 'on', this._getSource(arguments), this._getDelay(arguments)); 
        return await this.getBulb(bulbName);
    }

    async off(bulbName){ 
        await this._handle(bulbName, 'off', this._getSource(arguments), this._getDelay(arguments)); 
        return await this.getBulb(bulbName);
    }

    async toggle(bulbName){ 
        await this._handle(bulbName, 'toggle', this._getSource(arguments), this._getDelay(arguments)); 
        return await this.getBulb(bulbName);
    }

    async getState(){
        let hueState = await this.hue.getState();
        let wemoState = await this.wemo.getState();
        let etekState = await this.etek.getState();
        let state = Object.assign(wemoState, hueState);
        state = Object.assign(state, etekState);
        state.history = this.history;
        return state;
    }

    _getHandler(name) {
        if (this.hueBulbs.hasOwnProperty(name.toLowerCase()))
            return this.hue;
        else if (this.wemoBulbs.indexOf(name.toLowerCase()) >= 0)
            return this.wemo;
        else if (this.etekBulbs.indexOf(name.toLowerCase()) >= 0)
            return this.etek;
        else 
            throw 'Unknown bulb ' + name;
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

        event.date = format(new Date());
        event.source = source;
        
        if (this._isHue[bulbName]){
            for (let bulb in this.hueBulbs[bulbName]){
                if (typeof bulb == 'string'){
                    this._record(bulb, action, source);
                }
            }
        }
    }

    async _handle(bulbName, action, source, delay){
        let handler = this._getHandler(bulbName);
        let currentState = await handler.getBulbState(bulbName);
        let act, react, expectedState;

        if (action == 'on')
            [act, react, expectedState] = [handler.on, handler.off, true];
        else if (action == 'off')
            [act, react, expectedState] = [handler.off, undefined, false];
        else if (action == 'toggle')
            [act, react, expectedState] = [handler.toggle, handler.toggle, !currentState];
        else
            throw 'Unknown action ' + action;

        if (delay && react){
            doAfterSeconds(delay, () => {
                this._record(bulbName, 'undo ' + action, 'delay');
                react.call(handler, bulbName, delay);
            });
        }

        if (expectedState != currentState){
            let tried = 0;
            do {
                log(`Toggling ${bulbName} to ${expectedState} for ${source || 'unknown reason'}.`);
                tried++;
                await act.call(handler, bulbName);
                log(`Made call. Checking result.`);
                currentState = await handler.getBulbState(bulbName);
                log(`New state is ${currentState}.`);
            }
            while (tried < 10 && expectedState != currentState);

            if (tried > 1){
                log(`Toggling ${bulbName} to ${expectedState} took ${tried} tries!`);
            }

            if (tried >= 10) {
                log(`Could not change ${bulbName} to ${currentState} after ${tried} tries.`);
            }
        }

        if (action == 'toggle')
            action = action + (currentState ? ' on' : ' off');

        this._record(bulbName, action, source || 'unknown');
        return currentState;
    }

}
