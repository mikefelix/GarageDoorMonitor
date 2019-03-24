let http = require("http"),
    url = require("url"),
    util = require('util'),
    Q = require('q'),
    redis = require('redis').createClient(),
    rkeys = util.promisify(redis.keys).bind(redis),
    rdel = redis.del.bind(redis),
    fs = require("fs"),
    history = require('./history.js'),
    log = require("./log.js")("Main"),
    format = require("./format.js"),
    path = require("path"),
    request = require('request'),
    moment = require("moment-timezone"),
    exec = require('child_process').exec,
    mail = require('./mail.js').send,
    Garage = require('./garage.js'),
    Scheduler = require('./scheduler.js'),
    Weather = require('./weather.js'),
    Thermostat = require('./thermostat.js'),
    Alarm = require('./alarm.js'),
    Fermenter = require('./fermenter.js'),
    Devices = require('./devices.js'),
    Tuya = require('./tuya.js'),
    Times = require('./sun_times.js');

const logGets = false;

const config = JSON.parse(fs.readFileSync('./config.json'));
const devices = new Devices(config);
const scheduler = new Scheduler('./schedules.json', devices);

//const history = new History();

let logLevel = process.env.LOG_LEVEL || 3;
let recentLambda = false;

process.on('uncaughtException', function (err) {
    log.error('uncaughtException: ' + err.message);
    log.error(err.stack);
    log.error('Resetting devices.');
    reset();
    //process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled promise rejection. Reason: ' + reason);
    throw reason;
});

process.on('warning', e => console.warn(e.stack));

function reset(){
    devices.reset();
}

function verifyAuth(req){
    log.debug(`verify ${req.url}`);
    if (req.method == 'GET' || req.url.match(/^\/(test|warn)/))
        return true;
    if (req.method == 'POST' && /^\/(opened|closed|alive|garage-error)/.test(req.url))
        return true;
    if (new RegExp('auth=' + config.authKey).test(req.url))
        return true;
    if (req.headers.authorization == config.authKey)
        return true;

    return false;
}

async function dumpCache(){
    let ret = {};
    let keys = await rkeys('*');
    for (let key of keys){
        ret[key] = await rget(key);
    }
    return ret;
}

