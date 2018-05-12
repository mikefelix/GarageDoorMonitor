let format = require('./format.js'),
    moment = require('moment-timezone'),
    util = require('util'),
    exec = util.promisify(require('child_process').exec);
    fs = require('fs'),
    log = require('./log.js')('Scheduler'),
    Times = require('./sun_times.js');

module.exports = class Scheduler {
    constructor(file, getBulb, turnOn, turnOff){
        this.file = file;
        this._getBulb = getBulb;
        this._turnOn = turnOn;
        this._turnOff = turnOff;
        this._readFile();
        this.timers = {};
        setInterval(this.checkAll.bind(this), 60000);
    }

    override(schedule) {
        if (this.schedules[schedule] && !this.specifiesCountdown(this.schedules[schedule]))
            this.schedules[schedule].overridden = true;
    }

    async checkAll(){
        if (this.currentTimeIs(this.reset)){
            this._readFile();
        }
        
        for (let schedule in this.schedules){
            this.check(schedule);
        }
    }

    setSpec(spec, trigger){
        log(`Set ${spec} to ${trigger}`);
        this.schedules[spec] = this.parseTrigger(trigger);
    }

    oldCurrentTimeIs(minute) {
        let date = new Date();
        let time = date.getTime();
        let minuteStart = minute.getTime();
        return time > minuteStart && time < minuteStart + 60000;
    }

    currentTimeIs(time){
        let now = moment();
        let nowMinute = now.minute();
        let nowHour = now.hour();

        if (time.match && time.match(/^[0-9]+:[0-9]+$/)){
            let [a, h, m] = time.match(/([0-9]+):([0-9]+)/);
            return nowMinute == m && nowHour == h;
        }
        else {
            let then = moment(time);
            return nowMinute == then.minute() && nowHour == then.hour();
        }
    }

    async check(name, date){
        if (!date) date = new Date();
        let schedule = this.schedules[name];
        if (!schedule) {
            log(`Schedule ${schedule} not found.`);
            return;
        }

        let onActor = this.actors[name]['on'];
        if (onActor){
            let bulb = await this._getBulb(name);
            if (!bulb.state){
                //log(`Bulb ${name} is off so run its 'on' actor`);
                onActor(bulb);
            }
        }

        let offActor = this.actors[name]['off'];
        if (offActor){
            let bulb = await this._getBulb(name);
            if (bulb.state){
                //log(`Bulb ${name} is on so run its 'off' actor`);
                offActor(bulb);
            }
        }
    }

    getSchedules(){
        let schedules = {};
        for (let sched in this.schedules) {
            let spec = this.schedules[sched];
            let schedule = schedules[sched] = {};

            let on = spec.on;
            if (on) {
                schedule.on = {
                    spec: on,
                    date: format(Times.parse(on))
                }
            }

            let off = spec.off;
            if (off) {
                schedule.off = {
                    spec: off,
                    date: format(Times.parse(off))
                }
            }
        }

        return schedules;
    }

    specifiesCountdown(trigger){
        return trigger && trigger.match && trigger.match(/^[0-9]+$/);
    }

    parseTrigger(schedule, spec, trigger){
        let self = this;
        //log(`Adding trigger "${trigger}" for ${spec} for ${schedule}.`);
        if (this.specifiesCountdown(trigger)) {
            let key = `${schedule}_${spec}`;
            return async (bulb) => {
                if (spec == 'off'){
                    if (bulb.state){
                        if (self.timers[key] === undefined){
                            // Bulb is on but there's no timer; create it.
                            log(`Create timer for ${schedule} for ${trigger} minutes.`);
                            self.timers[key] = +trigger;
                        }
                        else if (self.timers[key] <= 0){
                            // Bulb is on and timer has reached zero; turn it off.
                            log(`Timer has reached zero. Time for shutoff!`);
                            delete self.timers[key];
                            return true;
                        }
                        else {
                            // Bulb is on and there's a timer; decrement it.
                            //log(`${self.timers[key]} minutes left until shutoff.`);
                            self.timers[key] = self.timers[key] - 1;
                        }
                    }
                    else {
                        if (self.timers[key]){
                            // Bulb is off and there's still a timer; clear it.
                            delete self.timers[key];
                        }
                        else {
                            // Bulb is off.
                        }
                    }
                }

                return false;
            };
        }

        if (/^(.+)\|(.+)$/.test(trigger)){
            let [m, first, second] = trigger.match(/^(.+)\|(.+)$/);
            let trigger1 = this.parseTrigger(schedule, spec, first.trim());
            let trigger2 = this.parseTrigger(schedule, spec, second.trim());
            return async (bulb) => {
                return (await trigger1(bulb)) || (await trigger2(bulb));
            }
        }

        if (/^(.+)&(.+)$/.test(trigger)){
            let [m, first, second] = trigger.match(/^(.+)&(.+)$/);
            let trigger1 = this.parseTrigger(schedule, spec, first.trim());
            let trigger2 = this.parseTrigger(schedule, spec, second.trim());
            return async (bulb) => {
                //log('test trigger ' + trigger);
                return (await trigger1(bulb)) && (await trigger2(bulb));
            }
        }
        
        if (/^!/.test(trigger)){
            let [m, func] = trigger.match(/^!(.+)$/);
            let trigFunc = this.parseTrigger(schedule, spec, func.trim());
            return async (bulb) => {
                //log('test trigger ' + trigger);
                return !(await trigFunc(bulb));
            }
        }

        if (/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(trigger)){
            return async (bulb) => {
                let res = await self._hostIsUp(trigger);
                //log('ping trigger gave ' + res);
                return res;
            }
        }

        let time = Times.parse(trigger);
        if (time) {
            log(`${schedule} will turn ${spec} today at ${format(time)}.`);
            return async () => {
                return self.currentTimeIs(time);
            }
        }

        throw 'Unknown trigger format: ' + trigger;
    }

    _readFile(){
        log(`Read file`);
        let self = this;
        function getActor(trigger, action, schedule, spec){
            return async (bulb) => {
                if (!self.schedules[schedule].overridden){
                    let res = await trigger(bulb);
                    if (res){ 
                        log(`Turn ${schedule} ${spec}.`);
                        action(schedule, `schedule (${spec})`);
                        delete self.timers[schedule];
                    }
                }
                //else log(`Skipping check for ${schedule} because it has been overridden.`);
            };
        }

        let file = JSON.parse(fs.readFileSync(this.file));
        this.reset = Times.parse(file.reset);
        this.schedules = file.schedules;
        this.actors = {};
        log('Schedule reset time is ' + format(this.reset));

        for (let sched in this.schedules){
            this.actors[sched] = {};
            for (let spec in this.schedules[sched]){
                //log('Consume trigger ' + sched + "/" + spec);
                let trigger = this.parseTrigger(sched, spec, this.schedules[sched][spec]);
                if (spec == 'off')
                    this.actors[sched][spec] = getActor(trigger, this._turnOff, sched, spec);
                else if (spec == 'on')
                    this.actors[sched][spec] = getActor(trigger, this._turnOn, sched, spec);
            }
        }
    }

    async _hostIsUp(host) {
        try {
            const { stdout, stderr } = await exec('ping -w 1 ' + host); 

            if (stderr) {
                //log("Failed to ping. " + stderr);
                return false;
            }
            else {
                let [m, num] = stdout.match(/([0-9]+) received/);
                if (num === undefined){
                    log("Cannot find packets received in output:");
                    log(stdout);
                }

                //log(num + ' packets received from ' + host);
                return num > 0;
            }
        }
        catch (e) {
            //log('Ping failed. ' + e);
            return false;
        }    
    }
}
