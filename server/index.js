var http = require("http"),
    url = require("url"),
    path = require("path"),
    request = require('request'),
    Wemo = require('wemo-client'),
    wemo = new Wemo(),
    dash_button = require("node-dash-button"),
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
var hueAddress = 'http://192.168.0.107/api/' + hueKey + '/lights';

var lampClient;

console.log("Process started at " + new Date());

function reply(res, msg){
    if (typeof msg == 'number'){
        res.writeHead(msg);
    }
    else if (typeof msg == 'object'){
        res.writeHead(200);
        res.write(JSON.stringify(msg));
    }
    else if (typeof msg == 'string'){
        res.writeHead(200);
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
    var uri = url.parse(req.url).pathname; 

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

        console.log('Tessel reports opened ' + t + ' state at ' + new Date());
        reply(response, "opened alert received");
    }
    else if (uri == '/closed'){ // call from tessel
        console.log('Tessel reports closed state at ' + new Date());
        reply(response, "closed alert received");
    }
    else if (uri == '/close'){ // call from user
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
        doOpen(req.url, false);
    }
    else if (uri == '/state'){ // call from user
        callTessel('state', function(state){
            //console.dir(state);
            reply(response, state);
        });
    }
    else if (uri == '/lamp'){
        handleWemo(toggleLamp);
        reply(response, 'Toggling lamp.');
    }
    else if (uri == '/home'){ 
        console.log("Nest home at " + new Date());
        exec('/home/felix/bin/snapshot.sh', function callback(error, stdout, stderr){
            if (error) console.log("Failed to save snapshot. " + error);
        });

        reply(response, "Got it.");
    }
    else {
        console.log('Unknown URI: ' + uri);
        reply(response, 404);
    }
}).listen(8888);

dash.on("detected", function (dash_id) {
    doOpen('/open10', true);
});

function doOpen(uri, skipAuth){
    if (skipAuth || new RegExp('auth=' + authKey).test(uri)){
        if (/open[0-9]+/.test(uri)){
            var time = uri.match(/open([0-9]+)/)[1];
            console.log((skipAuth ? 'Button' : 'App') + ' open ' + time + ' command received at ' + new Date());
            callTessel('open' + time, function(msg){
                console.log('Tessel replies: ' + msg);
                reply(response, msg);
            });
        }
        else {
            console.log('Open indefinitely command received at ' + new Date());
            callTessel('open0', function(msg){
                console.log('Tessel replies: ' + msg);
                reply(response, msg);
            });
        }

        if (isNight())
            handleHue({breezeway: 180, garage: 180});
    }
    else {
        console.log('401 on open at ' + new Date());
        reply(response, 401);
    }
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

function handleHue(ops){
    for (var kind in ops){
        if (ops.hasOwnProperty(kind)){
            var state = ops[kind];
            var bulb = kind == 'garage' ? 1 : 2;
            if (typeof state == 'number'){
                hueRequest(bulb, true, state * 1000);
            }
            else {
                hueRequest(bulb, state);
            }
        }
    }
}

function hueRequest(bulb, on, timeout){
    console.log(hueAddress + '/' + bulb + '/state');
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

function handleWemo(action){
    withLampClient(function(client){
        action(client);
    });
}

function withLampClient(action, attempt){
    if (lampClient){
        try {
            action(lampClient);
        } catch (e){
            lampClient = null;
            withLampClient(action, attempt);
        }

        return;
    }

    attempt = attempt || 0;
    wemo.discover(function(deviceInfo){
        try {
            if (lampClient) return;

            if (deviceInfo) console.log("Attempt " + attempt + ": discovered device " + deviceInfo.friendlyName);

            if (deviceInfo && deviceInfo.friendlyName == 'Lamp'){
                lampClient = wemo.client(deviceInfo);
                action(lampClient);
            }
            /*else if (attempt < 10){
                handleWemo(action, attempt + 1);
            }
            else {
                console.log("Could not find lamp after several attempts.");
            }*/
        } 
        catch (e){
            console.log("Can't discover devices: " + e);
        }
    });
}

function turnOnLamp(client){ setLampState(client, 1); }
function turnOffLamp(client){ setLampState(client, 0); }
function toggleLamp(client){ setLampState(client); }
function setLampState(client, newState){
    try {
        client.getBinaryState(function(err, state){
            if (err) {
                console.log("Error getting lamp state: " + err);
                lampClient = null;
            }
            else if (!newState){
                console.log("Toggling lamp state from " + state + ".");
                client.setBinaryState(state == 0 ? 1 : 0);
            }
            else if (state != newState){
                console.log("Setting lamp to state " + newState + ".");
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
    return date.getHours() < 7 || date.getHours() > 18;
}