const routes = {
    'GET /devices/([0-9a-z]+)': async (request, device) => {
        return devices.getState(device);
    },
    'GET /test': async () => {
        log.info('testing');
    },
    'POST /test': async () => {
    },
    'POST /warn1': async () => {
    }, 
    'POST /warn2': async () => {
        mail("Garage failed to close", "Garage didn't shut when I tried. Trying again.");
    },
    'POST /warn3': async () => {
        mail("Garage is stuck open!", "Garage is open and I cannot shut it! I tried twice.");
    },
    'POST /alive': async () => { // ping from tessel
        log("Tessel reports that it is alive.");
    },
    'POST /garage-error': async (request) => {
        log.error(`Tessel reports error:`); 
        log.error(Object.keys(request));
    },
    'POST /alarm/stop': async () => {
        devices.alarm.off();
        return 200;
    },
    'POST /alarm/go': async () => {
        devices.alarm.on();
        return 200;
    },
    'POST /alarm/(t?[0-9]+)/([0-9]+:[0-9]+|on|off)': async (request, days, set) => {
        let temp = days.indexOf('t') >= 0;
        days = days.replace(/[^0-9]/, '');

        if (set == 'on'){
            devices.alarm.enable(days, temp);
        }
        else if (set == 'off'){
            devices.alarm.disable(days, temp);
        }
        else {
            devices.alarm.setTime(set, days, temp);
        }
        
        return 200;
    },
    'POST /cominghome': async (request) => {
        log.info('Coming home command received.');
        if (Times.get().isNight) 
            devices.on('outside', 180, 'coming home');

        devices.therm.set('away', false);
        devices.garagedoor.open(5, request.url);
        return 200;
    },
    'POST /leavinghome': async (request) => {
        log.info('Leaving home command received.');
        if (Times.get().isNight) 
            devices.on('outside', 180, 'leaving home');

        devices.therm.set('away', true);
        devices.garagedoor.open(5, request.url);
        return 200;
    },
    'POST /alive': async () => {
        log.info('Tessel reports that it is alive.');
        return 200;
    },
    'POST /opened([0-9]+)?': async (request, t) => { // call from tessel
        if (!t) t = 'indefinitely';

        if (Times.get().isNight)
            devices.bulbs.on('outside', 180, 'garage opened at night');

        log.info(`Tessel reports opened ${t} state.`);
        //saveSnap(10);
        return "opened alert received";
    },
    'POST /closed': async () => { // call from tessel
        log.info('Tessel reports closed state.');
        //saveSnap(0);
        return "closed alert received";
    },
    'POST /close': async () => { // call from user
        log.info('Close command received.');
        return await devices.garagedoor.close();
    },
    'POST /open([0-9]*)': async (request, time) => { // call from user
        return await devices.garagedoor.open(time, request.url);
    },
    'PUT /beer/heater': async (request) => {
        return await devices.fermenter.heater(true);
    },
    'DELETE /beer/heater': async (request) => {
        return await devices.fermenter.heater(false);
    },
    'POST /beer/([^/]+)/([0-9.]+)': async (request, setting, temp) => { 
        let drift = false;
        if (setting.match(/drift/)){
            setting = setting.replace('drift', '');
            drift = true;
        }

        return await devices.fermenter.set(setting, temp, drift);
    },
    'GET /state/cache': async () => {
        return await dumpCache();
    },
    'DELETE /state/cache': async () => {
        let keys = await rkeys('*');
        for (let key of keys){
           rdel(key);
        }

        return true;
    },
    'GET /state/history': async () => {
        return await history.getEvents(10);
    },
    'GET /state/beer': async () => {
        if (!devices.fermenter) log.error(`No fermenter found.`);
        return await devices.fermenter.getState();
    },
    'GET /state/alarm': async () => {
        if (!devices.alarm) log.error(`No alarm found.`);
        return await devices.alarm.getState();
    },
    'GET /state/garagedoor': async () => {
        if (!devices.garagedoor) log.error(`No garagedoor found.`);
        return await devices.garagedoor.getState();
    },
    'GET /state/weather': async () => {
        if (!devices.weather) log.error(`No weather found.`);
        return await devices.weather.getState();
    },
    //'GET /state/lights': async () => {
        //return await devices.bulbs.getState();
    //},
    //'GET /state/lights/hue': async () => {
        //return await devices.bulbs.getHueState();
    //},
    //'GET /state/lights/wemo': async () => {
        //return await devices.bulbs.getWemoState();
    //},
    //'GET /state/lights/etek': async () => {
        //return await devices.bulbs.getEtekState();
    //},
    'GET /state/times': async () => {
        let times = Times.get(true);
        let schedules = await scheduler.getSchedules();
        return { times, schedules };
    },
    'GET /state/thermostat': async () => {
        if (!devices.therm) log.error(`No therm found.`);
        return await devices.therm.getState();
    },
    'POST /state/thermostat': async () => {
        return await devices.therm.moveTemp1();
    },
    /*'GET /state': async () => {
        let schedules = await scheduler.getSchedules();
        let bulbs = await devices.getState();

        if (!devices.garagedoor) log.error(`No garagedoor found.`);
        if (!devices.therm) log.error(`No therm found.`);

        let state = {
            garagedoor: await devices.garagedoor.getState(),
            bulbs,
            ranges: schedules.ranges,
            thermostat: await devices.therm.getState(),
            times: Times.get(true),
            cache: await dumpCache()
        };

        for (dev in bulbs){
            let bulb = bulbs[dev];
            let sched = schedules[dev];
            let hist = state.bulbs.history[dev];
            if (bulb && sched){
                if (sched.upTime !== undefined){
                    bulb.upTime = sched.upTime;
                    delete sched.upTime;
                }

                if (sched.timer){
                    bulb.timer = sched.timer;
                    delete sched.timer;
                }

                bulb.schedule = sched;
            }

            if (bulb && hist){
                bulb.history = hist;
            }
        }

        delete state.bulbs.history;

        return state;
    },*/
    'DELETE /therm/away': async () => {
        return await devices.therm.set('away', false);
    },
    'PUT /therm/away': async () => {
        log.trace('Thermostat poo 1');
        return await devices.therm.set('away', true);
        log.trace('Thermostat poo 2');
    },
    'POST /therm/temp([0-9]+)': async (request, temp) => {
        return await devices.therm.set('target_temperature_f', temp);
    },
    'POST /therm/fan([0-9]+)': async (request, duration) => {
        if (!duration) duration = 15;
        return await devices.therm.set('fan', duration);
    },
    'POST /button/([0-9]+)': async (request, date) => { // Call from AWS Lambda
        if (Times.get().isNight){
            if (!recentLambda){
                log(`IoT button pressed at night; turning on outside bulbs. ${date}`);
                await devices.bulbs.on('outside', 180, 'IoT button');
                recentLambda = true;
                setTimeout(() => recentLambda = false, 60000);
            }
            else {
                log(`IoT button pressed again at night; opening garage. ${date}`);
                await devices.garagedoor.open(30, request.url);
                recentLambda = false;
            }
        }
        else {
            log(`IoT button pressed in daytime; opening garage. ${date}`);
            await devices.garagedoor.open(10, request.url);
        }

        return 202;
    },
    'GET /nestredirect': async () => {
        log(request.url);
        return 202;
    },
    'POST /nestaway': async () => {
        log("Nest reports away state.");
        return "Got it.";
    },
    'POST /nesthome': async () => {
        log("Nest reports people coming home.");
        return "Got it.";
    },
    '(POST|GET) /devices/([a-z0-9_]+)/((force)?(on|off|revert))': async (request, meth, device, action) => {
        override = action.match(/force/);
        action = action.replace('force', '');

        if (meth == 'GET')
            return await devices.getState(device);

        if (meth == 'POST'){
            if (override){
                scheduler.setOverride(device)
            }
            
            if (action == 'revert'){
                scheduler.removeOverride(device);
                await scheduler.check(device);
                return true;
            }
            else {
                return await devices[action].bind(devices)(device, 'triggered by user');
            }
        }
    }
};

