let format = require('./format.js'),
    moment = require('moment-timezone'),
    util = require('util'),
    exec = util.promisify(require('child_process').exec);
    fs = require('fs'),
    log = require('./log.js')('Scheduler'),
    Times = require('./sun_times.js');

module.exports = class Scheduler {
    constructor(file, devices){
        this.patterns = {
            '^([A-Za-z0-9_.]+) *(=|!=|<|>|<=|>=) *([A-Za-z0-9_.]+)$': this.createDeviceComparisonTrigger,
            '^~([0-9]+)$': this.createPowerCountdownTrigger,
            '^/([0-9]+)$': this.createCountdownTrigger,
            '^([^&]+)&([^&]+)$': this.createAndTrigger,
            '^([^&]+)&([^&]+)&([^&]+)$': this.createDoubleAndTrigger,
            '^([^\\|]+)\\|([^\\|]+)$': this.createOrTrigger,
            '^([^\\|]+)\\|([^\\|]+)\\|([^\\|]+)$': this.createDoubleOrTrigger,
            '^([A-Za-z0-9_]+)\\.([A-Za-z0-9_]+)([+-][0-9]+)?$': this.createDevicePropertyTrigger,
            '^!(.+)$': this.createNotTrigger,
            '^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$': this.createPingTrigger
        }

        this.file = file;
        this.devices = devices;
        this._turnOn = this.devices.on.bind(devices);
        this._turnOff = this.devices.off.bind(devices);
        this.timers = {};

        this._readFile();
        this.checkAll();
        setInterval(this.checkAll.bind(this), 60000);
    }

    async _getState() {
        let state = await this.devices.getState();
        let ret = state.bulbs;
        ret.housefan = state.housefan;
        ret.hvac = state.hvac;
        ret.alarm = state.alarm;
        ret.owner = {home: !state.away};
        ret.weather = state.weather;
        ret.garagedoor = state.garagedoor;
        log.debug(ret);
        return ret;
    };

    removeOverride(name){
        let sched = this.schedules[name];
        if (!sched){
            return;
        }

        sched.overridden = false;
        log.debug(`Overridden for ${name} is now ${sched.overridden}.`);
    }

    setOverride(name) {
        let sched = this.schedules[name];
        if (!sched){
            log.debug(`No override necessary for ${name}.`);
            return false;
        }

        log.debug(`Overriding ${name}: doNotOverride ${sched.doNotOverride}, overridden ${sched.overridden}.`);
        if (!sched.doNotOverride){
            log(`Overriding schedule for ${name}.`);
            sched.overridden = true;
        }

        log.debug(`Overridden for ${name} is now ${sched.overridden}.`);
        return true;
    }

    isOverridden(schedule){
        return this.schedules[schedule] && this.schedules[schedule].overridden;
    }

    async checkAll(){
        this.state = await this._getState();

        log.trace(this.state);

        if (this.currentTimeIs(this.reset)){
            this._readFile();
        }

        for (let schedule in this.schedules){
            await this.check(schedule);
        }
    }

    currentTimeIs(time){
        if (typeof time != 'string') {
            log.error('currentTimeIs needs a HH:mm time. Not ' + typeof time);
            log.error(time);
            return false;
        }

        let now = moment();
        let nowMinute = now.minute();
        let nowHour = now.hour();

        if (!time) {
            log.error('Cannot match time ' + time);
            return false;
        }

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
            log.info(`Schedule ${name} not found.`);
            return;
        }

        if (!this.actors[name])
            return;

        let device = this.state[name];
        if (!device){
            log.debug(`No device found: ${name}.`);
            return;
        }

        let onActor = this.actors[name]['on'];
        if (onActor){
            if (!device.on){
                log.debug(`Device ${name} is off so run its 'on' actor`);
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

                if (await onActor(device))
                    return;
            }
        }

        let offActor = this.actors[name]['off'];
        if (offActor){
            if (device.on){
                log.debug(`Device ${name} is on so run its 'off' actor`);
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

    async getSchedules(){
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

        let ranges = this.ranges;
        for (let r in ranges){
            if (ranges.hasOwnProperty(r)){
                ranges[r].active = this._rangeActive(r);
            }
        }

        return { schedules, ranges };
    }

    createPowerCountdownTrigger(schedule, spec, trigger, match){
        let [threshold] = match;
        let key = `${schedule}_${spec}`;
        log.debug(`Create power countdown trigger for ${schedule}/${spec}/${trigger}/${threshold}.`);
        return async (device) => {
            if (spec == 'off'){
                log.debug(`${schedule} device.power = ${device.power}`);
                if (device.power > threshold){
                    if (this.timers[key] === undefined){
                        // Device is on but there's no timer; create it.
                        log.debug(`Create timer for ${schedule} for ${time} minutes because device.power = ${device.power}.`);
                        this.timers[key] = +time;
                    }

                    if (this.timers[key] <= 0){
                        // Device is on and timer has reached zero; turn it off.
                        log(`Timer has reached zero. Time for shutoff!`);
                        delete this.timers[key];
                        return true;
                    }
                    
                    // Device is on and there's a timer; decrement it.
                    log.trace(`${this.timers[key]} minutes left until shutoff.`);
                    this.timers[key] = this.timers[key] - 1;
                }
                else {
                    if (this.timers[key]){
                        // Device is off and there's still a timer; clear it.
                        log.debug(`Removing unexpired timer for ${schedule}.`);
                        delete this.timers[key];
                    }
                    else {
                        // Device is off.
                    }
                }
            }

            return false;
        };
    }

    createCountdownTrigger(schedule, spec, trigger, match){
        let [time] = match;
        let key = `${schedule}_${spec}`;
        return async (device) => {
            if (spec == 'off'){
                //log.debug(`${schedule} device.power = ${device.power}`);
                if (device.on){
                    if (this.timers[key] === undefined){
                        // Device is on but there's no timer; create it.
                        log(`Create timer for ${schedule} for ${time} minutes because device is on.`);
                        this.timers[key] = +time;
                    }

                    if (this.timers[key] <= 0){
                        // Device is on and timer has reached zero; turn it off.
                        log(`Timer has reached zero. Time for shutoff!`);
                        delete this.timers[key];
                        return true;
                    }

                    // Device is on and there's a timer; decrement it.
                    log.trace(`${this.timers[key]} minutes left until shutoff.`);
                    this.timers[key] = this.timers[key] - 1;
                }
                else {
                    if (this.timers[key]){
                        // Device is off and there's still a timer; clear it.
                        log.debug(`Removing unexpired timer for ${schedule}.`);
                        delete this.timers[key];
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

    createDeviceComparisonTrigger(schedule, spec, trigger, match){
        let [first, op, second] = match;
        first = first.trim();
        second = second.trim();

        log.debug(`${schedule} will turn ${spec} when ${first} ${op} ${second}.`);
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

            log.trace(`${first} (${set1}) ${op} ${second} (${set2})`);
            if (res)
                log.debug(`Comparison passed: ${first} (${set1}) ${op} ${second} (${set2})`);

            return res;
        }
    }

    createOrTrigger(schedule, spec, trigger, match){
        let [first, second] = match;
        let trigger1 = this.parseTrigger(schedule, spec, first.trim());
        let trigger2 = this.parseTrigger(schedule, spec, second.trim());
        return async (device) => {
            let cond1 = await trigger1(device);
            if (cond1){
                log.debug(`|: Condition 1 (${first}) is ${cond1}`);
                return true;
            }

            let cond2 = await trigger2(device);
            if (cond2){
                return true;
            }

            log.debug(`|: Condition 1 (${first}) is ${cond1} and condition 2 (${second}) is ${cond2}.`);
            return false;
        }
    }

    createDoubleOrTrigger(schedule, spec, trigger, match){
        let [first, second, third] = match;
        let trigger1 = this.parseTrigger(schedule, spec, first.trim());
        let trigger2 = this.parseTrigger(schedule, spec, second.trim());
        let trigger3 = this.parseTrigger(schedule, spec, third.trim());
        return async (device) => {
            let cond1 = await trigger1(device);
            if (cond1){
                log.debug(`|: Condition 1 (${first}) is ${cond1}`);
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

            log.debug(`|: Condition 1 (${first}) is ${cond1} and condition 2 (${second}) is ${cond2}.`);
            return false;
        }
    }

    createAndTrigger(schedule, spec, trigger, match){
        let [first, second] = match;
        let trigger1 = this.parseTrigger(schedule, spec, first.trim());
        let trigger2 = this.parseTrigger(schedule, spec, second.trim());
        return async (device) => {
            let cond1 = await trigger1(device);
            if (!cond1) return false;
            let cond2 = await trigger2(device);
            if (!cond2) return false;
            log.debug(`&: Condition 1 (${first}) is ${cond1} and condition 2 (${second}) is ${cond2}.`);
            return true;
        }
    }

    createDoubleAndTrigger(schedule, spec, trigger, match){
        let [first, second, third] = match;
        let trigger1 = this.parseTrigger(schedule, spec, first.trim());
        let trigger2 = this.parseTrigger(schedule, spec, second.trim());
        let trigger3 = this.parseTrigger(schedule, spec, third.trim());
        return async (device) => {
            log.debug(`Running && for ${schedule}: ${trigger}.`);
            let cond1 = await trigger1(device);
            if (!cond1) { log.debug('cond1 is false'); return false; }
            let cond2 = await trigger2(device);
            if (!cond2) { log.debug('cond2 is false'); return false; }
            let cond3 = await trigger3(device);
            if (!cond3) { log.debug('cond3 is false'); return false; }
            log.debug(`&: Condition 1 (${first}) is ${cond1} and condition 2 (${second}) is ${cond2}.`);
            return true;
        }
    }

    createDevicePropertyTrigger(schedule, spec, trigger, match){
        log.debug(`${schedule} will turn ${spec} at ${trigger}`);
        return async (device) => {
            let val = this._getDeviceProp(trigger);
            if (!val) return false;

            if (val.toString().match(/[0-9]{2}:[0-9]{2}/)){
                log.debug(`Treating property trigger ${trigger} as time.`);
                return this.currentTimeIs(val);
            }

            return val;
        }
    }

    createNotTrigger(schedule, spec, trigger, params){
        let [func] = params;
        let trigFunc = this.parseTrigger(schedule, spec, func.trim());
        return async (device) => {
            return !(await trigFunc(device));
        }
    }

    createPingTrigger(schedule, spec, trigger){
        return async (device) => {
            let res = await this._hostIsUp(trigger);
            return res;
        }
    }

    _rangeActive(name){
        log.debug(`Check if range ${name} is active.`);
        let start = this._asTime(this.ranges[name].start);
        let end = this._asTime(this.ranges[name].end);
        if (!start || !end) 
            return false;

        let between = Times.isBetween(start, end);
        log.debug(`In range ${name}: ${between}`);
        return between;
    }

    parseTrigger(schedule, spec, trigger){
        log.debug(`Parse trigger ${schedule}/${spec}/${trigger}.`);
        for (let pattern in this.patterns){
            let re = new RegExp(pattern);
            if (!trigger) log.error('trigger is null: ' + trigger);
            let match = trigger.match(re);
            if (match){
                let handler = this.patterns[pattern];
                if (!handler) {
                    throw 'No handler found for pattern ' + pattern;
                }

                return handler.call(this, schedule, spec, trigger, match.splice(1));
            }
        }

        if (this.ranges && this.ranges.hasOwnProperty(trigger)){
            log.debug(`${trigger} is a range.`);
            return async (device) => {
                return this._rangeActive(trigger);
            }
        }

        /*if (!this.state){
            try { throw new Error() } catch (s) { log.error(s.stack) }
        }

        if (this.state.hasOwnProperty(trigger)){
            log.debug(`Trigger is a device: ${trigger}`);
            return async (device) => {
                let ret = this.state[trigger];
                if (!ret) log.error('Device is undefined? ' + trigger);
                return ret ? ret.on : undefined;
            };
        }*/

        log.debug(`Parsing ${schedule} as time.`);
        let time = Times.toHoursAndMinutes(trigger);
        if (time) {
            log.debug(`${schedule} will turn ${spec} today at ${time}.`);
            return async () => {
                return this.currentTimeIs(time);
            }
        }

        if (/^[A-Za-z0-9_]+$/.test(trigger)){
            return async (device) => {
                if (/^[0-9]+$/.test(trigger)){
                    return +trigger;
                }
                else {
                    let res = this.state[trigger];
                    return res ? res.on : undefined;
                }
            }
        }

        throw 'Unknown trigger format: ' + trigger;
    }

    _getDeviceProp(prop){
        if (!prop) log.error('prop is null: ' + prop);
        let [_, obj, key, adj] = prop.match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)([+-][0-9]+)?$/);
        let dev = this.state[obj];
        if (!dev) {
            log.error(`Unknown device ${obj}.`);
            return undefined;
        }

        let val = dev[key.trim()]; 
        if (val === undefined){
            log.error(`Property ${key} not found on ${obj}. ${JSON.stringify(dev)}`);
            return false;
        }

        log.debug(`${obj}.${key} = ${val}`);
        if (val === 'false' || !val){
            return false;
        }

        let maybeTime = Times.toHoursAndMinutes(val + (adj || ''));
        if (maybeTime) 
            return maybeTime;

        if (adj){
            let adjNum = +adj.replace(/[^0-9]/g, '');
            if (adj.startsWith('-')) adjNum = -adjNum;
            val = val + adjNum;
        }

        return val;
    }

    _asTime(prop){
       if (!prop) log.error('prop is null: ' + prop);
       let match = prop.match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)([+-][0-9]+)?( *\| *[0-9]{2}:[0-9]{2})?$/);
       if (match){
            let [_, obj, key, adj, def] = match;
            let val = this._getDeviceProp(`${obj}.${key}${adj || ''}`);
            if (!val){ 
                if (def){
                    def = def.replace(/[^0-9:]/g, '');
                    if (!/^[0-9]{2}:[0-9]{2}$/.test(def)){
                        log.error(`Default value of ${def} is not a time.`);
                    }

                    log.debug(`Return default time ${def} for ${prop}`);
                    return def;
                }

                return false;
            }

            if (!/[0-9]{2}:[0-9]{2}/.test(val)){
                log.error(`Return value of ${dev}.${prop} is not a time: ${val}`);
                return undefined;
            }

            log.debug(`Convert ${val} to hours/minutes format. ${Times.toHoursAndMinutes(val)}`);
            return Times.toHoursAndMinutes(val);
        }
        else {
            log.debug(`Convert spec ${prop} to hours/minutes format. ${Times.toHoursAndMinutes(prop)}`);
            return Times.toHoursAndMinutes(prop);
        }
    }

    _readFile(){
        log(`Read file.`);
        let file = JSON.parse(fs.readFileSync(this.file));
        this.reset = Times.toHoursAndMinutes(file.reset);
        this.schedules = file.schedules;
        this.ranges = file.ranges;
        this.actors = {};
        log('Schedule reset time is ' + this.reset);

        for (let schedule in this.schedules){
            this.actors[schedule] = {};
            for (let spec in this.schedules[schedule]){
                this.setTrigger(schedule, spec, this.schedules[schedule][spec]);
            }
        }
    }

    setTrigger(schedule, spec, trigger){
        log.debug(`Set ${schedule}/${spec} to ${trigger}`);
        let action, triggerFunc = this.parseTrigger(schedule, spec, trigger);
        if (spec == 'on'){
            action = async () => {
                await this._turnOn(schedule, `schedule (${spec})`);
                this.state[schedule].on = true;
            }
        }
        else if (spec == 'off'){
            action = async () => {
                await this._turnOff(schedule, `schedule (${spec})`);
                this.state[schedule].on = false;
            }
        }

        this.actors[schedule][spec] = async (device) => {
            if (!this.schedules[schedule].overridden){
                if (await triggerFunc(device)){ 
                    log(`Turn ${schedule} ${spec} for trigger: ${trigger}.`);
                    await action(schedule, `schedule (${spec})`);
                    delete this.timers[`${schedule}_${spec}`];
                    return true;
                }
            }
            else log.debug(`Skipping check for ${schedule} because it has been overridden.`);
        };
    }

    async _hostIsUp(host) {
        try {
            const { stdout, stderr } = await exec('ping -w 1 ' + host); 

            if (stderr) {
                log.debug("Failed to ping. " + stderr);
                return false;
            }
            else {
                let [m, num] = stdout.match(/([0-9]+) received/);
                if (num === undefined){
                    log.error("Cannot find packets received in output:");
                    log(stdout);
                }

                //log(num + ' packets received from ' + host);
                return num > 0;
            }
        }
        catch (e) {
            log.debug('Ping failed. ' + e);
            return false;
        }    
    }
}
