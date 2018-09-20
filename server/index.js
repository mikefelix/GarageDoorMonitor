let http = require("http"),
    url = require("url"),
    Q = require('q'),
    timeout = require('./timeout.js'),
    fs = require("fs"),
    log = require("./log.js")("Main", 1),
    format = require("./format.js"),
    path = require("path"),
    request = require('request'),
    moment = require("moment-timezone"),
    exec = require('child_process').exec,
    mail = require('./mail.js').send,
    Garage = require('./garage.js'),
    Scheduler = require('./scheduler.js'),
    Bulbs = require('./bulbs.js'),
    Weather = require('./weather.js'),
    Thermostat = require('./thermostat.js'),
    Alarm = require('./alarm.js'),
    Times = require('./sun_times.js');

const config = JSON.parse(fs.readFileSync('./config.json'));
for (let key of ["port", "email", "tesselUrl", "authKey", "hueIp", "hueKey", "pushoverKey", "etekBaseUrl", "etekUser", "etekPass", "thermostatId", "structureId", "nestToken", "weatherUrl"]){
    if (!config[key]){
        log('Key required in config: ' + key);
        process.exit(1);
    }
}

let logLevel = process.env.LOG_LEVEL || 3;
let recentLambda = false;

const bulbs = new Bulbs(
    `http://${config.hueIp}/api/${config.hueKey}/lights`, 
    [config.etekUser, config.etekPass, config.etekBaseUrl]
);
const alarm = new Alarm(config.alarmAddress, async () => { 
    return (await bulbs.getBulb('coffee')).power > 500;
});
const therm = new Thermostat(
        config.thermostatId, 
        config.structureId, 
        config.nestToken
);
const garage = new Garage(
        config.tesselUrl, 
        bulbs
);
const weather = new Weather(config.weatherUrl);
const scheduler = new Scheduler(
    './schedules.json',
    getSystemState,
    turnOn,
    turnOff
);

let devices = { bulbs, alarm, therm, garage, weather };

function turnOn(name, reason){
    log(4, `turnOn ${name} because ${reason}`);
    if (name == 'housefan')
        return therm.set.bind(therm)('fan', 30);
    else if (name == 'alarm')
        return alarm.on.bind(alarm)();
    else
        return bulbs.on.bind(bulbs)(name, reason);
}

function turnOff(name, reason){
    log(4, `turnOff ${name} because ${reason}`);
    if (name == 'housefan')
        //therm.set.bind(therm)('fan', 0) :
        return () => {} 
    else if (name == 'alarm')
        return alarm.off.bind(alarm)();
    else
        return bulbs.off.bind(bulbs)(name, reason);
}

function getSystemState(){
    let withTimeout = timeout(16000, null);
    return Q.all([
              withTimeout(therm.getState(), 'get therm state'), 
              withTimeout(garage.getState(), 'get garage state'), 
              withTimeout(bulbs.getState(), 'get bulb state'),
              withTimeout(weather.get(), 'get weather'),
              withTimeout(alarm.get(), 'get alarm')
          ]).then(states => {

        let [thermState, garageState, bulbState, weatherState, alarmState] = states;
        if (!thermState) thermState = {};

        let state = {
            away: thermState && thermState.away,
            garage: garageState,
            alarm: alarmState,
            bulbs: bulbState,
            schedules: scheduler.getSchedules(),
            hvac: {
                humidity: thermState.humidity,
                temp: thermState.temp,
                target: thermState.target,
                state: thermState.state,
                mode: thermState.mode,
                on: thermState.state == 'heating' || thermState.state == 'cooling'
            },
            housefan: {
                on: thermState.on,
                offTime: thermState.fanOffTime
            },
            weather: {
                temp: weatherState ? weatherState.temp : undefined
            },
            times: Times.get(true)
        };

        let temp = state.hvac.temp, target = state.hvac.target;
        if (state.hvac.mode == 'cool'){
            state.hvac.nearTarget = (!weatherState || weatherState.temp >= 76) &&
                temp >= target && 
                temp - target <= 2;
        }
        else if (state.hvac.mode == 'heat'){
            state.hvac.nearTarget = temp <= target && target - temp <= 2;
        }
        else {
            state.hvac.nearTarget = false;
        }

        state.history = state.bulbs.history;
        delete state.bulbs.history;
        return state;
    });
}

