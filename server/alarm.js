var axios = require('axios'),
    fs = require('fs'),
    log = require('./log.js')('Alarm', 2);

module.exports = class Alarm {
    constructor(address){
        this.piAddress = address;
        this._readFile();
    }

    /*async _checkLoop(){
        if (!this.on() || await this.shouldSilence()){
            this.off();
        }
        else {
            this.timeout = setTimeout(this._checkLoop.bind(this), 30000);
        }
    }*/

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
        let todayIsWeekend = now.getDay() == 0 || now.getDay() == 6; 
        let [todaysAlarmHour, todaysAlarmMin] = (this.config.time[now.getDay()] || "00:00").split(':');
        return todaysAlarmHour < now.getHours() || todaysAlarmHour == now.getHours() && todaysAlarmMin < now.getMinutes;
    }

    async get(){
        return {
            on: await this.getPiState().on,
            enabled: this.nextEnabled(),
            time: this.nextTime(),
            config: this.config
        };
    }

    _readFile(){
        let conf;
        if (fs.existsSync('./alarm.json')){
            conf = fs.readFileSync('./_alarm.json');
        }
        
        if (!conf || conf == ''){
            this.config = {
                time: [ '09:00', '08:00', '08:00', '08:00', '08:00', '08:00', '09:00' ],
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
        return fs.writeFileSync('./_alarm.json', JSON.stringify(this.config));
    }

    setEnabled(enabled, days, times){
        for (let index in this.config.enabled){
            if (days.indexOf(index) >= 0){
                log(`Set alarm enabled to ${enabled} for day ${index}.`);
                this.config.enabled[index] = enabled;
            }
        }

        this._writeFile();
    }

    setTime(time, days){
        for (let index in this.config.time){
            if (days.indexOf(index) >= 0){
                log(`Set alarm time to ${time} for day ${index}.`);
                this.config.time[index] = time;
            }
        }

        this._writeFile();
    }

    enable(day){
        return this.setEnabled(true, day);
    }

    disable(day, times){
        return this.setEnabled(false, day, times);
    }

    async getPiState(){
        try {
            return await axios({ method: 'GET', url: this.piAddress });
        }
        catch (e){
            log(1, "Could not communicate with Pi: " + e);
            return false;
        }
    }

    async on(){
        try {
            log(`Ringing alarm.`);
            let res = await axios({ method: 'POST', url: this.piAddress + '/go' });
            return true;
        }
        catch (e) {
            log(1, "Could not communicate with Pi: " + e);
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

}
