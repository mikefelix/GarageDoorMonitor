var axios = require('axios'),
    fs = require('fs'),
    format = require('./format.js'),
    log = require('./log.js')('Alarm', 2);

module.exports = class Alarm {
    constructor(address){
        this.piAddress = address;
        this._readFile();
    }

    nextEnabled(){
        if (this.config.override && this.config.override.disable){
            return false;
        }

        let now = new Date();
        return this.hasTriggeredToday() ? this.config.enabled[(now.getDay() + 1) % 7] : this.config.enabled[now.getDay()];
    }

    nextTime(){
        if (this.config.override && this.config.override.time){
            return this.config.override.time;
        }

        let now = new Date();
        return this.hasTriggeredToday() ? this.config.time[(now.getDay() + 1) % 7] : this.config.time[now.getDay()];
    }

    hasTriggeredToday(){
        let lastTriggeredDay = this.config.lastTriggeredDay || "never";
        let today = format(new Date(), "YYYYMMDD");
        log.debug(`Last triggered is ${lastTriggeredDay}. Today is ${today}.`);
        return lastTriggeredDay == format(new Date(), "YYYYMMDD");
    }

    enabledForToday(){
        let day = new Date().getDay();
        return this.config.enabled[day];
    }

    timeForToday(){
        if (this.hasTriggeredToday()){
            return this.config.lastTriggeredTime;
        }
        
        if (this.config.override && this.config.override.time){
            return this.config.override.time;
        }

        let day = new Date().getDay();
        return this.config.time[day] || "06:00";
    }

    timeToTrigger(){
        if (this.hasTriggeredToday()){
            return false;
        }

        if (this.config.override && this.config.override.time){
            return this.config.override.time;
        }

        let day = new Date().getDay();
        return this.config.time[day] || "06:00";
    }

    weeklyTimes(){
        return [0,1,2,3,4,5,6].map(i => this.config.enabled[i] ? this.config.time[i] : false);
    }

    async getState(){
        return {
            on: (await this.getPiState()).on,
            next: {
                day: this.hasTriggeredToday() ? 'tomorrow' : 'today',
                enabled: this.nextEnabled(),
                time: this.nextTime()
            },
            time: this.timeToTrigger(),
            ringTimeToday: this.timeForToday(),
            lastTriggered: {
                day: this.config.lastTriggeredDay,
                time: this.config.lastTriggeredTime
            },
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
                    log.info(`Set alarm time to ${time} for day ${index}.`);
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
            log.error("Could not communicate with Pi: " + e);
            return {};
        }
    }

    async on(){
        this.config.lastTriggeredDay = format(new Date(), "YYYYMMDD");
        this.config.lastTriggeredTime = format(new Date(), "HH:mm");

        let ring = true;
        if (this.config.override){
            if (this.config.override.disable){
                log.info(`Not ringing because overridden for ${this.config.override.days} days.`);
                ring = false;
            }

            this.config.override.days = (this.config.override.days || 0) - 1;
            if (this.config.override.days <= 0){
                log.info('Removing alarm override.');
                delete this.config.override;
            }
        }
            
        if (ring){
            try {
                log.info(`Ringing alarm.`);
                let res = await axios({ method: 'POST', url: this.piAddress + '/go' });
            }
            catch (e) {
                log.error("Could not communicate with Pi: " + e);
                return false;
            }
        }

        this._writeFile();
        return true;
    }

    async off(){
        try {
            log.info(`Silencing alarm.`);
            let res = await axios({ method: 'POST', url: this.piAddress + '/stop' });
            return true;
        }
        catch (e) {
            log.error("Could not communicate with Pi: " + e);
            return false;
        }
    }

    _setEnabled(enabled, days, times){
        for (let index in this.config.enabled){
            if (days.indexOf(index) >= 0){
                log.info(`Set alarm enabled to ${enabled} for day ${index}.`);
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
            log.warn(`No alarm configuration found; writing default.`);
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
        if (this.config.override && this.config.override.days == 0){
            delete this.config.override;
        }

        log.debug(`Writing alarm config: ${JSON.stringify(this.config)}.`);
        return fs.writeFileSync('./_alarm.json', JSON.stringify(this.config));
    }

}
