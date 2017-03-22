var http = require("http"),
    url = require("url"),
    path = require("path"),
    request = require('request'),
    Wemo = require('wemo-client'),
    wemo = new Wemo(),
    dash_button = require("node-dash-button"),
    suncalc = require("suncalc"),
    exec = require('child_process').exec;

if (!process.argv[4]){
    console.log("Usage:\nnode garage.js PORT EMAIL TESSEL_URL");
    throw "Invalid usage";
}

var garageButtonMac = "50:f5:da:90:d1:fa";
var dash = dash_button([garageButtonMac]);
var port = process.argv[2]; 
var emailAddress = process.argv[3];
var tesselAddress = process.argv[4];
var authKey = process.argv[5];
var hueKey = process.argv[6];
var pushoverKey = process.argv[7];
var hueAddress = 'http://192.168.0.115/api/' + hueKey + '/lights';
var currentWeatherUri = 'http://mozzarelly.com/weather/current';
var lampForced = false;

var wemoClient = {};
var hueBulbs = {
    garage: 1,
    breezeway: 2
};

checkLamp();

console.log("Process started.");

function checkLamp(){
    var date = new Date();
    var sunTimes = getSunTimes();

    if (lampForced && date.getHours() == 4){
        lampForced = false;
    }

    withWemoClient('Lamp', function(lampClient){
        lampClient.getBinaryState(function(lampErr, lampState){
            var afterSunset = (date.getTime() > sunTimes.lampOn.getTime());
            var afterSunrise = (date.getTime() > sunTimes.lampOff.getTime());
            lampState = lampState == 1 ? true : false;

            if (lampErr) {
                console.log(lampErr);
            }
            else if (lampForced){
                console.log('Leaving the lamp alone for now.');
            }
            else if (!lampState && afterSunset){
                console.log('Turn on lamp at ' + date);
                lampForced = false;
                handleWemo('Lamp', turnOnWemoDevice);
            }
            else if (lampState && afterSunrise){
                console.log('Turn off lamp at ' + date);
                lampForced = false;
                handleWemo('Lamp', turnOffWemoDevice);
            }
        });
    });

    setTimeout(checkLamp, 60000);
}

function getSunTimes(){
    var date = new Date();
    var times = suncalc.getTimes(date, 40.7608, -111.891);
    var elevenPm = date;
    elevenPm.setHours(23);
    elevenPm.setMinutes(30);

    return {
        sunrise: times.sunrise, 
        sunset: times.sunsetStart,
        lampOn: new Date(times.sunsetStart.getTime() - (1000 * 60 * 20)),
        lampOff: elevenPm
    };
}

