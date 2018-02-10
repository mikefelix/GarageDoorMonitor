let format = require('./format.js'),
    moment = require('moment-timezone'),
    fs = require('fs'),
    Times = require('./sun_times.js');

module.exports = class Scheduler {
    constructor(file, getBulb, turnOn, turnOff){
        this.file = file;
        this.getBulb = getBulb;
        this.turnOn = turnOn;
        this.turnOff = turnOff;
        this._readFile();
        setInterval(this.checkAll.bind(this), 60000);
    }

    override(schedule) {
        if (this.schedules[schedule])
            this.schedules[schedule].overridden = true;
    }

    async checkAll(){
        let date = new Date();
        for (let schedule in this.schedules){
            this.check(schedule);
        }
    }

    async check(name, date){
        if (!date) date = new Date();
        let schedule = this.schedules[name];
        if (!schedule) {
            console.log(`Schedule ${schedule} not found.`);
            return;
        }

        let time = date.getTime();
        let on = Times.parse(schedule.on);
        let off = Times.parse(schedule.off);
        let overridden = !!schedule.overridden;

        function currentTimeIs(minute) {
            let minuteStart = minute.getTime();
            return time > minuteStart && time < minuteStart + 60000;
        };

        if (name == 'reset'){
            if (currentTimeIs(Times.parse(schedule.at))){
                console.log('Loading schedule...');
                this._readFile();
            }
        }

        if (!overridden){
            if (on && currentTimeIs(on)){
                console.log(`It's ${format(date)} and time to trigger "on" action for schedule "${name}".`);
                let bulb = await this.getBulb(name);//this.bulbs.getBulb(name);
                if (!bulb.state){
                    console.log('Turn on ' + name);
                    await this.turnOn(name, 'schedule');
                } else console.log('Bulb ' + name + ' was already on.');
            }

            if (off && currentTimeIs(off)){
                console.log(`It's ${format(date)} and time to trigger "off" action for schedule "${name}".`);
                let bulb = await this.getBulb(name);//this.bulbs.getBulb(name);
                if (bulb.state){
                    console.log('Turn off ' + name);
                    await this.turnOff(name, 'schedule');
                } else console.log('Bulb ' + name + ' was already off.');
            }
        }
    }

    getSchedules(){
        let schedules = Object.assign({}, this.schedules);
        for (let sched in this.schedules) {
            let schedule = this.schedules[sched];
            let on = schedule.on;
            let off = schedule.off;
            let at = schedule.at;
            if (on) {
                if (typeof on == 'object') {console.log('should not be object here');console.dir(on);}
                schedule.on = {
                    spec: on,
                    date: format(Times.parse(on), true)
                }
            }

            if (off) {
                schedule.off = {
                    spec: off,
                    date: format(Times.parse(off), true)
                }
            }

            if (at) {
                schedule.at = {
                    spec: at,
                    date: format(Times.parse(at), true)
                }
            }
        }

        return schedules;
    }

    _readFile(){
        this.schedules = JSON.parse(fs.readFileSync(this.file));
    }
}
