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
    Scheduler = require('./scheduler.js'),
    Bulbs = require('./bulbs.js'),
    Tessel = require('./tessel.js'),
    Thermostat = require('./thermostat.js'),
    Times = require('./sun_times.js');

if (!process.argv[15]){
    console.log("Usage:\nnode garage.js PORT EMAIL TESSEL_URL AUTH_KEY HUE_IP HUE_KEY PUSHOVER_KEY GARAGE_BUTTON_MAC ETEK_USER ETEK_PASS THERMOSTAT_ID STRUCTURE_ID NEST_TOKEN CURRENT_WEATHER_URL");
    throw "Invalid usage";
}

let recentLambda = false;
let homeAwayState;

const port = process.argv[2]; 
const emailAddress = process.argv[3];
const tessel = new Tessel(process.argv[4]);
const authKey = process.argv[5];
const hueIp = process.argv[6];
const hueKey = process.argv[7];
// const pushoverKey = process.argv[8];
const garageButtonMac = process.argv[9];
const etekUser = process.argv[10];
const etekPass = process.argv[11];
const thermId = process.argv[12];
const structureId = process.argv[13];
const nestToken = process.argv[14];
const currentWeatherUri = process.argv[15];
const hueAddress = `http://${hueIp}/api/${hueKey}/lights`;
const bulbs = new Bulbs(hueAddress, [etekUser, etekPass]);
const therm = new Thermostat(thermId, structureId, nestToken);

const scheduler = new Scheduler(
    './schedules.json',
    bulbs.getBulb.bind(bulbs),
    bulbs.on.bind(bulbs),
    bulbs.off.bind(bulbs)
);

async function doOpen(uri){
    if (Times.get().isNight){
        bulbs.on('outside', 180, 'garage opened at night via app');
    }
    
    if (/open[0-9]+/.test(uri)){
        let time = uri.match(/open([0-9]+)/)[1];
        log(`Garage open ${time} command received at ${new Date}.`);
        //log((!response ? 'Button' : 'App') + ' open ' + time + ' command received at ' + new Date());
        return await tessel.post('open' + time);
    }
    else {
        log(`Open indefinitely command received at ${new Date()}.`);
        return await tessel.post('open0');
    }
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
process.on('uncaughtException', function (err) {
    log(' uncaughtException: ' + err.message);
    console.log(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled promise rejection. Reason: ' + reason);
});

function verifyAuth(req){
    if (new RegExp('auth=' + authKey).test(req.url))
        return true;
    if (req.headers.Authorization == authKey)
        return true;

    return false;
}

async function handleRequest(request, response){
    let req = request.method + ' ' + request.url.replace(/\?.*$/, '');
    if (req != 'GET /state')
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
                let msg = await tessel.post('close');
                log('Tessel replies: ' + msg);
                return msg;
            }
            else {
                log('401 on close command at ' + new Date());
                return 401;
            }
        }
        if (req.match(/^POST \/open/)){ // call from user
            if (verifyAuth(request)){
                return await doOpen(request.url);
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
        if (req == 'GET /state'){ // call from user
            let formatTesselDate = (date) => {
                return date ? format(date) : null;
            };

            let tesselState = await tessel.get('state');
            try {
                tesselState = JSON.parse(tesselState);
                tesselState.last_open_time = formatTesselDate(tesselState.last_open_time);
                tesselState.last_close_time = formatTesselDate(tesselState.last_close_time);
                tesselState.next_close_time = formatTesselDate(tesselState.next_close_time);
                tesselState.current_time = formatTesselDate(tesselState.current_time);
            }
            catch (e) {
                throw 'Error parsing Tessel state JSON: ' + tesselState;
            }

            let state = {};
            state.away = homeAwayState;
            state.garage = tesselState;
            state.times = Times.get(true);
            state.bulbs = await bulbs.getState();
            state.schedules = scheduler.getSchedules();

            state.thermostat = await therm.getState();
            return state;
        }
        if (req == 'DELETE /therm/away'){
            return await therm.set('away', false);
        }
        if (req == 'PUT /therm/away'){
            return await therm.set('away', true);
        }
        if (req.match(/^POST \/therm\/fan/)){ 
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
            homeAwayState = true;
            return "Got it.";
        }
        if (req == 'POST /nesthome'){ 
            log("Nest reports people coming home at " + format(new Date()));
            homeAwayState = false;
            return "Got it.";
        }
        if (/(POST|GET) \/light\/[a-z0-9]+/.test(req)){
            let [u, meth, light] = req.match(/(POST|GET) \/light\/([a-z0-9]+)/);
            if (meth == 'GET')
                return await bulbs.getBulb(light);
            
            if (meth == 'POST'){
                scheduler.override(light);

                let res = await bulbs.toggle(light, req);
                //if (res){
                    return await bulbs.getBulb(light);
                //}
                //else {
                    //return 500;
                //}
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
}).listen(port);

let times = Times.get(true);
log(`Process started on ${port}. Times for today:`);
log('Current time is: ' + times.current);
log('Sunrise time is: ' + times.sunrise);
log('Sunset time is: ' + times.sunset);

//setInterval(saveSnap, 1000 * 60 * 15);

setInterval(async () => {
   let bulb = await bulbs.getBulb('driveway');
   if (bulb.state){
       log(`I see the driveway on at ${format(new Date())}. Why??? Shutting it off.`);
       bulbs.off('driveway');
   }
}, 60000);