function reply(res, msg){
    var headers = {
        'Content-type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    };

    if (typeof msg == 'number'){
        res.writeHead(msg, headers);
    }
    else if (typeof msg == 'object'){
        res.writeHead(200, headers);
        res.write(JSON.stringify(msg));
    }
    else if (typeof msg == 'string'){
        res.writeHead(200, headers);
        res.write(msg);
    }

    res.end();
}

function mail(subj, body){
    var cmd = 'echo "' + body + '" | /usr/bin/mail -s "' + subj + '" ' + emailAddress;

    exec(cmd, function callback(error, stdout, stderr){
        if (error) console.log("Failed to mail. " + error);
    });
}

process.on('uncaughtException', function (err) {
    console.error((new Date).toUTCString() + ' uncaughtException:', err.message);
    console.error(err.stack);
});

http.createServer(function(req, response) {
    var uri = req.url;

    if (uri == '/warn1'){
        console.log("Send warning 1 at " + new Date());
        //mail("Garage left open", "The garage has been open for too long. Shutting it.");
        reply(response, "OK");
    }
    else if (uri == '/warn2'){
        console.log("Send warning 2 at " + new Date());
        mail("Garage failed to close", "Garage didn't shut when I tried. Trying again.");
        reply(response, "OK");
    }
    else if (uri == '/warn3'){
        console.log("Send warning 3 at " + new Date());
        mail("Garage is stuck open!", "Garage is open and I cannot shut it! I tried twice.");
        reply(response, "OK");
    }
    else if (uri == '/alive'){ // ping from tessel
        console.log("Tessel reports that it is alive at " + new Date());
        reply(response, "Yay!");
    }
    else if (uri.match(/^\/opened/)){ // call from tessel
        var t = 'indefinitely';
        if (uri.match(/[0-9]+/))
            t = uri.match(/[0-9]+/)[0];

        handleHue({breezeway: 180, garage: 180}, true);

        console.log('Tessel reports opened ' + t + ' state at ' + new Date());
        reply(response, "opened alert received");
    }
    else if (uri == '/closed'){ // call from tessel
        console.log('Tessel reports closed state at ' + new Date());
        reply(response, "closed alert received");
    }
    else if (uri.match(/^\/close/)){ // call from user
        if (new RegExp('auth=' + authKey).test(req.url)){
            console.log('Close command received at ' + new Date());
            callTessel('close', function(msg){
                console.log('Tessel replies: ' + msg);
                reply(response, msg);
            });
        }
        else {
            console.log('401 on close command at ' + new Date());
            reply(response, 401);
        }
    }
    else if (uri.match(/^\/open/)){ // call from user
        if (new RegExp('auth=' + authKey).test(uri)){
            doOpen(req.url, response);
            reply(response, 200);
        }
        else {
            console.log('401 on open at ' + new Date());
            reply(response, 401);
        }
    }
    else if (uri == '/time'){ // call from user
        var sun = getSunTimes();
        var state = {
            is_night: isNight(), 
            sunrise: sun.sunrise,
            sunset: sun.sunset,
            current: new Date()
        };
        reply(response, state);
    }
    else if (uri == '/state'){ // call from user
        callTessel('state', function(tesselState){
            var state = JSON.parse(tesselState);
            state.is_night = isNight();
            withHueState(function(err, hueState){
                state.bulbs = err ? {hueError: err} : hueState;
                withWemoClient('Lamp', function(lampClient){
                    withWemoClient('Aquarium', function(aquaClient){
                        lampClient.getBinaryState(function(lampErr, lampState){
                            aquaClient.getBinaryState(function(aquaErr, aquaState){
                                state.bulbs.lamp = lampErr ? lampErr : (lampState == 1);
                                state.bulbs.aquarium = aquaErr ? aquaErr : (aquaState == 1);

                                reply(response, state);
                            });
                        });
                    });
                });
            });
        });
    }
    else if (uri == '/aquarium'){
        handleWemo('Aquarium', toggleWemoDevice);
        reply(response, 'Toggling aquarium.');
    }
    else if (uri == '/lamp'){
        lampForced = true;
        handleWemo('Lamp', toggleWemoDevice);
        reply(response, 'Toggling lamp.');
    }
    else if (uri == '/breezeway'){
        handleHue({'breezeway': true});
        reply(response, "Toggled breezeway.");
    }
    else if (uri == '/garage'){
        handleHue({'garage': true});
        reply(response, "Toggled garage.");
    }
    else if (uri == '/home'){ 
        console.log("Nest home at " + new Date());
        exec('/home/felix/bin/snapshot.sh', function callback(error, stdout, stderr){
            if (error) console.log("Failed to save snapshot. " + error);
        });

        reply(response, "Got it.");
    }
    else if (uri.match(/^\/light/)){ // call from user
        if (/light_[a-z0-9]+/.test(uri)){
            var light = uri.match(/light_([a-z0-9]+)/)[1]; 
            if (light == 'breezeway' || light == 'garage'){
                toggleHueBulb(hueBulbs[light]);
                reply(response, 200);
            }
            else if (light == 'aquarium' || light == 'lamp'){
                handleWemo(light.substring(0, 1).toUpperCase() + light.substring(1), toggleWemoDevice);
                reply(response, 200);
            }
            else {
                reply(response, 404);
            }
        }
        else {
            reply(response, 404);
        }
    }
    else {
        console.log('Unknown URI: ' + uri);
        reply(response, 404);
    }
}).listen(8888);

dash.on("detected", function (dashId) {
    console.log("Detected connection by " + dashId);
    callTessel('state', function(state){
        if (!state) {
            console.log("No state retrieved.");
        }
        else if (state.is_open){
            console.log("Closing for dash");
            callTessel('close', function(){});
        }
        else {
            console.log("Opening for dash");
            doOpen('/open10');
        }
    });
});

function doOpen(uri, response){
    if (/open[0-9]+/.test(uri)){
        var time = uri.match(/open([0-9]+)/)[1];
        console.log((!response ? 'Button' : 'App') + ' open ' + time + ' command received at ' + new Date());
        callTessel('open' + time, function(msg){
            console.log('Tessel replies: ' + msg);
            if (response) reply(response, msg);
        });
    }
    else {
        console.log('Open indefinitely command received at ' + new Date());
        callTessel('open0', function(msg){
            console.log('Tessel replies: ' + msg);
            if (response) reply(response, msg);
        });
    }

    handleHue({breezeway: 180, garage: 180}, true);
}

function callTessel(uri, callback){
    try {
        request(tesselAddress + '/' + uri, function(err, res, body){
            if (err){
                callback("Error: " + err);
            }
            else {
                callback(body);
            }
        });
    }
    catch (e) {
        console.log("Could not communicate with Tessel: " + e);
    }
}

function handleHue(ops, ifNight){
    console.log('Handle hue lights' + (ifNight ? ' if it is night' : '') + '.');
    if (!ifNight || isNight()){
        for (var kind in ops){
            if (ops.hasOwnProperty(kind)){
                var state = ops[kind];
                var bulb; 
                if (kind == 'garage')
                    bulb = 1;
                else if (kind == 'breezeway')
                    bulb = 2;
                else
                    throw 'Unknown light ' + kind;

                if (typeof state == 'number'){
                    hueRequest(bulb, true, state * 1000);
                }
                else {
                    hueRequest(bulb, state);
                }
            }
        }
    }
}

function withHueState(cb){
    request.get({
      headers: {'content-type' : 'application/json'},
      url: hueAddress + '/1'
    }, function(err1, res1, body1){
        if (err1){
            console.log("Error getting garage bulb state: " + err1);
            cb(err1);
        } 
        else {
            var on1 = body1 && /"on": ?true/.test(body1);
            request.get({
                headers: {'content-type' : 'application/json'},
                url: hueAddress + '/2'
            }, function(err2, res2, body2){
                if (err2){
                    console.log("Error getting garage bulb state: " + err2);
                    cb(err2);
                }

                var on2 = body2 && /"on": ?true/.test(body2);
                cb(null, {garage: on1, breezeway: on2});
            });
        }
    });
}

function toggleHueBulb(bulb) {
    request.get({
      headers: {'content-type' : 'application/json'},
      url: hueAddress + '/' + bulb
    }, function(err, res, body){
        if (err){
            console.log("Error getting bulb state: " + err);
        } 
        else {
            var on = body && /"on": ?true/.test(body);
            hueRequest(bulb, !on);
        }
    });
}

function hueRequest(bulb, on, timeout){
    console.log('Setting bulb ' + bulb + ' to ' + (on ? 'on' : 'off') + ' at ' + new Date());
    request.put({
          headers: {'content-type' : 'application/json'},
          url:     hueAddress + '/' + bulb + '/state',
          body:    JSON.stringify({on:on})
    }, function(err, res, body){
       if (err){
           console.log('Hue error: ' + err);
       }
       else if (timeout){
           setTimeout(function(){hueRequest(bulb, false)}, timeout);
       }
    });
}

function handleWemo(device, action){
    withWemoClient(device, function(client){
        action(client);
    });
}

function withWemoClient(device, action, attempt){
    if (wemoClient[device]){
        try {
            action(wemoClient[device]);
        } catch (e){
            delete wemoClient[device];
            withWemoClient(device, action, attempt);
        }

        return;
    }

    attempt = attempt || 0;
    wemo.discover(function(deviceInfo){
        try {
            if (deviceInfo) 
                console.log("Attempt " + attempt + ": discovered device " + deviceInfo.friendlyName);

            if (deviceInfo && deviceInfo.friendlyName == device){
                wemoClient[device] = wemo.client(deviceInfo);
                action(wemoClient[device]);
            }
        } 
        catch (e){
            console.log("Can't discover devices: " + e);
        }
    });
}

function turnOnWemoDevice(client){ setWemoState(client, 1); }
function turnOffWemoDevice(client){ setWemoState(client, 0); }
function toggleWemoDevice(client){ setWemoState(client); }
function setWemoState(client, newState){
    try {
        client.getBinaryState(function(err, state){
            if (err) {
                console.log("Error getting wemo state: " + err);
                delete wemoClient[device];
            }
            else if (newState === undefined){
                console.log("Toggling wemo state from " + state + ".");
                client.setBinaryState(state == 0 ? 1 : 0);
            }
            else if (state != newState){
                console.log("Setting wemo to state " + newState + ".");
                client.setBinaryState(newState);
            }
            else console.log("Lamp was already in state " + newState + ".");
        });
    }
    catch (e) {
        console.log("Can't communicate with Wemo: " + e);
    }
}

function isNight(){
    var date = new Date();
    var times = getSunTimes();
    var sunrise = times.sunrise;
    var sunset = times.sunset;

    //console.log('sunrise: ' + sunrise);
    //console.log('sunset: ' + sunset);
    //console.log('now: ' + date);

    if (date < sunrise || date > sunset){
        //console.log('I conclude that it is night.');
        return true;
    }
    else {
        //console.log('I conclude that it is day.');
        return false;
    }
}
