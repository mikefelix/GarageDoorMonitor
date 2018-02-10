let http = require("http"),
    url = require("url"),
    fs = require("fs"),
    format = require("./format.js"),
    path = require("path"),
    request = require('request'),
    moment = require("moment-timezone"),
    exec = require('child_process').exec,
    mail = require('./mail.js').send,
    Scheduler = require('./scheduler.js'),
    Bulbs = require('./bulbs.js'),
    Tessel = require('./tessel.js'),
    Times = require('./sun_times.js');

if (!process.argv[11]){
    console.log("Usage:\nnode garage.js PORT EMAIL TESSEL_URL AUTH_KEY HUE_IP HUE_KEY PUSHOVER_KEY GARAGE_BUTTON_MAC ETEK_USER ETEK_PASS");
    throw "Invalid usage";
}

let recentLambda = false;
const port = process.argv[2]; 
const emailAddress = process.argv[3];
const tessel = new Tessel(process.argv[4]);
const authKey = process.argv[5];
const hueIp = process.argv[6];
const hueKey = process.argv[7];
// const pushoverKey = process.argv[8];
const garageButtonMac = process.argv[9];
const etekUser = process.argv[10];
const etekPass  = process.argv[11];
const hueAddress = `http://${hueIp}/api/${hueKey}/lights`;
const bulbs = new Bulbs(hueAddress, [etekUser, etekPass]);
const currentWeatherUri = 'http://mozzarelly.com/weather/current';

const scheduler = new Scheduler(
    './schedules.json',
    bulbs.getBulb.bind(bulbs),
    bulbs.on.bind(bulbs),
    bulbs.off.bind(bulbs)
);

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

async function doOpen(uri){
    if (Times.get().isNight){
        bulbs.on('outside', 180, 'garage opened at night via app');
    }
    
    if (/open[0-9]+/.test(uri)){
        let time = uri.match(/open([0-9]+)/)[1];
        console.log((!response ? 'Button' : 'App') + ' open ' + time + ' command received at ' + new Date());
        return await tessel.post('open' + time);
    }
    else {
        console.log('Open indefinitely command received at ' + new Date());
        return await tessel.post('open0');
    }
}

process.on('uncaughtException', function (err) {
    console.error(new Date().toUTCString() + ' uncaughtException:', err.message);
    console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled promise rejection. Reason: ' + reason);
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
    console.log(`Received call at ${format(new Date())}: ${req}`);

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
            console.log("Tessel reports that it is alive at " + new Date());
            return "Yay!";
        }
        if (req.match(/^POST \/opened/)){ // call from tessel
            let t = 'indefinitely';
            if (req.match(/[0-9]+/))
                t = req.match(/[0-9]+/)[0];

            if (Times.get().isNight){
                bulbs.on('outside', 180, 'garage opened at night');
            }

            console.log(`Tessel reports opened ${t} state at ${new Date()}`);
            return "opened alert received";
        }
        if (req == 'POST /closed'){ // call from tessel
            console.log('Tessel reports closed state at ' + new Date());
            return "closed alert received";
        }
        if (req.match(/^POST \/close/)){ // call from user
            if (verifyAuth(request)){
                console.log('Close command received at ' + new Date());
                let msg = await tessel.post('close');
                console.log('Tessel replies: ' + msg);
                return msg;
            }
            else {
                console.log('401 on close command at ' + new Date());
                return 401;
            }
        }
        if (req.match(/^POST \/open/)){ // call from user
            if (verifyAuth(request)){
                return await doOpen(request.url);
            }
            else {
                console.log('Unknown auth while attempting to open garage at ' + new Date() + ': ');
                console.log(req.headers.Authorization);
                return 401;
            }
        }
        if (req == 'GET /time'){ // call from user
            let times = Times.get(true);
            for (let t in times){
                if (t != 'isNight') times[t] = format(times[t], true);
            }

            return times;
        }
        if (req == 'GET /state'){ // call from user
            let formatTesselDate = (date) => {
                return date ? moment(date).format("MM/DD/YYYY, h:mm:ssa") : null;
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
            state.garage = tesselState;
            state.times = Times.get(true);
            state.bulbs = await bulbs.getState();
            state.schedules = scheduler.getSchedules();
            console.dir(state.schedules);
            return state;
        }
        if (req == 'POST /button'){ // Call from AWS Lambda
            if (!verifyAuth(request))
                return 401;

            if (!recentLambda){
                if (Times.get().isNight){
                    console.log('IoT button pressed. It is night, so turning on bulbs.');
                    bulbs.on('outside', 180, 'IoT button');
                    recentLambda = true;
                    setTimeout(() => recentLambda = false, 60000);
                }
                else {
                    console.log('IoT button pressed. It is not night, so opening garage.');
                    doOpen(request.url);
                }
            }
            else {
                console.log('IoT button pressed again, so turning on bulbs.');
                doOpen(request.url);
                recentLambda = false;
            }

            return 200;
        }
        if (req == 'POST /home' || req == 'GET /home'){ 
            console.log("Nest reports people coming home at " + new Date());
            /*exec('/home/felix/bin/snapshot.sh', function callback(error, stdout, stderr){
                if (error) console.log("Failed to save snapshot. " + error);
            });*/

            return "Got it.";
        }
        if (/(POST|GET) \/light\/[a-z0-9]+/.test(req)){
            let [u, meth, light] = req.match(/(POST|GET) \/light\/([a-z0-9]+)/);
            if (meth == 'GET')
                return await bulbs.getBulb(light);
            
            if (meth == 'POST'){
                scheduler.override(light);

                let res = await bulbs.toggle(light, req);
                if (res){
                    return await bulbs.getBulb(light);
                }
                else {
                    return 500;
                }
            }

            return 406;
        }

        console.log('Unknown URI: ' + req);
        return 404;
    } 
    catch (e){
        console.log(`Caught error during request ${req}: ${e}`);
        return 500;
    }
}

http.createServer((request, response) => {
    handleRequest(request, response)
    .then(result => {
        reply(response, result);
    })
    .catch(err => {
        console.log(`Error during request ${request.url}: ${err}`);
        reply(response, 500);
    });
}).listen(8888);

let times = Times.get(true);
console.log("Process started. Times for today:");
console.log('Current time is: ' + times.current);
console.log('Sunrise time is: ' + times.sunrise);
console.log('Sunset time is: ' + times.sunset);

setInterval(async () => {
   let bulb = await bulbs.getBulb('driveway');
   if (bulb.state){
       console.log(`I see the driveway on at ${format(new Date())}. Why??? Shutting it off.`);
       bulbs.off('driveway');
   }
}, 60000);
