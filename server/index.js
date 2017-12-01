let http = require("http"),
    url = require("url"),
    format = require("./format.js"),
    path = require("path"),
    request = require('request'),
    moment = require("moment-timezone"),
    exec = require('child_process').exec,
    mail = require('./mail.js').send,
    Bulbs = require('./bulbs.js'),
    Tessel = require('./tessel.js'),
    SunTimes = require('./sun_times.js');

if (!process.argv[6]){
    console.log("Usage:\nnode garage.js PORT EMAIL TESSEL_URL AUTH_KEY HUE_KEY ");
    throw "Invalid usage";
}

const garageButtonMac = "50:f5:da:90:d1:fa";
const port = process.argv[2]; 
const emailAddress = process.argv[3];
const tessel = new Tessel(process.argv[4]);
const authKey = process.argv[5];
const hueKey = process.argv[6];
const hueAddress = `http://192.168.0.115/api/${hueKey}/lights`;
const bulbs = new Bulbs(hueAddress);
const currentWeatherUri = 'http://mozzarelly.com/weather/current';

let drivewayOn = false;

let lampForced = false, outerLightsForced = false;

async function checkLamp(){
    let date = new Date();
    let time = date.getTime();
    let sunTimes = SunTimes.get();
    let sunrise = sunTimes.sunrise.getTime();
    let lampOn = sunTimes.lampOn.getTime();
    let lampOff = sunTimes.lampOff.getTime();

    if (time > sunrise && time < sunrise + 60000){
        console.log("Turning off all outer lights. The dawn has come!");
        bulbs.off('outside', 'dawn');
        drivewayOn = false;
    }

    if (lampForced && date.getHours() == 4){
        lampForced = false;
    }

    let lamp = await bulbs.getBulb('lamp');
    let lampState = lamp.state;
    let afterLampOn = time > lampOn;
    let afterLampOff = time > lampOff;

    if (!lampForced){
        if (!lampState && afterLampOn && !afterLampOff){
            console.log('Turn on lamp because current time', 
                    format(date), 
                    'is after lampOn time',
                    format(sunTimes.lampOn),
                    'and not after lampOff time',
                    format(sunTimes.lampOff));

            lampForced = false;
            bulbs.on('lamp');
        }
        else if (lampState && afterLampOff){
            console.log('Turn off lamp at ' + format(date));
            lampForced = false;
            bulbs.off('lamp');
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

async function doOpen(uri, response){
    if (/open[0-9]+/.test(uri)){
        let time = uri.match(/open([0-9]+)/)[1];
        console.log((!response ? 'Button' : 'App') + ' open ' + time + ' command received at ' + new Date());
        let msg = await tessel.post('open' + time);
        console.log('Tessel replies: ' + msg);
        if (response) reply(response, msg);        
    }
    else {
        console.log('Open indefinitely command received at ' + new Date());
        let msg = tessel.post('open0');
        console.log('Tessel replies: ' + msg);
        if (response) reply(response, msg);
    }

    if (SunTimes.isNight()){
        bulbs.on('outside', 180, 'garage opened at night');
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
    let req = request.method + ' ' + request.url;
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

            if (SunTimes.isNight())
                bulbs.on('outside', 180);

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
                doOpen(request.url, response);
                return 200;
            }
            else {
                console.log('401 on open at ' + new Date());
                return 401;
            }
        }
        if (req == 'GET /time'){ // call from user
            let sun = SunTimes.get();
            return {
                is_night: SunTimes.isNight(), 
                sunrise: format(sun.sunrise, true),
                sunset: format(sun.sunset, true),
                lampOn: format(sun.lampOn, true),
                lampOff: format(sun.lampOff, true),
                current: format(new Date(), true)
            };
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

            state.is_night = SunTimes.isNight();
            state.bulbs = await bulbs.getState();
            return state;
        }
        if (req == 'POST /garage'){
            let newState = await bulbs.toggle('garage', req);
            return `Toggled garage to ${newState}.`;
        }
        if (req == 'POST /home' || req == 'GET /home'){ 
            console.log("Nest reports people coming home at " + new Date());
            /*exec('/home/felix/bin/snapshot.sh', function callback(error, stdout, stderr){
                if (error) console.log("Failed to save snapshot. " + error);
            });*/

            reply(response, "Got it.");
        }
    
        let [u, meth, light] = req.match(/(POST|GET) \/light\/([a-z0-9]+)/);
        if (light){
            if (meth == 'GET')
                return await bulbs.getBulb(light);
            
            if (meth == 'POST'){
                if (light == 'lamp')
                    lampForced = true;

                let res = await bulbs.toggle(light, req);
                return `Toggled ${light} to ${res ? 'on' : 'off'}.`;
            }

            return 406;
        }

        console.log('Unknown URI: ' + req);
        return 404;
    } 
    catch (e){
        console.log(`Error during request ${req}: ${e}`);
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

setInterval(checkLamp, 60000);

let times = SunTimes.get(true);
console.log("Process started. Times for today:");
console.log('Current time is: ' + format(times.retrieved));
console.log('Sunrise time is: ' + format(times.sunrise));
console.log('Lamp on time is: ' + format(times.lampOn));
console.log('Sunset time is: ' + format(times.sunset));
console.log('Lamp off time is: ' + format(times.lampOff));

setInterval(async () => {
   if (!drivewayOn){
       let bulb = await bulbs.getBulb('driveway');
       if (bulb.state){
           drivewayOn = true;
           console.log(`I see the driveway on at ${format(new Date())}.`);
       }
   }
}, 60000);
