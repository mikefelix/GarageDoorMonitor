var axios = require('axios'),
    fs = require('fs'),
    log = require('./log.js')('Alarm', 2);

module.exports = class Alarm {
    constructor(address){
        this.piAddress = address;
        this._readFile();
    }

    nextEnabled(){
        let now = new Date();
        return this.hasRungToday() ? this.config.enabled[(now.getDay() + 1) % 7] : this.config.enabled[now.getDay()];
    }

    nextTime(){
        let now = new Date();
        return this.hasRungToday() ? this.config.time[(now.getDay() + 1) % 7] : this.config.time[now.getDay()];
    }

    hasRungToday(){
        let now = new Date();
        let [todaysAlarmHour, todaysAlarmMin] = (this.config.time[now.getDay()] || "00:00").split(':');
        return todaysAlarmHour < now.getHours() || todaysAlarmHour == now.getHours() && todaysAlarmMin < now.getMinutes;
    }

    timeForToday(){
        if (this.config.override){
            if (this.config.override.disable){
                return false;
            }
            else if (this.config.override.time){
                return this.config.override.time;
            }
        }

        let day = new Date().getDay();
        return this.config.enabled[day] ? this.config.time[day] : false;
    }

    weeklyTimes(){
        return [0,1,2,3,4,5,6].map(i => this.config.enabled[i] ? this.config.time[i] : false);
    }

    async get(){
        return {
            on: (await this.getPiState()).on,
            next: {
                day: this.hasRungToday() ? 'tomorrow' : 'today',
                enabled: this.nextEnabled(),
                time: this.nextTime()
            },
            time: this.timeForToday(),
            times: this.config.time,
            override: this.config.override,
            enabled: this.config.enabled
        };
    }

    setTime(time, days, override){
        if (override){
            this.config.override = {days, time};
        }
        else {
            for (let index in this.config.time){
                if (days.indexOf(index) >= 0){
                    log(`Set alarm time to ${time} for day ${index}.`);
                    this.config.time[index] = time;
                }
            }
        }

        this._writeFile();
    }

    enable(days){
        this._setEnabled(true, days);
    }

    disable(days, override){
        if (override){
            this.config.override = {days, disable: true};
        }
        else {
            this._setEnabled(false, days);
        }

        this._writeFile();
    }

    async getPiState(){
        try {
            return (await axios({ method: 'GET', url: this.piAddress })).data;
        }
        catch (e){
            log(1, "Could not communicate with Pi: " + e);
            return {};
        }
    }

    async on(){
        let ring = true;
        if (this.config.override){
            if (this.config.override.disable){
                log.info(`Not ringing because overridden for ${this.config.override.days} days.`);
                ring = false;
            }

            this.config.days--;
            if (this.config.override.days == 0)
                delete this.config.override;

            this._writeFile();
        }
            
        if (!ring)
            return true;

        try {
            log.info(`Ringing alarm.`);
            let res = await axios({ method: 'POST', url: this.piAddress + '/go' });
            return true;
        }
        catch (e) {
            log.error("Could not communicate with Pi: " + e);
            return false;
        }
    }

    async off(){
        try {
            log(`Silencing alarm.`);
            let res = await axios({ method: 'POST', url: this.piAddress + '/stop' });
            return true;
        }
        catch (e) {
            log(1, "Could not communicate with Pi: " + e);
            return false;
        }
    }

    _setEnabled(enabled, days, times){
        for (let index in this.config.enabled){
            if (days.indexOf(index) >= 0){
                log(`Set alarm enabled to ${enabled} for day ${index}.`);
                this.config.enabled[index] = enabled;
            }
        }
    }

    _readFile(){
        let conf;
        if (fs.existsSync('./_alarm.json')){
            conf = fs.readFileSync('./_alarm.json');
        }
        
        if (!conf || conf == ''){
            log(2, `No alarm configuration found; writing default.`);
            this.config = {
                time: [ '09:01', '08:01', '08:01', '08:01', '08:01', '08:01', '09:01' ],
                enabled: [ true, true, true, true, true, true, true ]
            };

            this._writeFile();
        }
        else {
            this.config = JSON.parse(conf);
            if (this.config.disableUntil){
                this._writeFile();
            }
        }
    }

    _writeFile(){
        log(1, `Writing alarm config: ${JSON.stringify(this.config)}.`);
        return fs.writeFileSync('./_alarm.json', JSON.stringify(this.config));
    }

}
