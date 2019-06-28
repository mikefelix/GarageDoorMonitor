let format = require('./format.js'),
    moment = require('moment-timezone'),
    util = require('util'),
    exec = util.promisify(require('child_process').exec);
    fs = require('fs'),
    log = require('./log.js')('Scheduler'),
    redis = require('redis').createClient(),
    rget = util.promisify(redis.get).bind(redis),
    rset = redis.set.bind(redis),
    rdel = redis.del.bind(redis),
    Times = require('./times.js');

function debug(section, msg){
    //if (!section || section == 'office')
        log.debug(msg);
}

module.exports = class Scheduler {
    constructor(file, devices){
        this.patterns = {
            '^([^&]+)&([^&]+)$': this.createAndTrigger,
            '^([^&]+)&([^&]+)&([^&]+)$': this.createDoubleAndTrigger,
            '^([^\\|]+)\\|([^\\|]+)$': this.createOrTrigger,
            '^([^\\|]+)\\|([^\\|]+)\\|([^\\|]+)$': this.createDoubleOrTrigger,
            '^([^\\|]+)\\|([^\\|]+)\\|([^\\|]+)\\|([^\\|]+)$': this.createTripleOrTrigger,
            '^([A-Za-z0-9_.]+) *(=|!=|<|>|<=|>=) *([A-Za-z0-9_.]+)$': this.createDeviceComparisonTrigger,
            '^([A-Za-z0-9_]+)\\.([A-Za-z0-9_]+)([+-][0-9]+)?$': this.createDevicePropertyTrigger,
            '^([0-9]+)~([0-9]+)$': this.createPowerCountdownTrigger,
            '^([A-Za-z0-9_.!+-]*)/([0-9]+)$': this.createCountdownTrigger,
            '^!(.+)$': this.createNotTrigger,
            '^@([0-9]+)$': this.createPeriodicTrigger
        }

        redis.on('error', (err) => { console.log('Something went wrong with redis: ' + err); });
        redis.on('connect', () => { 
            log.info('Redis connected.'); 
            //rdel('timer:tessel');
        });

        this.file = file;
        this.devices = devices;
        this.history = {};

        this._readFile();
        this.checkAll();
        setInterval(this.checkAll.bind(this), 60000);
    }

    async record(schedule, turnedOn, reason, setOverride){
        let action = turnedOn ? 'on' : 'off'
            
        if (setOverride)
            await this.setOverride(schedule);

        let hist = this.history[schedule];
        if (!hist) hist = this.history[schedule] = {};

        let time = Times.get(true).current;
        let text = `@${time} for reason: ${reason}`;

        log.debug(`Adding history for ${schedule}/${action} at ${time}: ${reason}.`);
        hist[action] = text;
        log.debug(this.history);
    }

    async on(schedule, reason){
        let success = await this.devices.on(schedule, reason);
        if (success) {
            this.record(schedule, true, reason);
            (await this.getState(schedule)).on = true;
        }

        return success;
    }

    async off(schedule, reason){
        let success = await this.devices.off(schedule, reason);
        if (success) {
            this.record(schedule, false, reason);
            (await this.getState(schedule)).on = false;
        }

        return success;
    }

    async getState(name) {
        if (this.state && this.state[name]){
            debug(name, `Get state for ${name} was cached:`);
            debug(name, this.state[name]);
            return this.state[name];
        }
        
        try {
            let state = await this.devices.getState(name);
            debug(name, `Get state for ${name} got:`);
            debug(name, state);

            if (!state){
                log.error(`No state returned for ${name}.`);
                return;
            }

            state.schedule = this.getSchedule(name);
            state.overridden = await this.isOverridden(name);
            state.history = this.history[name];

            if (this.state){
                this.state[name] = state;
            }

            return state;
        }
        catch (e){
            log.error(`Error getting state for devices. ${e}`);
            log.error(e.stack);
        }
    };

    async removeOverride(name){
        let sched = this.schedules[name];
        if (!sched){
            return;
        }

        await rdel('override:' + name);
        debug(name, `Override for ${name} removed.`);
    }

    async toggleOverride(name){
        if (await this.isOverridden(name)){
            await this.removeOverride(name);
        }
        else {
            await this.setOverride(name);
        }
    }

    async setOverride(name) {
        let sched = this.schedules[name];
        if (!sched){
            debug(name, `No override necessary for ${name}.`);
            return false;
        }

        if (sched.override === undefined){
            sched.override = true;
        }

        if (sched.override === false){
            debug(name, `${name} is not overridable.`);
        }
        else if (sched.override === true){
            log.info(`Overriding schedule for ${name}.`);
            await rset('override:' + name, 'all');
        }
        else {
            log.info(`Overriding ${sched.override} for ${name}.`);
            await rset('override:' + name, sched.override);
        }

        return true;
    }

    async isOverridden(schedule, spec){
        let ov = await rget('override:' + schedule);
        if (!ov) return false;
        return ov == 'all' || (spec && ov.split(',').indexOf(spec) >= 0);
    }

    async checkAll(){
        let minute = Times.getHM.current();
        this.state = {};

        if (minute == this.reset){
            this._readFile();
        }

        for (let schedule in this.schedules){
            if (!this.schedules[schedule].disabled)
                await this.check(schedule, minute);
        }

        delete this.state;
    }

    async check(schedule, minute, checkState){
        debug(schedule, `Check ${schedule} at ${minute}.`);
        let device = await this.getState(schedule);
        if (!device){
            debug(schedule, `No state for device found: ${schedule}.`);
            return;
        }

        await this.adjustUptime(schedule, device);
        await this.handleTimer(schedule, device);

        if (!this.actors[schedule]){
            debug(schedule, `No actors for ${schedule}.`);
            return;
        }

        if (device.on){
            debug(schedule, `Device ${schedule} is on so run its 'off' actor`);
            let offActor = this.actors[schedule].off;
            if (offActor)
                await offActor(device);
        }
        else {
            debug(schedule, `Device ${schedule} is off so run its 'on' actor`);
            let onActor = this.actors[schedule].on;
            if (onActor)
                await onActor(device);
        }
    }

    async adjustUptime(schedule, device){
        let key = 'up:' + schedule;
        let upTime = await rget(key);
        if (device.on && (upTime === null || upTime === undefined)){
            rset(key, 0);
        }
        else if (device.on){
            rset(key, +upTime + 1);
        }
        else {
            rdel(key);
        }
    }

    async handleTimer(schedule, device){
        let timer = await rget('timer:' + schedule);
        if (timer){
            debug(schedule, `Found a timer for ${schedule}: ${timer}.`);
            let [spec, min] = timer.split('=');
            if (Times.currentTimeAtOrAfter(min)){
                log.trace(`Timer is elasped!`);
                if (spec == 'on') {
                    if (!device.on){
                        log.info(`Timer is turning ${schedule} on.`);
                        await this.on(schedule, 'timer elapsed');
                        (await this.getState(schedule)).on = true;
                    }
                    else debug(schedule, `A timer for ${schedule} ${spec} expired but it is already ${spec}.`);
                }
                else if (spec == 'off') {
                    if (device.on){
                        log.info(`Timer is turning ${schedule} off.`);
                        await this.off(schedule, 'timer elapsed');
                        (await this.getState(schedule)).on = false;
                    }
                    else debug(schedule, `A timer for ${schedule} ${spec} expired but it is already ${spec}.`);
                }

                rdel('timer:' + schedule);
            }
            else {
                log.trace(`Timer has not elapsed.`);
            }
        }
    }

    getSchedule(name){
        return this.schedules[name];
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

                let upTime = await rget('up:' + sched);
                if (upTime){
                    schedule.upTime = upTime;
                }

                let timer = await rget('timer:' + sched);
                if (timer){
                    schedule.timer = timer;
                }
            }
        }

        let ranges = this.ranges;
        for (let r in ranges){
            if (ranges.hasOwnProperty(r)){
                ranges[r].active = await this.rangeActive(r);
            }
        }

        return { schedules, ranges };
    }

    createPowerCountdownTrigger(schedule, spec, trigger, match){
        let [threshold, time] = match;
        debug(`schedule, Create power countdown trigger for ${schedule}/${spec}/${trigger}/${threshold}/${time}.`);
        return async (device) => {
            if (device.power > threshold){
                if (await rget('timer:' + schedule)){
                    debug(`schedule, There is already a timer running for ${schedule}.`);
                }
                else {
                    let minute = Times.getHM.minutesFromNow(time);
                    log.info(`Creating ${spec} timer for ${time} minutes from now (${minute}) for ${schedule} because its power is ${device.power} which is greater than ${threshold}.`);
                    rset(`timer:${schedule}`, `${spec}=${minute}`);
                }
            }

            return false;
        };
    }

    createPeriodicTrigger(schedule, spec, trigger, match){
        let [period] = match;
        log.info(`Create periodic timer for ${schedule} for ${period}.`);
        return async (device) => {
            let timer = await rget('timer:' + schedule);
            if (!timer || Times.currentTimeAtOrAfter(timer)){
                let time = Times.getHM.minutesFromNow(period);
                log.info(`Next activation of ${schedule} will be at ${time}.`);
                rset('timer:' + schedule, time);
                return true;
            }
            else {
                log.info(`Not activating ${schedule}.`);
                return false;
            }
        };
    }

    createCountdownTrigger(schedule, spec, trigger, match){
        let [condition, time] = match;
        let condTrig = condition ?
            this.parseTrigger(schedule, spec, condition) :
            async () => true;

        return async (device) => {
            if ((spec == 'on' && !device.on) || (spec == 'off' && device.on)){ 
                let met = !condition || await condTrig(device);
                if (met){
                    if (await rget('timer:' + schedule)){
                        debug(`schedule, There is already a timer running for ${schedule}.`);
                    }
                    else {
                        let minute = Times.getHM.minutesFromNow(time);
                        log.info(`Creating ${spec} timer for ${time} minutes from now (${minute}) for ${schedule} because it is ${device.on ? 'on' : 'off'}${condition ? ' and condition ' + condition + ' is met' : ''}.`);
                        rset(`timer:${schedule}`, `${spec}=${minute}`);
                    }
                }

                return false;
            }
        };
    }

    createDeviceComparisonTrigger(schedule, spec, trigger, match){
        let [first, op, second] = match;
        first = first.trim();
        second = second.trim();

        debug(`schedule, ${schedule} will turn ${spec} when ${first} ${op} ${second}.`);
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

            debug(`schedule, ${first} (${set1}) ${op} ${second} (${set2})`);
            if (res)
                debug(`schedule, ${schedule}/${spec} Comparison passed: ${first} (${set1}) ${op} ${second} (${set2})`);

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
                debug(`schedule, ${schedule}/${spec} |: Condition 1 (${first}) is ${cond1}`);
                return true;
            }

            let cond2 = await trigger2(device);
            if (cond2){
                return true;
            }

            debug(`schedule, ${schedule}/${spec} |: Condition 1 (${first}) is ${cond1} and condition 2 (${second}) is ${cond2}.`);
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
                debug(`schedule, ${schedule}/${spec} |: Condition 1 (${first}) is ${cond1}`);
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

            debug(`schedule, ${schedule}/${spec} |: Condition 1 (${first}) is ${cond1} and condition 2 (${second}) is ${cond2}.`);
            return false;
        }
    }

    createTripleOrTrigger(schedule, spec, trigger, match){
        let [first, second, third, fourth] = match;
        let trigger1 = this.parseTrigger(schedule, spec, first.trim());
        let trigger2 = this.parseTrigger(schedule, spec, second.trim());
        let trigger3 = this.parseTrigger(schedule, spec, third.trim());
        let trigger4 = this.parseTrigger(schedule, spec, fourth.trim());
        return async (device) => {
            let cond1 = await trigger1(device);
            if (cond1){
                debug(`schedule, ${schedule}/${spec} |: Condition 1 (${first}) is true.`);
                return true;
            }

            let cond2 = await trigger2(device);
            if (cond2){
                debug(`schedule, ${schedule}/${spec} |: Condition 2 (${second}) is true.`);
                return true;
            }

            let cond3 = await trigger3(device);
            if (cond3){
                debug(`schedule, ${schedule}/${spec} |: Condition 3 (${third}) is true.`);
                return true;
            }

            let cond4 = await trigger4(device);
            if (cond4){
                debug(`schedule, ${schedule}/${spec} |: Condition 4 (${fourth}) is true.`);
                return true;
            }

            debug(`schedule, ${schedule}/${spec} |: Condition 1 (${first}) is ${cond1}; condition 2 (${second}) is ${cond2}; condition 3 (${third}) is ${cond3}; condition 4 (${fourth}) is ${cond4}.`);
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
            debug(`schedule, ${schedule}/${spec} &: Condition 1 (${first}) is ${cond1} and condition 2 (${second}) is ${cond2}.`);
            return true;
        }
    }

    createDoubleAndTrigger(schedule, spec, trigger, match){
        let [first, second, third] = match;
        let trigger1 = this.parseTrigger(schedule, spec, first.trim());
        let trigger2 = this.parseTrigger(schedule, spec, second.trim());
        let trigger3 = this.parseTrigger(schedule, spec, third.trim());
        return async (device) => {
            debug(`schedule, Running && for ${schedule}: ${trigger}.`);
            let cond1 = await trigger1(device);
            if (!cond1) { debug(schedule, 'cond1 is false'); return false; }
            let cond2 = await trigger2(device);
            if (!cond2) { debug(schedule, 'cond2 is false'); return false; }
            let cond3 = await trigger3(device);
            if (!cond3) { debug(schedule, 'cond3 is false'); return false; }
            debug(schedule, `${schedule}/${spec} &: Condition 1 (${first}) is ${cond1} and condition 2 (${second}) is ${cond2}.`);
            return true;
        }
    }

    createDevicePropertyTrigger(schedule, spec, trigger, match){
        debug(schedule, `${schedule} will turn ${spec} at ${trigger}`);
        return async () => {
            let val = await this.getProp(trigger);
            debug(schedule, `Prop ${trigger} during check of ${schedule} is ${val}.`);
            if (!val) return val;

            if (val.toString().match(/[0-9]{2}:[0-9]{2}/)){
                debug(schedule, `Treating property trigger ${trigger} as time.`);
                return Times.currentTimeIs(val);
            }

            debug(schedule, `${schedule}: trigger ${trigger} produces ${val}.`);
            return val;
        }
    }

    createNotTrigger(schedule, spec, trigger, params){
        let [func] = params;
        let trigFunc = this.parseTrigger(schedule, spec, func.trim());
        return async (device) => {
            let res = await trigFunc(device);
            debug(schedule, `${schedule}: trigger ${trigger} produces ${res === false}.`);
            return res === false;
        }
    }

    async rangeActive(name){
        debug(name, `Check if range ${name} is active.`);
        let start = await this.asTime(this.ranges[name].start);
        let end = await this.asTime(this.ranges[name].end);
        if (!start || !end) 
            return false;

        let between = Times.isBetween(start, end);
        return between;
    }

    parseTrigger(schedule, spec, trigger){
        debug(schedule, `Parse trigger ${schedule}/${spec}/${trigger}.`);
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
            debug(schedule, `${trigger} is a range.`);
            return async () => {
                return this.rangeActive(trigger);
            }
        }

        if (this.aliases && this.aliases.hasOwnProperty(trigger)){
            debug(schedule, `${trigger} is an alias.`);
            return this.parseTrigger(schedule, spec, this.aliases[trigger]);
        }

        let time = Times.toHM(trigger);
        if (time) {
            log.info(`${schedule} will turn ${spec} today at ${time}.`);
            return async () => {
                let match = Times.currentTimeIs(time);
                debug(schedule, `${schedule}: current time is ${match ? '' : ' not'} ${time}.`);
                return match;
            }
        }

        if (/^[A-Za-z0-9_]+$/.test(trigger)){
            return async () => {
                if (/^[0-9]+$/.test(trigger)){
                    return +trigger;
                }
                else {
                    let res = await this.getState(trigger);
                    debug(schedule, `${schedule}: checking device for trigger ${trigger}. ${res ? res.on : undefined}`);
                    return res ? res.on : undefined;
                }
            }
        }

        throw 'Unknown trigger format: ' + trigger;
    }

    async getProp(prop){
        if (!prop) log.error('prop is null: ' + prop);
        let [_, obj, key, adj] = prop.match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)([+-][0-9]+)?$/);
        key = key.trim();

        if (key == 'upTime'){
            let up = await rget('up:' + obj);
            debug(obj, `Uptime for ${obj} is ${up}.`);
            return up;
        }

        return await this.getDeviceProp(obj, key, adj);
    }

    async getDeviceProp(obj, key, adj){
        let dev = await this.getState(obj);
        if (!dev) {
            log.error(`Unknown device ${obj}.`);
            return undefined;
        }

        let val = dev[key]; 
        if (val === undefined){
            debug(obj, `Property ${key} not found on ${obj}. ${JSON.stringify(dev)}`);
            return val;
        }

        debug(obj, `${obj}.${key} = ${val}`);
        if (val === 'false' || !val){
            return false;
        }

        let maybeTime = Times.toHM(val + (adj || ''));
        if (maybeTime) 
            return maybeTime;

        if (adj){
            let adjNum = +adj.replace(/[^0-9]/g, '');
            if (adj.startsWith('-')) adjNum = -adjNum;
            val = val + adjNum;
        }

        return val;
    }

    async asTime(prop){
       if (!prop) log.error('prop is null: ' + prop);
       let match = prop.match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)([+-][0-9]+)?( *\| *[0-9]{2}:[0-9]{2})?$/);
       if (match){
            let [_, obj, key, adj, def] = match;
            let val = await this.getDeviceProp(obj, key, adj || '');
            if (!val){ 
                if (def){
                    def = def.replace(/[^0-9:]/g, '');
                    if (!/^[0-9]{2}:[0-9]{2}$/.test(def)){
                        log.error(`Default value of ${def} is not a time.`);
                    }

                    debug(obj, `Return default time ${def} for ${prop}`);
                    return def;
                }

                return false;
            }

            if (!/[0-9]{2}:[0-9]{2}/.test(val)){
                log.error(`Return value of ${dev}.${prop} is not a time: ${val}`);
                return undefined;
            }

            debug(obj, `Convert ${val} to hours/minutes format. ${Times.toHM(val)}`);
            return Times.toHM(val);
        }
        else {
            debug(undefined, `Convert spec ${prop} to hours/minutes format. ${Times.toHM(prop)}`);
            return Times.toHM(prop);
        }
    }

    _readFile(){
        log(`Read file.`);
        let file = JSON.parse(fs.readFileSync(this.file));
        this.reset = Times.toHM(file.reset);
        this.schedules = file.schedules;
        this.ranges = file.ranges;
        this.aliases = file.aliases;
        this.actors = {};
        log('Schedule reset time is ' + this.reset);

        for (let schedule in this.schedules){
            rdel('override:' + schedule);
            if (!this.schedules[schedule].disabled){
                this.actors[schedule] = {};
                for (let spec of ['on', 'off']){
                    if (this.schedules[schedule][spec])
                        this.setTrigger(schedule, spec, this.schedules[schedule][spec]);
                }
            }
        }
    }

    setTrigger(schedule, spec, trigger){
        debug(schedule, `Set ${schedule}/${spec} to ${trigger}`);
        let action, triggerFunc = this.parseTrigger(schedule, spec, trigger);
        if (spec == 'on'){
            action = async () => {
                await this.on(schedule, `schedule (${spec})`);
            }
        }
        else if (spec == 'off'){
            action = async () => {
                await this.off(schedule, `schedule (${spec})`);
            }
        }

        this.actors[schedule][spec] = async (device) => {
            let overridden = await this.isOverridden(schedule, spec);
            if (overridden){
                debug(schedule, `Not running ${spec} actor for ${schedule} because it is overridden.`);
            }
            else {
                if (await triggerFunc(device) === true){ 
                    log(`Turn ${schedule} ${spec} for trigger: ${trigger}.`);
                    await action(schedule, `schedule (${spec})`);

                    if (await rget('timer:' + schedule))
                        await rdel('timer:' + schedule);

                    return true;
                }
            }
        };
    }

    async testTrigger(trig){
   
    }

    logAt(level){
        log.setLevel(level);
    }
}
