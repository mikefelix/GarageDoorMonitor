let Tessel = require('./tessel.js'),
    exec = require('child_process').exec,
    format = require('./format.js'),
    log = require('./log.js')('Garage'),
    Times = require('./sun_times.js');

module.exports = class Garage {
    constructor(tesselUrl, bulbs){
        this.bulbs = bulbs;
        this.tessel = new Tessel(tesselUrl);
    }

    close(){
        return this._call('close');
    }

    open(time){
        return this._call('open', time);
    }

    _call(action, time){
        if (Times.get().isNight){
            log(`Turning on outside lights during garage open.`);
            this.bulbs.on('outside', 180, 'garage opened at night via app');
        }
        
        return new Promise(async (resolve, reject) => {
            try {
                log(`Opening garage ${time ? 'for ' + time + ' minutes' : 'indefinitely'}.`);
                let res = await this.tessel.post(action + (time || ''));
                log(`Tessel replies: ${res}`);

                setTimeout(async () => {
                    resolve(await this.tessel.get('state'));
                }, 6000);
            }
            catch (e){
                log(`Error: ${e}`);
                reject(e);
            }
        });
    }

    saveSnap(after){
        if (after){
            setTimeout(this.saveSnap.bind(this), after * 1000);
        }
        else {
            exec('/home/felix/bin/snapshot.sh', (error, stdout, stderr) => {
                if (error) log("Failed to save snapshot. " + error);
            });
        }
    }

    async getState(){
        let formatTesselDate = (date) => {
            return date ? format(date) : null;
        };

        let state = {};
        try {
            let tesselState = await this.tessel.get('state');
            tesselState = JSON.parse(tesselState);
            tesselState.last_open_time = formatTesselDate(tesselState.last_open_time);
            tesselState.last_close_time = formatTesselDate(tesselState.last_close_time);
            tesselState.next_close_time = formatTesselDate(tesselState.next_close_time);
            tesselState.current_time = formatTesselDate(tesselState.current_time);
            return tesselState;
        }
        catch (e) {
            log('Error with Tessel state: ' + e);
            return undefined;
        }
    }
}