async function handleRequest(request, response){
    let req = request.method + ' ' + request.url.replace(/\?.*$/, '');
    if (logGets || !req.match('^GET /state'))
        log(`Received call at ${format(new Date())}: ${req}`);

    try {
        for (let route in routes){
            let match;
            if (match = req.match(new RegExp(route))){
                if (!verifyAuth(request)){
                    log('Unauthorized request for ' + req);
                    return 401;
                }

                let args = [request];
                for (let i = 1; match.hasOwnProperty(i); i++){ 
                    args.push(match[i]);
                }

                let result = await routes[route].apply(null, args);
                return result === undefined ? 200 : result;
            }
            //else log(`${route} does not match ${req}`);
        }

        log('Unknown URI: ' + req);
        return 404;
    }
    catch (e){
        log.error(`Caught error during request ${req}: ${e}`);
        return 500;
    }
}

function reply(res, msg){
    let headers = {
        'Content-type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    };

    if (msg === true){
        res.writeHead(200, headers);
        res.end();
    }
    else if (msg === false){
        res.writeHead(500, headers);
        res.end();
    }
    else if (typeof msg == 'number'){
        res.writeHead(msg, headers);
        res.end();
    }
    else if (typeof msg == 'object'){
        res.writeHead(200, headers);
        res.end(JSON.stringify(msg));
    }
    else if (typeof msg == 'string'){
        res.writeHead(200, headers);
        res.end(JSON.stringify({result:msg}));
    }
}

function proxy(response, options){
    http.request(options, function (res) {
        res.on('data', (chunk) => { 
            response.write(chunk);
        });
        res.on('error', () => {
            response.end(500);
        });
        res.on('end', () => {
            response.end(200);
        });
    });
}

http.createServer((request, response) => {
    if (request.url == '/snap.png'){
        proxy(response, {
            hostname: 'http://192.168.0.132',
            port: 80,
            path: '/snapshot.cgi?user=felix&pass=fabricky',
            method: 'GET'
        }); 
    }
    else {
        handleRequest(request, response)
        .then(result => {
            log(4, `route result is ${JSON.stringify(result)}`);
            reply(response, result);
        })
        .catch(err => {
            log(`Error during request ${request.url}: ${err}`);
            reply(response, 500);
        });
    }
}).listen(config.port);

let times = Times.get(true);
log(`Process started on ${config.port} at log level ${logLevel}. Times for today:`);
log('Current time is: ' + times.current);
log('Sunrise time is: ' + times.sunrise);
log('Sunset time is: ' + times.sunset);


