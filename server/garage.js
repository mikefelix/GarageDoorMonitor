let Tessel = require('./tessel.js'),
    exec = require('child_process').exec,
    format = require('./format.js'),
    log = require('./log.js')('Garage', 4),
    timeout = require('./timeout.js'),
    Times = require('./sun_times.js');

module.exports = class Garage {
    constructor(tesselUrl){
        this.tessel = new Tessel(tesselUrl);
    }

    off(){
        return this.close();
    }

    close(){
        return this._call('close');
    }

    on(time){
        return this._open(time);
    }

    open(time){
        return this._call('open', time);
    }

    _call(action, time){
        if (Times.get().isNight){
            log(`Turning on outside lights during garage open.`);
            if (this.fireEvent) this.fireEvent('garage opened at night');
        }
        
        return new Promise(async (resolve, reject) => {
            try {
                log.info(`Opening garage ${time ? 'for ' + time + ' minutes' : 'indefinitely'}.`);
                let res = await this.tessel.post(action + (time || ''));
                log.info(`Tessel replies: ${res}`);

                setTimeout(async () => {
                    resolve(await this.tessel.get('state'));
                }, 6000);
            }
            catch (e){
                log(1, `Error: ${e}`);
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
            let timer = timeout(5000);
            let tesselState = await timer(this.tessel.get('state'));
            tesselState = JSON.parse(tesselState);
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
