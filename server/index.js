let http = require("http"),
    url = require("url"),
    fs = require("fs"),
    format = require("./format.js"),
    path = require("path"),
    request = require('request'),
    moment = require("moment-timezone"),
    exec = require('child_process').exec,
    mail = require('./mail.js').send,
    Bulbs = require('./bulbs.js'),
    Tessel = require('./tessel.js'),
    Times = require('./sun_times.js');

if (!process.argv[10]){
    console.log("Usage:\nnode garage.js PORT EMAIL TESSEL_URL AUTH_KEY HUE_KEY PUSHOVER_KEY GARAGE_BUTTON_MAC ETEK_USER ETEK_PASS");
    throw "Invalid usage";
}

const port = process.argv[2]; 
const emailAddress = process.argv[3];
const tessel = new Tessel(process.argv[4]);
const authKey = process.argv[5];
const hueKey = process.argv[6];
// const pushoverKey = process.argv[7];
const garageButtonMac = process.argv[8];
const etekUser = process.argv[9];
const etekPass  = process.argv[10];
const hueAddress = `http://192.168.0.115/api/${hueKey}/lights`;
const bulbs = new Bulbs(hueAddress, [etekUser, etekPass]);
const currentWeatherUri = 'http://mozzarelly.com/weather/current';
const schedules = JSON.parse(fs.readFileSync('./schedules.json'));
//let lampForced = false, outerLightsForced = false, drivewayForced = false;
let recentLambda = false;

function checkSchedules(){
    let date = new Date();
    for (let sched in schedules){
        console.log('Check schedule ' + sched);
        checkSchedule(date, schedules[sched]);
    }
}

async function checkSchedule(date, schedule){
    let time = date.getTime();
    let times = Times.get();
    let bulb = schedule.bulb;
    let on = Times.parse(schedule.on);
    let off = Times.parse(schedule.off);
    let overridden = !!schedule.overridden;
    console.log(`on: ${on}, off: ${off}`);

    function currentTimeIs(t) {
        if (t.getTime) t = t.getTime();
        return time > t && time < t + 60000;
    };

    if (overridden) {
        if (currentTimeIs(times.dayReset)){
            console.log(`Resetting overriden control for ${bulb}.`);
            schedule.overridden = overridden = false;
        }
    }

    if (!overridden && on){
        if (currentTimeIs(on)){
            if (!(await bulbs.getBulbState(bulb))){
                console.log(`Turning on ${bulb} at ${on}`);
                bulbs.on(bulb, 'schedule');
            }
        }
    }
    else if (!overridden && off){
        if (currentTimeIs(off)){
            if (await bulbs.getBulbState(bulb)){
                console.log(`Turning off ${bulb} at ${off}`);
                bulbs.off(bulb, 'schedule');
            }
        }
    }
}

function reply(res, msg){
    let headers = {
        'Content-type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    };

    if (typeof msg == 'number'){
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
    if (Times.get.isNight){
        bulbs.on('outside', 180, 'garage opened at night');
        //drivewayForced = true;
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

            if (Times.get.isNight){
                bulbs.on('outside', 180);
                //drivewayForced = true;
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
            return Times.get();
        }
        if (req == 'GET /state'){ // call from user
            let tesselState = await tessel.get('state');
            let state;
            try {
                state = JSON.parse(tesselState);
            }
            catch (e) {
                throw 'Error parsing Tessel state JSON: ' + tesselState;
            }

            state.is_night = Times.get.isNight;
            state.bulbs = await bulbs.getState();
            return state;
        }
        if (req == 'POST /button'){ // Call from AWS Lambda
            if (verifyAuth(request)){
                if (!recentLambda){
                    if (Times.get.isNight){
                        console.log('IoT button pressed. It is night, so turning on bulbs.');
                        bulbs.on('outside', 180);
                        //drivewayforced = true;
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
            else {
                return 401;
            }
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
                if (schedules[light])
                    schedules[light].overridden = true;

                let res = await bulbs.toggle(light, req);
                return `Toggled ${light} to ${res ? 'on' : 'off'}.`;
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

setInterval(checkSchedules, 60000);

let times = Times.get();
console.log("Process started. Times for today:");
console.log('Current time is: ' + format(times.retrieved));
console.log('Sunrise time is: ' + format(times.sunrise));
console.log('Sunset time is: ' + format(times.sunset));

/*setInterval(async () => {
   if (!drivewayForced){
       let bulb = await bulbs.getBulb('driveway');
       if (bulb.state){
           console.log(`I see the driveway on at ${format(new Date())}. Why??? Shutting it off.`);
           bulbs.off('driveway');
       }
   }
}, 60000);*/
