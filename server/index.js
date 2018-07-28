let http = require("http"),
    url = require("url"),
    fs = require("fs"),
    log = require("./log.js")("Main"),
    format = require("./format.js"),
    path = require("path"),
    request = require('request'),
    moment = require("moment-timezone"),
    exec = require('child_process').exec,
    mail = require('./mail.js').send,
    Garage = require('./garage.js'),
    Scheduler = require('./scheduler.js'),
    Bulbs = require('./bulbs.js'),
    Thermostat = require('./thermostat.js'),
    Times = require('./sun_times.js');

const config = JSON.parse(fs.readFileSync('./config.json'));
for (let key of ["port", "email", "tesselUrl", "authKey", "hueIp", "hueKey", "pushoverKey", "etekBaseUrl", "etekUser", "etekPass", "thermostatId", "structureId", "nestToken"]){
    if (!config[key]){
        log('Key required in config: ' + key);
        process.exit(1);
    }
}

let recentLambda = false;
const bulbs = new Bulbs(
    `http://${config.hueIp}/api/${config.hueKey}/lights`, 
    [config.etekUser, config.etekPass, config.etekBaseUrl]
);
const therm = new Thermostat(
        config.thermostatId, 
        config.structureId, 
        config.nestToken
);
const garage = new Garage(
        config.tesselUrl, 
        bulbs
);
const scheduler = new Scheduler(
    './schedules.json',
    getSystemState,
    turnOn,
    turnOff
);

function turnOn(name, reason){
    return name == 'housefan' ?
        therm.set.bind(therm)('fan', 30) :
        bulbs.on.bind(bulbs)(name, reason);
}

function turnOff(name, reason){
    return name == 'housefan' ?
        //therm.set.bind(therm)('fan', 0) :
        () => {} :
        bulbs.off.bind(bulbs)(name, reason);
}

/*function getDevice(name){
    return name == 'furnace' || name == 'housefan' ?
        therm.getState() :
        bulbs.getBulb(name);
}*/

/*function doOpen(uri){
    if (Times.get().isNight){
        bulbs.on('outside', 180, 'garage opened at night via app');
    }
    
    return new Promise((resolve, reject) => {
        try {
            let time;
            if (/open[0-9]+/.test(uri)){
                time = uri.match(/open([0-9]+)/)[1];
                log(`Garage open ${time} command received.`);
            }
            else {
                time = 0;
                log(`Garage open indefinitely command received.`);
            }

            tessel.post('open' + time);

            setTimeout(async () => {
                resolve(await tessel.get('state'));
            }, 4000);
        }
        catch (e){
            log(`Error: ${e}`);
            reject(e);
        }
    });
}

function saveSnap(after){
    if (after){
        setTimeout(saveSnap, after * 1000);
    }
    else {
        exec('/home/felix/bin/snapshot.sh', (error, stdout, stderr) => {
            if (error) log("Failed to save snapshot. " + error);
        });
    }
}
*/

async function getSystemState(){
    let thermState = await therm.getState();

    let state = {
        away: thermState.away,
        garage: await garage.getState(),
        bulbs: await bulbs.getState(),
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
        times: Times.get(true)
    };

    let temp = state.hvac.temp, target = state.hvac.target;
    if (state.hvac.mode == 'cool')
        state.hvac.nearTarget = temp >= target && temp - target <= 2;
    else if (state.hvac.mode == 'heat')
        state.hvac.nearTarget = temp <= target && target - temp <= 2;

    state.history = state.bulbs.history;
    delete state.bulbs.history;
    return state;
}

