var axios = require('axios'),
    fs = require('fs'),
    format = require('./format.js'),
    times = require('./times.js'),
    log = require('./log.js')('Alarm');

module.exports = class Alarm {
    constructor(addresses){
        if (addresses[0]){
            this.piAddress = addresses[0];
            if (addresses[1])
                this.otherAddress = addresses[1];
        }
        else { 
            this.piAddress = addresses;
        }

        this._readFile();
    }

    async getState(){
        let pi = await this.getPiState();

        return {
            on: pi ? pi.on : false,
            next: {
                day: this.nextDay(),
                time: this.nextTime(), 
                overridden: this.config.override != null
            },
            time: this.timeToTrigger(),
            hasTriggeredToday: this.hasTriggeredToday(),
            ringTimeToday: this.ringTimeToday(),
            lastTriggered: {
                day: this.config.lastTriggeredDay,
                time: this.config.lastTriggeredTime,
                action: this.config.lastTriggeredAction
            },
            settings: this.config.settings,
            override: this.config.override,
            today: times.dayNum(),
            todayName: times.dayName()
        };
    }

    nextDay(){
        let i = !this.hasTriggeredToday() ? 0 : 1
        if (this.config.override){
            if (this.config.override.disabled){
                i += +this.config.override.days;
            }
        }

        return times.dayNum(i);
    }

    nextTime(){
        if (this.config.override){
            if (this.config.override.time){
                return this.config.override.time;
            }
        }

        let day = times.dayNum(!this.hasTriggeredToday() ? 0 : 1);
        return this.config.settings[day];
    }

    hasRungToday(){
        return this.config.lastTriggeredAction == 'rung' && this.hasTriggeredToday();
    }

    hasTriggeredToday(){
        let lastTriggeredDay = this.config.lastTriggeredDay || "never";
        let today = format(new Date(), "YYYYMMDD");
        log.debug(`Last triggered is ${lastTriggeredDay}. Today is ${today}.`);
        return lastTriggeredDay == today;
    }

    enabledForToday(){
        return this.config.settings[times.dayNum()] != null || (this.config.override && this.config.override.time);
    }

    ringTimeToday(){
        if (this.hasRungToday())
            return this.config.lastTriggeredTime;
        else if (this.hasTriggeredToday())
            return "";
        
        if (this.config.override){
            if (this.config.override.time)
                return this.config.override.time;
            else 
                return "";
        }

        return this.config.settings[times.dayNum()] || "06:00";
    }

    timeToTrigger(){
        if (this.config.hasTriggeredToday())
            return this.config.lastTriggeredTime;

        if (this.config.override && this.config.override.time)
            return this.config.override.time;

        return this.config.settings[times.dayNum()] || "06:00";
    }

    setTime(time, days, override){
        if (override){
            this.config.override = {days, time};
        }
        else {
            log.info(`Set alarm time to ${time} for days ${days}.`);
            this.config.settings[days] = time;
        }

        this._writeFile();
    }

    enable(day){
        this._setEnabled(true, day);
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

    async send(method, path, retrying){
        try {
            if (retrying){
                let other = this.otherAddress;
                this.otherAddress = this.piAddress;
                this.piAddress = other;
            }

            let opts = { url: this.piAddress + '/' + path, method };
            return await axios(opts);
        }
        catch (e){
            if (retrying){
                log.error('Error during retry sending to alarm: ' + e);
                return {offline: true};
            }
            else {
                log.error('Error sending to alarm: ' + e);
                log.info(`Retrying send to ${this.otherAddress}.`);
                return await this.send(method, path, true);
            }
        }
    }

    async getPiState(){
        try {
            return (await this.send('GET', 'state')).data;
        }
        catch (e){
            log.error("Could not communicate with Pi: " + e);
            return {offline: true};
        }
    }

    async on(){
        let ring = !this.hasTriggeredToday();
        this.config.lastTriggeredDay = format(new Date(), "YYYYMMDD");
        this.config.lastTriggeredTime = format(new Date(), "HH:mm");

        // Todo: enable via override when disabled.
        if (!this.enabledForToday()){
            log.info('Not ringing because alarm is disabled.');
            ring = false;
            this.config.lastTriggeredAction = 'disabled';
        }
        else if (this.config.override){
            if (this.config.override.disable){
                log.info(`Not ringing because overridden for ${this.config.override.days} days.`);
                ring = false;
                this.config.lastTriggeredAction = 'overridden';
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
                let res = await this.send('POST', 'go');
                this.config.lastTriggeredAction = 'rung';
            }
            catch (e) {
                log.error("Could not communicate with Pi: " + e);
                this.config.lastTriggeredAction = 'errored';
                return false;
            }
        }
        else {
            log.info('Not ringing.');
        }

        this._writeFile();
        return true;
    }

    async off(){
        try {
            log.info(`Silencing alarm.`);
            let res = await this.send('POST', 'stop_mv73bEuCCGxD');
            return true;
        }
        catch (e) {
            log.error("Could not communicate with Pi: " + e);
            return false;
        }
    }

    _setEnabled(enabled, day){
        let setting = this.config.settings[day] != null;
        if (setting != enabled){
            log.info(`Set alarm enabled to ${enabled} for day ${day}.`);
            this.config.settings[day] = enabled ? "08:00" : null;
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
                settings: [ '08:00', '08:00', '08:00', '08:00', '08:00', '08:00', '08:00',
                            '08:00', '08:00', '08:00', '08:00', '08:00', '08:00', '08:00' ]
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

    logAt(level){
        log.setLevel(level);
    }
}
