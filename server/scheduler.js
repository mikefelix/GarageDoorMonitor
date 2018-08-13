let format = require('./format.js'),
    moment = require('moment-timezone'),
    util = require('util'),
    exec = util.promisify(require('child_process').exec);
    fs = require('fs'),
    log = require('./log.js')('Scheduler'),
    Times = require('./sun_times.js');

module.exports = class Scheduler {
    constructor(file, getState, turnOn, turnOff, refresh){
        this.file = file;
        this._getState = async () => {
            let state = await getState();
            state.bulbs.housefan = state.housefan;
            state.bulbs.hvac = state.hvac;
            return state.bulbs;
        };
        this._turnOn = turnOn;
        this._turnOff = turnOff;
        this._readFile();
        this.timers = {};
        this.checks = {};
        this.checkAll();
        setInterval(this.checkAll.bind(this), 60000);
    }

    toggleOverride(name) {
        let sched = this.schedules[name];
        if (!sched)
            this.schedules[name] = sched = {overrideable: true};

        if (sched.overrideable){
            log(`Overriding schedule for ${name}.`);
            sched.overridden = !sched.overridden;
        }
    }

    isOverridden(schedule){
        return this.schedules[schedule] && this.schedules[schedule].overridden;
    }

    async checkAll(){
        this.devices = await this._getState();

        //log(this.devices);

        if (this.currentTimeIs(this.reset)){
            this._readFile();
        }

        for (let schedule in this.schedules){
            await this.check(schedule);
        }
    }

    setSpec(spec, trigger){
        log(`Set ${spec} to ${trigger}`);
        this.schedules[spec] = this.parseTrigger(trigger);
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
            log(`Schedule ${name} not found.`);
            return;
        }

        if (!this.actors[name])
            return;

        let device = this.devices[name];
        if (!device){
            //log(`No device found: ${name}.`);
            return;
        }

        if (this.checks[name]){
            await this.checks[name](device);
        }

        let onActor = this.actors[name]['on'];
        if (onActor){
            if (!device.on){
                //log(`Device ${name} is off so run its 'on' actor`);
                if (schedule.delay){
                    if (schedule.delaying === undefined){
                        schedule.delaying = schedule.delay;
                    }
                    
                    if (schedule.delaying > 0){
                        schedule.delaying--;
                        return;
                    }
                    else {
                        delete schedule.delaying;
                    }
                }

                await onActor(device);
            }
        }

        let offActor = this.actors[name]['off'];
        if (offActor){
            if (device.on){
                //log(`Device ${name} is on so run its 'off' actor`);
                if (schedule.delay){
                    if (schedule.delaying === undefined){
                        schedule.delaying = schedule.delay;
                    }
                    
                    if (schedule.delaying > 0){
                        schedule.delaying--;
                        return;
                    }
                    else {
                        delete schedule.delaying;
                    }
                }

                await offActor(device);
            }
        }
    }

    getSchedules(){
        let schedules = {};
        for (let sched in this.schedules) {
            let spec = this.schedules[sched];
            if (spec){
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
        }

        return schedules;
    }

    specifiesCountdownTrigger(trigger){
        return /^[0-9]+$/.test(trigger);
    }

    specifiesPowerCountdownTrigger(trigger){
        return /^~[0-9]+$/.test(trigger);
    }
    
    specifiesDeviceComparisonTrigger(trigger){
        return /^[A-Za-z0-9_.]+ *(=|!=|<|>|<=|>=) *[A-Za-z0-9_.]+$/.test(trigger);
    }

    createPowerCountdownTrigger(schedule, spec, trigger, threshold){
        let self = this;
        let key = `${schedule}_${spec}`;
        return async (device) => {
            if (spec == 'off'){
                //log(`${schedule} device.power = ${device.power}`);
                let time = trigger.replace(/~/, '');
                if (device.power > threshold){
                    if (self.timers[key] === undefined){
                        // Device is on but there's no timer; create it.
                        log(`Create timer for ${schedule} for ${time} minutes because ${'device.power = ' + device.power}.`);
                        self.timers[key] = +time;
                        /*self.checks[key] = (checkingBulb) => {
                            if (checkingBulb && checkingBulb.power < threshold){
                                log(`Removing timer for ${key}.`);
                                delete self.timers[key];
                                delete self.checks[key];
                            }
                        }*/
                    }

                    if (self.timers[key] <= 0){
                        // Device is on and timer has reached zero; turn it off.
                        log(`Timer has reached zero. Time for shutoff!`);
                        delete self.timers[key];
                        return true;
                    }
                    
                    // Device is on and there's a timer; decrement it.
                    //log(`${self.timers[key]} minutes left until shutoff.`);
                    self.timers[key] = self.timers[key] - 1;
                }
                else {
                    if (self.timers[key]){
                        // Device is off and there's still a timer; clear it.
                        log(`Removing unexpired timer for ${schedule}.`);
                        delete self.timers[key];
                    }
                    else {
                        // Device is off.
                    }
                }
            }

            return false;
        };
    }

    createCountdownTrigger(schedule, spec, trigger){
        let self = this;
        let key = `${schedule}_${spec}`;
        return async (device) => {
            if (spec == 'off'){
                //log(`${schedule} device.power = ${device.power}`);
                let time = trigger.replace(/~/, '');
                let enact = /^~/.test(trigger) ? device.power > 9 : device.on;
                if (enact){
                    if (self.timers[key] === undefined){
                        // Device is on but there's no timer; create it.
                        log(`Create timer for ${schedule} for ${time} minutes because ${/^~/.test(trigger) ? 'device.power = ' + device.power : 'device is on'}`);
                        self.timers[key] = +time;
                    }

                    if (self.timers[key] <= 0){
                        // Device is on and timer has reached zero; turn it off.
                        log(`Timer has reached zero. Time for shutoff!`);
                        delete self.timers[key];
                        return true;
                    }

                    // Device is on and there's a timer; decrement it.
                    //log(`${self.timers[key]} minutes left until shutoff.`);
                    self.timers[key] = self.timers[key] - 1;
                }
                else {
                    if (self.timers[key]){
                        // Device is off and there's still a timer; clear it.
                        log(`Removing unexpired timer for ${schedule}.`);
                        delete self.timers[key];
                    }
                    else {
                        // Device is off.
                    }
                }
            } 
            else {
                return false;
            }
        };
    }

    createDeviceComparisonTrigger(schedule, spec, trigger){
        let [m, first, op, second] = trigger.match(/^([A-Za-z0-9_.]+) *(=|!=|<|>|<=|>=) *([A-Za-z0-9_.]+)$/);
        first = first.trim();
        second = second.trim();

        log(`${schedule} will turn ${spec} when ${first} ${op} ${second}.`);
        return async (device) => {
            let trigger1 = this.parseTrigger(schedule, spec, first);
            let trigger2 = this.parseTrigger(schedule, spec, second);
            let set1 = await trigger1(device);
            let set2 = await trigger2(device);

            let res; 
            if (op == '=')
                res = set1 == set2;
            else if (op == '!=')
                res = set1 != set2;
            else if (op == '<')
                res = set1 < set2;
            else if (op == '>')
                res = set1 > set2;
            else if (op == '<=')
                res = set1 <= set2;
            else if (op == '>=')
                res = set1 >= set2;

            //log(`${first} (${set1}) ${op} ${second} (${set2})`);
            return res;
        }
    }

    parseTrigger(schedule, spec, trigger){
        let self = this;
        if (this.specifiesPowerCountdownTrigger(trigger)) 
            return this.createPowerCountdownTrigger(schedule, spec, trigger, 7);

        if (this.specifiesCountdownTrigger(trigger)) 
            return this.createCountdownTrigger(schedule, spec, trigger);

        if (this.specifiesDeviceComparisonTrigger(trigger))
            return this.createDeviceComparisonTrigger(schedule, spec, trigger);

        if (/^(.+)\|(.+)$/.test(trigger)){
            let [m, first, second] = trigger.match(/^(.+)\|(.+)$/);
            let trigger1 = this.parseTrigger(schedule, spec, first.trim());
            let trigger2 = this.parseTrigger(schedule, spec, second.trim());
            return async (device) => {
                //log(`run trigger ${trigger}`);
                let cond1 = await trigger1(device);
                if (cond1){
                    //log(`|: Condition 1 (${first}) is ${cond1}`);
                    return true;
                }

                let cond2 = await trigger2(device);
                if (cond2){
                    return true;
                }

                //log(`|: Condition 1 (${first}) is ${cond1} and condition 2 (${second}) is ${cond2}.`);
                return false;
            }
        }

        if (/^(.+)\|(.+)\|(.+)$/.test(trigger)){
            let [m, first, second, third] = trigger.match(/^(.+)\|(.+)\|(.+)$/);
            let trigger1 = this.parseTrigger(schedule, spec, first.trim());
            let trigger2 = this.parseTrigger(schedule, spec, second.trim());
            let trigger3 = this.parseTrigger(schedule, spec, third.trim());
            return async (device) => {
                //log(`run trigger ${trigger}`);
                let cond1 = await trigger1(device);
                if (cond1){
                    //log(`|: Condition 1 (${first}) is ${cond1}`);
                    return true;
                }

                let cond2 = await trigger2(device);
                if (cond2){
                    return true;
                }

                let cond3 = await trigger3(device);
                if (cond3){
                    return true;
                }

                //log(`|: Condition 1 (${first}) is ${cond1} and condition 2 (${second}) is ${cond2}.`);
                return false;
            }
        }

        if (/^(.+)&(.+)$/.test(trigger)){
            let [m, first, second] = trigger.match(/^(.+)&(.+)$/);
            let trigger1 = this.parseTrigger(schedule, spec, first.trim());
            let trigger2 = this.parseTrigger(schedule, spec, second.trim());
            return async (device) => {
                //log(`run trigger ${trigger}`);
                let cond1 = await trigger1(device);
                if (!cond1) return false;
                let cond2 = await trigger2(device);
                if (!cond2) return false;
                //log(`&: Condition 1 (${first}) is ${cond1} and condition 2 (${second}) is ${cond2}.`);
                return true;
            }
        }
        
        if (/^(.+)&(.+)&(.+)$/.test(trigger)){
            let [m, first, second, third] = trigger.match(/^(.+)&(.+)&(.+)$/);
            let trigger1 = this.parseTrigger(schedule, spec, first.trim());
            let trigger2 = this.parseTrigger(schedule, spec, second.trim());
            let trigger3 = this.parseTrigger(schedule, spec, third.trim());
            return async (device) => {
                //log(`run trigger ${trigger}`);
                let cond1 = await trigger1(device);
                if (!cond1) return false;
                let cond2 = await trigger2(device);
                if (!cond2) return false;
                let cond3 = await trigger3(device);
                if (!cond3) return false;
                //log(`&: Condition 1 (${first}) is ${cond1} and condition 2 (${second}) is ${cond2}.`);
                return true;
            }
        }
        
        if (/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(trigger)){
            let [m, obj, key] = trigger.match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/);
            return async (device) => {
                let res = self.devices[obj.trim()];
                if (!res) {
                    log(`Unknown device ${obj.trim()}.`);
                    return undefined;
                }

                let val = res[key.trim()]; 

                //log(`${obj}.${key} = ${val}`);
                return val;
            }
        }

        if (/^!/.test(trigger)){
            let [m, func] = trigger.match(/^!(.+)$/);
            let trigFunc = this.parseTrigger(schedule, spec, func.trim());
            return async (device) => {
                //log('test trigger ' + trigger);
                return !(await trigFunc(device));
            }
        }

        if (/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(trigger)){
            return async (device) => {
                let res = await self._hostIsUp(trigger);
                //log('ping trigger gave ' + res);
                return res;
            }
        }

        if (self.ranges && self.ranges.hasOwnProperty(trigger)){
            return async (device) => {
                let time = moment();
                let start = Times.parse(self.ranges[trigger].start);
                let end = Times.parse(self.ranges[trigger].end);
                //log(`isAfter(${start}) ${time.isAfter(start)}`);
                //log(`isBefore(${end}) ${time.isBefore(end)}`);
                return time.isAfter(start) && time.isBefore(end);
            }
        }

        //log(`Parsing ${schedule} as time.`);
        let time = Times.parse(trigger);
        if (time) {
            log(`${schedule} will turn ${spec} today at ${format(time)}.`);
            return async () => {
                return self.currentTimeIs(time);
            }
        }

        /*
        //TODO: generalize
        if (trigger == 'temp_at_target'){
            log(`${schedule} will turn ${spec} when therm is at target.`);
            return async (device) => {
                let therm = await self._getDevice('therm');
                return therm && !therm.on && therm.temp == therm.target;
            }
        }
        */

        if (/^[A-Za-z0-9_]+$/.test(trigger)){
            log(`${schedule} will turn ${spec} with ${trigger}.`);
            return async (device) => {
                let res = self.devices[trigger];
                return res ? res.on : undefined;
            }
        }

        throw 'Unknown trigger format: ' + trigger;
    }

    _readFile(){
        log(`Read file`);
        let self = this;
        function getActor(trigger, action, schedule, spec){
            return async (device) => {
                if (!self.schedules[schedule].overridden){
                    let res = await trigger(device);
                    if (res){ 
                        log(`Turn ${schedule} ${spec}.`);
                        await action(schedule, `schedule (${spec})`);
                        delete self.timers[`${schedule}_${spec}`];
                    }
                }
                //else log(`Skipping check for ${schedule} because it has been overridden.`);
            };
        }

        let file = JSON.parse(fs.readFileSync(this.file));
        this.reset = Times.parse(file.reset);
        this.schedules = file.schedules;
        this.ranges = file.ranges;
        this.actors = {};
        log('Schedule reset time is ' + format(this.reset));

        for (let schedule in this.schedules){
            this.actors[schedule] = {};
            for (let spec in this.schedules[schedule]){
                let action, trigger = this.parseTrigger(schedule, spec, this.schedules[schedule][spec]);
                if (spec == 'on'){
                    action = async () => {
                        await this._turnOn(schedule, `schedule (${spec})`);
                        this.devices[schedule].on = true;
                    }
                }
                else if (spec == 'off'){
                    action = async () => {
                        await this._turnOff(schedule, `schedule (${spec})`);
                        this.devices[schedule].on = false;
                    }
                }

                this.actors[schedule][spec] = getActor(trigger, action, schedule, spec);
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
