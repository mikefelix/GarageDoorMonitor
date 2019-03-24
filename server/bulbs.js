let Hue = require('./hue.js'),
    Wemo = require('./wemo.js'),
    Etek = require('./etek.js'),
    Tuya = require('./tuya.js'),
    Q = require('q'),
    log = require('./log.js')('Bulbs'),
    timeout = require('./timeout.js'),
    format = require('./format.js');

let doAfterSeconds = (after, doThis) => {
    setTimeout(doThis, after * 1000);
}

module.exports = class Bulbs {
    constructor(hueAddress, etekCreds, tuyaConfig){
        this.wemoBulbs = ['fan', 'vent', 'lamp'];
        this.etekBulbs = ['coffee', 'tessel', 'wine', 'piano', 'aquarium', 'bed', 'grow', 'office'];
        this.hueBulbs = {
            garage: [1],
            breezeway: [2],
            driveway: [3,4],
            outside: ['garage','breezeway']
        };
        this.tuyaBulbs = ['charger', 'stereo'];
        this.tuya = new Tuya(tuyaConfig || []);
        this.hue = new Hue(hueAddress, this.hueBulbs);
        this.wemo = new Wemo(this.wemoBulbs);
        this.etek = new Etek(etekCreds[0], etekCreds[1], etekCreds[2], this.etekBulbs, ['coffee', 'bed', 'piano']);
        this.history = {};
        this.overrides = {};

        for (let bulb of this.etekBulbs){
            this.history[bulb] = {};
        }

        for (let bulb in this.hueBulbs){
            this.history[bulb] = {};
        }

        for (let bulb of this.wemoBulbs){
            this.history[bulb] = {};
        }

        for (let bulb of this.tuyaBulbs){
            this.history[bulb] = {};
        }
    }

    removeOverride(name){
        delete this.overrides[name];
    }

    setOverride(name){
        this.overrides[name] = true;
    }

    async getBulb(name){
        try {
            let handler = this._getHandler(name);
            log.debug(`Get bulb ${name}`);
            let state = await handler.getBulbState(name);

            let ret = {
                on: state.on,
                power: state.power,
                history: this.history[name],
                overridden: !!this.overrides[name]
            };

            return ret;
        }
        catch (e){
            log.error(`Couldn't get state for bulb ${name}: ${e}`);
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

    getState(){
        let promiseTimer = timeout(6000, null);
        let getHue = promiseTimer(this.hue.getState(), 'get hue state');
        let getWemo = promiseTimer(this.wemo.getState(), 'get wemo state'); 
        let getEtek = promiseTimer(this.etek.getState(), 'get etek state');
        let getTuya = promiseTimer(this.tuya.getState(), 'get tuya state');

        return Q.all([getHue, getWemo, getEtek, getTuya]).then(states => {
            let [hueState, wemoState, etekState, tuyaState] = states;
            let state = {};
            if (wemoState) state = Object.assign(state, wemoState);
            if (hueState) state = Object.assign(state, hueState);
            if (etekState) state = Object.assign(state, etekState);
            if (tuyaState) state = Object.assign(state, tuyaState);
            state.history = this.history;
            for (let override in this.overrides){
                if (state[override] && this.overrides[override]){
                    state[override].overridden = true;
                }
            }

            return state;
        });
    }

    _hasMeter(name){
        return this.etekBulbs.indexOf(name.toLowerCase()) >= 0;
    }

    _getHandler(name){
        if (this.hueBulbs.hasOwnProperty(name.toLowerCase()))
            return this.hue;
        else if (this.wemoBulbs.indexOf(name.toLowerCase()) >= 0)
            return this.wemo;
        else if (this.etekBulbs.indexOf(name.toLowerCase()) >= 0)
            return this.etek;
        else if (this.tuyaBulbs.indexOf(name.toLowerCase()) >= 0)
            return this.tuya;
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

    _isTuya(name){
        return this.tuyaBulbs.indexOf(name.toLowerCase()) >= 0;
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
            [act, react, expectedState] = [handler.toggle, handler.toggle, !currentState.on];
        else
            throw 'Unknown action ' + action;

        if (delay && react){
            doAfterSeconds(delay, () => {
                this._record(bulbName, 'undo ' + action, 'delay');
                react.call(handler, bulbName, delay);
            });
        }

        if (expectedState != currentState.on){
            let tried = 0;
            do {
                log.debug(`Toggling ${bulbName} to ${expectedState} for ${source || 'unknown reason'}.`);
                tried++;
                await act.call(handler, bulbName);
                log.trace(`Made call. Checking result.`);
                currentState = await handler.getBulbState(bulbName);
                log.trace(`Result is ${JSON.stringify(currentState)}.`);
                if (currentState.on !== expectedState)
                    log.debug(`Retrying because new state is ${currentState.on} instead of ${expectedState}. ${JSON.stringify(currentState)}`);
            }
            while (tried < 10 && expectedState != currentState.on);

            if (tried > 1){
                log.info(`Toggling ${bulbName} to ${expectedState} took ${tried} tries!`);
            }

            if (tried >= 10) {
                log.info(`Could not change ${bulbName} to ${currentState.on} after ${tried} tries.`);
            }
        }

        if (action == 'toggle')
            action = action + (currentState.on ? ' on' : ' off');

        this._record(bulbName, action, source || 'unknown');
        return currentState.on;
    }

}
