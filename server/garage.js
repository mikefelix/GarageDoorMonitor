let Tessel = require('./tessel.js'),
    exec = require('child_process').exec,
    format = require('./format.js'),
    log = require('./log.js')('Garage'),
    Times = require('./sun_times.js');

module.exports = class Garage {
    constructor(tesselUrls){
        this.tessels = tesselUrls.map(url => new Tessel(url));
        this.tessel = this.tessels[0] || this.tessels;
        if (this.tessels.length > 1)
            this.otherTessel = this.tessels[1];
    }

    off(){
        return this.close();
    }

    close(){
        return this._call('close');
    }

    on(time){
        return this.open(time);
    }

    open(time){
        if (Times.get().isNight){
            log(`Turning on outside lights during garage open.`);
            if (this.fireEvent) this.fireEvent('garage opened at night');
        }
        
        return this._call('open', time);
    }

    async _call(action, time, retrying){
        let res;

        try {
            res = await this._callTessel(action, time);
        }
        catch (e){
            log.error(`Error calling Tessel at ${this.tessel.tesselAddress}: ${e}`);
            res = {offline: true};
        }

        if (res.offline){
            // Maybe the Tessel has moved to another address.
            if (!retrying && this.otherTessel){
                log.info(`Tessel seems to have moved? Attempting address ${this.otherTessel.tesselAddress}`);
                let other = this.otherTessel;
                this.otherTessel = this.tessel;
                this.tessel = other;

                return await this._call(action, time, true);
            }
            else {
                log.error(`Cannot find the Tessel at any address.`);
            }
        } 

        return res;
    }

    _callTessel(action, time){
        return new Promise(async (resolve, reject) => {
            try {
                if (action == 'state'){
                    let state = await this.tessel.get('state');
                    if (state){
                        resolve(state);
                    }
                    else {
                        reject('unknown');
                    }
                }
                else {
                    log.info(`Calling action ${action} on garage with time ${time }.`);
                    let res = await this.tessel.post(action + (time || ''));
                    log.info(`Tessel replies: ${res}`);

                    setTimeout(async () => {
                        resolve(await this.tessel.get('state'));
                    }, 4000);
                }
            }
            catch (e){
                log(1, `Error: ${e}`);
                reject(e);
            }
        });

        return timeout(5000)(promise, 'garage: ' + action);
    }

    saveSnap(after){
        if (after){
            setTimeout(this.saveSnap.bind(this), after * 1000);
        }
        else {
            exec('/home/felix/bin/snapshot.sh', (error, stdout, stderr) => {
                if (error) log(1, "Failed to save snapshot. " + error);
            });
        }
    }

    async getState(){
        let formatTesselDate = (date) => {
            return date ? format(date) : null;
        };

        let state = {};
        try {
            let tesselState = await this._call('state');
            if (!tesselState) return { offline: true };
            if (tesselState.offline) return tesselState;

            tesselState = JSON.parse(tesselState);
            tesselState.on = tesselState.is_open;
            tesselState.last_open_time = formatTesselDate(tesselState.last_open_time);
            tesselState.last_close_time = formatTesselDate(tesselState.last_close_time);
            tesselState.next_close_time = formatTesselDate(tesselState.next_close_time);
            tesselState.current_time = formatTesselDate(tesselState.current_time);
            tesselState.offline = false;
            return tesselState;
        }
        catch (e) {
            log(1, 'Error with Tessel state: ' + e);
            return { offline: true };
        }
    }
}