process.on('uncaughtException', function (err) {
    log(' uncaughtException: ' + err.message);
    console.log(err.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled promise rejection. Reason: ' + reason);
    process.exit(1);
});

function verifyAuth(req){
    log(`Verify auth for ${req.url}.`);
    log(`${JSON.stringify(req.headers)}`);
    if (new RegExp('auth=' + config.authKey).test(req.url))
        return true;

    if (req.headers.authorization == config.authKey)
        return true;

    return false;
}

const routes = {
    'POST /test(.)(.)': async (request, a, b) => {
        console.log(`args: ${a}, ${b}`);
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
    'POST /opened([0-9+])?': async (request, t) => { // call from tessel
        if (!t) t = 'indefinitely';

        if (Times.get().isNight)
            bulbs.on('outside', 180, 'garage opened at night');

        log(`Tessel reports opened ${t} state.`);
        saveSnap(10);
        return "opened alert received";
    },
    'POST /closed': async () => { // call from tessel
        log('Tessel reports closed state.');
        saveSnap(0);
        return "closed alert received";
    },
    'POST /close': async () => { // call from user
        log('Close command received.');
        let msg = await tessel.post('close');
        log('Tessel replies: ' + msg);
        return msg;
    },
    'POST /open([0-9]+)': async (request, time) => { // call from user
        return await doOpen(time, request.url);
    },
    'GET /time': async () => { // call from user
        let times = Times.get(true);
        for (let t in times){
            if (t != 'isNight') times[t] = format(times[t]);
        }

        return times;
    },
    'GET /state/garage': async () => {
        return await garage.getState();
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
                doOpen(0, request.url);
                recentLambda = false;
            }
        }
        else {
            log('IoT button pressed in daytime; opening garage.');
            doOpen(request.url);
        }

        return 202;
    },
    'GET /nestredirect': async () => {
        log(request.url);
        return 202;
    },
    'POST /nestaway': async () => {
        log("Nest reports away state at " + format(new Date()));
        return "Got it.";
    },
    'POST /nesthome': async () => {
        log("Nest reports people coming home at " + format(new Date()));
        return "Got it.";
    },
    '(POST|GET) /(light|alight|unlight)/([a-z0-9_]+)': async (request, meth, action, light) => {
        log(`${meth} ${action} ${light} ${request.url}`);
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
    if (!req.match('^GET /state'))
        log(`Received call at ${format(new Date())}: ${req}`);

    try {
        for (let route in routes){
            let match;
            if (match = req.match(new RegExp(route))){
                if (!req.match(/^GET/) && !verifyAuth(request)){
                    log('Unauthorized request for ' + req);
                    return 401;
                }

                let args = [request];
                for (let i = 1; match.hasOwnProperty(i); i++){ 
                    args.push(match[i]);
                    console.log(`${i} -> ${match[i]}`);
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

/*
async function handleRequestOld(request, response){
    let req = request.method + ' ' + request.url.replace(/\?.*$/, '');
    if (!req.match('^GET /state'))
        log(`Received call at ${format(new Date())}: ${req}`);

    try {
        if (req == 'POST /warn1'){
            return "OK";
        }
        if (req == 'POST /warn2'){
            mail("Garage failed to close", "Garage didn't shut when I tried. Trying again.");
            return "OK";
        }
        if (req == 'POST /warn3'){
            mail("Garage is stuck open!", "Garage is open and I cannot shut it! I tried twice.");
            return "OK";
        }
        if (req == 'POST /alive'){ // ping from tessel
            log("Tessel reports that it is alive at " + new Date());
            return "Yay!";
        }
        if (req.match(/^POST \/opened/)){ // call from tessel
            let t = 'indefinitely';
            if (req.match(/[0-9]+/))
                t = req.match(/[0-9]+/)[0];

            if (Times.get().isNight){
                bulbs.on('outside', 180, 'garage opened at night');
            }

            log(`Tessel reports opened ${t} state at ${new Date()}`);
            saveSnap(10);
            return "opened alert received";
        }
        if (req == 'POST /closed'){ // call from tessel
            log('Tessel reports closed state at ' + new Date());
            saveSnap(0);
            return "closed alert received";
        }
        if (req.match(/^POST \/close/)){ // call from user
            if (verifyAuth(request)){
                log('Close command received at ' + new Date());
                return await garage.close();
            }
            else {
                log('401 on close command at ' + new Date());
                return 401;
            }
        }
        if (req.match(/^POST \/open/)){ // call from user
            if (verifyAuth(request)){
                let [r, time] = request.url.match(/open([0-9]*)/);
                return await garage.open(time);
            }
            else {
                log('Unknown auth while attempting to open garage at ' + new Date() + ': ');
                log(req.headers.Authorization);
                return 401;
            }
        }
        if (req == 'GET /time'){ // call from user
            let times = Times.get(true);
            for (let t in times){
                if (t != 'isNight') times[t] = format(times[t]);
            }

            return times;
        }
        if (req == 'GET /state/garage'){
            return await garage.getState();
        }
        if (req == 'GET /state/lights'){
            return await bulbs.getState();
        }
        if (req == 'GET /state/lights/hue'){
            return await bulbs.getHueState();
        }
        if (req == 'GET /state/lights/wemo'){
            return await bulbs.getWemoState();
        }
        if (req == 'GET /state/lights/etek'){
            return await bulbs.getEtekState();
        }
        if (req == 'GET /state/times'){
            return Times.get(true);
        }
        if (req == 'GET /state/schedules'){
            return scheduler.getSchedules();
        }
        if (req == 'GET /state/thermostat'){
            return await therm.getState();
        }
        if (req == 'POST /state/thermostat'){
            return await therm.moveTemp1();
        }
        if (req == 'GET /state'){
            return await getSystemState();
        }
        if (req == 'DELETE /therm/away'){
            if (!verifyAuth(request))
                return 401;
            
            return await therm.set('away', false);
        }
        if (req == 'PUT /therm/away'){
            if (!verifyAuth(request))
                return 401;
            
            return await therm.set('away', true);
        }
        if (req.match(/^POST \/therm\/temp[0-9]+/)){ 
            if (!verifyAuth(request))
                return 401;
            
            let temp = req.url.match(/temp([0-9]+)/)[1];
            return await therm.set('target_temperature_f', temp);
        }
        if (req.match(/^POST \/therm\/fan/)){ 
            if (!verifyAuth(request))
                return 401;
            
            let duration = !/fan[0-9]+/.test(req.url) ? 15 : req.url.match(/fan([0-9]+)/)[1];
            return await therm.set('fan', duration);
        }
        if (req == 'POST /button'){ // Call from AWS Lambda
            if (!verifyAuth(request))
                return 401;

            if (!recentLambda){
                if (Times.get().isNight){
                    log('IoT button pressed. It is night, so turning on bulbs.');
                    bulbs.on('outside', 180, 'IoT button');
                    recentLambda = true;
                    setTimeout(() => recentLambda = false, 60000);
                }
                else {
                    log('IoT button pressed. It is not night, so opening garage.');
                    doOpen(request.url);
                }
            }
            else {
                log('IoT button pressed again, so turning on bulbs.');
                doOpen(request.url);
                recentLambda = false;
            }

            return 200;
        }
        if (req == 'GET /nestredirect'){
            log(request.url);
            return 200;
        }
        if (req == 'POST /nestaway'){ 
            log("Nest reports away state at " + format(new Date()));
            return "Got it.";
        }
        if (req == 'POST /nesthome'){ 
            log("Nest reports people coming home at " + format(new Date()));
            return "Got it.";
        }
        if (/(POST|GET) \/alight\/[a-z0-9]+/.test(req)){
            let [u, meth, light] = req.match(/(POST|GET) \/alight\/([a-z0-9]+)/);
            if (meth == 'GET')
                return await bulbs.getBulb(light);
            
            if (meth == 'POST'){
                scheduler.toggleOverride(light);
                bulbs.toggleOverride(light);

                let res = await bulbs.on(light, req);
                return await bulbs.getBulb(light);
            }

            return 406;
        }
        if (/(POST|GET) \/unlight\/[a-z0-9]+/.test(req)){
            let [u, meth, light] = req.match(/(POST|GET) \/unlight\/([a-z0-9]+)/);
            if (meth == 'GET')
                return await bulbs.getBulb(light);
            
            if (meth == 'POST'){
                scheduler.toggleOverride(light);
                bulbs.toggleOverride(light);
                let res = await bulbs.off(light, req);
                return await bulbs.getBulb(light);
            }

            return 406;
        }
        if (/(POST|GET) \/light\/[a-z0-9]+/.test(req)){
            let [u, meth, light] = req.match(/(POST|GET) \/light\/([a-z0-9]+)/);
            if (meth == 'GET')
                return await bulbs.getBulb(light);
            
            if (meth == 'POST'){
                scheduler.toggleOverride(light);
                bulbs.toggleOverride(light);

                let res = await bulbs.toggle(light, req);
                return await bulbs.getBulb(light);
            }

            return 406;
        }

        log('Unknown URI: ' + req);
        return 404;
    } 
    catch (e){
        log(`Caught error during request ${req}: ${e}`);
        return 500;
    }
}
*/

function reply(res, msg){
    let headers = {
        'Content-type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    };

    if (msg === true){
        res.writeHead(200, headers);
    }
    else if (msg === false){
        res.writeHead(500, headers);
    }
    else if (typeof msg == 'number'){
        res.writeHead(msg, headers);
    }
    else if (typeof msg == 'object'){
        res.writeHead(200, headers);
        res.end(JSON.stringify(msg));
    }
    else if (typeof msg == 'string'){
        res.writeHead(200, headers);
        res.end(JSON.stringify({result:msg}));
    }

    res.end();
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
            reply(response, result);
        })
        .catch(err => {
            log(`Error during request ${request.url}: ${err}`);
            reply(response, 500);
        });
    }
}).listen(config.port);

let times = Times.get(true);
log(`Process started on ${config.port}. Times for today:`);
log('Current time is: ' + times.current);
log('Sunrise time is: ' + times.sunrise);
log('Sunset time is: ' + times.sunset);

//setInterval(saveSnap, 1000 * 60 * 15);