process.on('uncaughtException', function (err) {
    log(1, ' uncaughtException: ' + err.message);
    log(1, err.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled promise rejection. Reason: ' + reason);
    process.exit(1);
});

process.on('warning', e => console.warn(e.stack));

function verifyAuth(req){
    log(4, `verify ${req.url}`);
    if (req.method == 'GET' || req.url.match(/^\/(test|warn)/))
        return true;
    if (req.method == 'POST' && /^\/(opened|closed)/.test(req.url))
        return true;
    if (new RegExp('auth=' + config.authKey).test(req.url))
        return true;
    if (req.headers.authorization == config.authKey)
        return true;

    return false;
}

const routes = {
    'GET /test': async () => {
        log.info('testing');
        return 200;
    },
    'POST /test': async () => {
        return 200;
    },
    'POST /warn1': async () => {
        return 200;
    }, 
    'POST /warn2': async () => {
        mail("Garage failed to close", "Garage didn't shut when I tried. Trying again.");
        return 200;
    },
    'POST /warn3': async () => {
        mail("Garage is stuck open!", "Garage is open and I cannot shut it! I tried twice.");
        return 200;
    },
    'POST /alive': async () => { // ping from tessel
        log("Tessel reports that it is alive.");
        return 200;
    },
    'POST /alarm/(t?[0-9]+)/([0-9]+:[0-9]+|on|off)': async (request, days, set) => {
        let temp = days.indexOf('t') >= 0;
        days = days.replace(/[^0-9]/, '');

        if (set == 'on'){
            log(4, `Enable alarm for ${days}.`);
            alarm.enable(days, temp);
        }
        else if (set == 'off'){
            log(4, `Disable alarm for ${days}.`);
            alarm.disable(days, temp);
        }
        else {
            log(4, `Set alarm time to ${set}.`);
            alarm.setTime(set, days, temp);
        }
        
        return 200;
    },
    'POST /opened([0-9]+)?': async (request, t) => { // call from tessel
        if (!t) t = 'indefinitely';

        if (Times.get().isNight)
            bulbs.on('outside', 180, 'garage opened at night');

        log(3, `Tessel reports opened ${t} state.`);
        //saveSnap(10);
        return "opened alert received";
    },
    'POST /closed': async () => { // call from tessel
        log(3, 'Tessel reports closed state.');
        //saveSnap(0);
        return "closed alert received";
    },
    'POST /close': async () => { // call from user
        log('Close command received.');
        let msg = await garage.close();
        //log('Tessel replies: ' + msg);
        return msg;
    },
    'POST /open([0-9]*)': async (request, time) => { // call from user
        return await garage.open(time, request.url);
    },
    'GET /time': async () => { // call from user
        let times = Times.get(true);
        for (let t in times){
            if (t != 'isNight') times[t] = format(times[t]);
        }

        return times;
    },
    'GET /state/alarm': async () => {
        return await alarm.get();
    },
    'GET /state/garage': async () => {
        return await garage.getState();
    },
    'GET /state/weather': async () => {
        return await weather.get();
    },
    'GET /state/lights': async () => {
        return await bulbs.getState();
    },
    'GET /state/lights/hue': async () => {
        return await bulbs.getHueState();
    },
    'GET /state/lights/wemo': async () => {
        return await bulbs.getWemoState();
    },
    'GET /state/lights/etek': async () => {
        return await bulbs.getEtekState();
    },
    'GET /state/times': async () => {
        return Times.get(true);
    },
    'GET /state/schedules': async () => {
        return scheduler.getSchedules();
    },
    'GET /state/thermostat': async () => {
        return await therm.getState();
    },
    'POST /state/thermostat': async () => {
        return await therm.moveTemp1();
    },
    'GET /state': async () => {
        let state = {
            garage: await garage.getState(),
            bulbs: await bulbs.getState(),
            schedules: scheduler.getSchedules(),
            thermostat: await therm.getState(),
            times: Times.get(true)
        };

        state.history = state.bulbs.history;
        delete state.bulbs.history;

        return state;
    },
    'DELETE /therm/away': async () => {
        return await therm.set('away', false);
    },
    'PUT /therm/away': async () => {
        return await therm.set('away', true);
    },
    'POST /therm/temp([0-9]+)': async (request, temp) => {
        return await therm.set('target_temperature_f', temp);
    },
    'POST /therm/fan([0-9]+)': async (request, duration) => {
        if (!duration) duration = 15;
        return await therm.set('fan', duration);
    },
    'POST /button': async () => { // Call from AWS Lambda
        if (Times.get().isNight){
            if (!recentLambda){
                log('IoT button pressed at night; turning on outside bulbs.');
                bulbs.on('outside', 180, 'IoT button');
                recentLambda = true;
                setTimeout(() => recentLambda = false, 60000);
            }
            else {
                log('IoT button pressed again at night; opening garage.');
                await garage.open(0, request.url);
                recentLambda = false;
            }
        }
        else {
            log('IoT button pressed in daytime; opening garage.');
            await garage.open(0, request.url);
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
    '(POST|GET) /(light|alight|unlight)/([a-z0-9_]+)': async (request, meth, action, light) => {
        if (meth == 'GET')
            return await bulbs.getBulb(light);

        if (meth == 'POST'){
            scheduler.toggleOverride(light);
            bulbs.toggleOverride(light);

            let get;
            if (action == 'light')
                get = bulbs.toggle;
            else if (action == 'alight')
                get = bulbs.on;
            else if (action == 'unlight')
                get = bulbs.off;

            return await get.bind(bulbs)(light, request.url); 
        }

        return 406;
    }
};

async function handleRequest(request, response){
    let req = request.method + ' ' + request.url.replace(/\?.*$/, '');
    if (req.match('^GET /state/alarm') || !req.match('^GET /state'))
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

                return await routes[route].apply(null, args);
            }
            //else log(`${route} does not match ${req}`);
        }

        log('Unknown URI: ' + req);
        return 404;
    }
    catch (e){
        log(`Caught error during request ${req}: ${e}`);
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

//setInterval(saveSnap, 1000 * 60 * 15);


