let http = require("http"),
    url = require("url"),
    format = require("./format.js"),
    path = require("path"),
    request = require('request'),
//    dash_button = require("node-dash-button"),
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
//const dash = dash_button([garageButtonMac]);
const port = process.argv[2]; 
const emailAddress = process.argv[3];
const tessel = new Tessel(process.argv[4]);
const authKey = process.argv[5];
const hueKey = process.argv[6];
const hueAddress = `http://192.168.0.115/api/${hueKey}/lights`;
const bulbs = new Bulbs(hueAddress);
const currentWeatherUri = 'http://mozzarelly.com/weather/current';

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
        bulbs.toggle('outside');
    }

    if (lampForced && date.getHours() == 4){
        lampForced = false;
    }

    let lampState = (await bulbs.getBulbState('lamp')) === 1;
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
            bulbs.on('Lamp');
        }
        else if (lampState && afterLampOff){
            console.log('Turn off lamp at ' + format(date));
            lampForced = false;
            bulbs.off('Lamp');
        }
    }

    setTimeout(checkLamp, 60000);
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
        res.end(msg);
    }

    res.end();
}

async function doOpen(uri, response){
    if (/open[0-9]+/.test(uri)){
        let time = uri.match(/open([0-9]+)/)[1];
        console.log((!response ? 'Button' : 'App') + ' open ' + time + ' command received at ' + new Date());
        let msg = await tessel.call('open' + time);
        console.log('Tessel replies: ' + msg);
        if (response) reply(response, msg);        
    }
    else {
        console.log('Open indefinitely command received at ' + new Date());
        let msg = tessel.call('open0');
        console.log('Tessel replies: ' + msg);
        if (response) reply(response, msg);
    }

    if (SunTimes.isNight()){
        bulbs.on('garage', 180);
        bulbs.on('driveway', 180);
        bulbs.on('breezeway', 180);
    }
}

/*
dash.on("detected", function (dashId) {
    console.log("Detected connection by " + dashId);
    tessel.call('state', function(state){
        if (state && typeof state == 'string'){
            state = JSON.parse(state);
        }

        if (!state) {
            console.log("No state retrieved.");
        }
        else if (state.is_open){
            console.log("Closing for dash");
            tessel.call('close', function(){});
        }
        else {
            console.log("Opening for dash");
            doOpen('/open10');
        }
    });
});
*/
process.on('uncaughtException', function (err) {
    console.error(new Date().toUTCString() + ' uncaughtException:', err.message);
    console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled promise rejection. Reason: ' + reason);
});

async function handleRequest(req){
    let uri = req.url;
    console.log('Received call at ' + format(new Date()) + ': ' + uri);

    if (uri == '/warn1'){
        return "OK";
    }
    else if (uri == '/warn2'){
        mail("Garage failed to close", "Garage didn't shut when I tried. Trying again.");
        return "OK";
    }
    else if (uri == '/warn3'){
        mail("Garage is stuck open!", "Garage is open and I cannot shut it! I tried twice.");
        return "OK";
    }
    else if (uri == '/alive'){ // ping from tessel
        console.log("Tessel reports that it is alive at " + new Date());
        return "Yay!";
    }
    else if (uri.match(/^\/opened/)){ // call from tessel
        let t = 'indefinitely';
        if (uri.match(/[0-9]+/))
            t = uri.match(/[0-9]+/)[0];

        if (SunTimes.isNight())
            bulbs.on('outside', 180);

        console.log(`Tessel reports opened ${t} state at ${new Date()}`);
        return "opened alert received";
    }
    else if (uri == '/closed'){ // call from tessel
        console.log('Tessel reports closed state at ' + new Date());
        return "closed alert received";
    }
    else if (uri.match(/^\/close/)){ // call from user
        if (new RegExp('auth=' + authKey).test(req.url)){
            console.log('Close command received at ' + new Date());
            let msg = await tessel.call('close');
            console.log('Tessel replies: ' + msg);
            return msg;
        }
        else {
            console.log('401 on close command at ' + new Date());
            return 401;
        }
    }
    else if (uri.match(/^\/open/)){ // call from user
        if (new RegExp('auth=' + authKey).test(uri)){
            doOpen(req.url, response);
            return 200;
        }
        else {
            console.log('401 on open at ' + new Date());
            return 401;
        }
    }
    else if (uri == '/time'){ // call from user
        let sun = SunTimes.get();
        let state = {
            is_night: SunTimes.isNight(), 
            sunrise: format(sun.sunrise, true),
            sunset: format(sun.sunset, true),
            lampOn: format(sun.lampOn, true),
            lampOff: format(sun.lampOff, true),
            current: format(new Date(), true)
        };

        return state;
    }
    else if (uri == '/state'){ // call from user
        let tesselState = await tessel.call('state');
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
    else if (uri == '/outside'){
        let newState = await bulbs.toggle('outside');        
        return 'Toggling outside devices to ' + newState + '.';
    }
    else if (uri == '/aquarium'){
        let newState = await bulbs.toggle('aquarium');
        return `Toggled aquarium to ${newState}.`;
    }
    else if (uri == '/lamp'){
        lampForced = true;
        let newState = await bulbs.toggle('lamp');
        return `Toggled lamp to ${newState}.`;
    }
    else if (uri == '/driveway'){
        let newState = await bulbs.toggle('driveway');
        return `Toggled driveway to ${newState}.`;
    }
    else if (uri == '/breezeway'){
        let newState = await bulbs.toggle('breezeway');
        return `Toggled breezeway to ${newState}`;
    }
    else if (uri == '/garage'){
        await bulbs.toggle('garage');
        return "Toggled garage.";
    }
    /*else if (uri == '/home'){ 
        console.log("Nest home at " + new Date());
        exec('/home/felix/bin/snapshot.sh', function callback(error, stdout, stderr){
            if (error) console.log("Failed to save snapshot. " + error);
        });

        reply(response, "Got it.");
    }*/
    else if (uri.match(/^\/light/)){ // call from user
        if (/light_[a-z0-9]+/.test(uri)){
            let light = uri.match(/light_([a-z0-9]+)/)[1];
            if (light.toLowerCase() == 'lamp')
                lampForced = true;

            if (await bulbs.toggle(light))
                return 200;
            else
                return 404;
        }
        else {
            return 404;
        }
    }
    else {
        console.log('Unknown URI: ' + uri);
        return 404;
    }
}

http.createServer((request, response) => {
    handleRequest(request)
      .then(result => {
          reply(response, result);
      })
      .catch(err => {
          console.log('Error: ' + err);
          reply(response, 500);
      });
}).listen(8888);

checkLamp();

console.log("Process started. Times for today:");
SunTimes.get(true);

