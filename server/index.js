var http = require("http"),
    url = require("url"),
    path = require("path"),
    request = require('request'),
    wemo = require('wemo-client'),
    exec = require('child_process').exec;

if (!process.argv[4]){
    console.log("Usage:\nnode garage.js PORT EMAIL TESSEL_URL");
    throw "Invalid usage";
}

var port = process.argv[2]; 
var emailAddress = process.argv[3];
var tesselAddress = process.argv[4];
var authKey = process.argv[5];

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
        if (new RegExp('auth=' + authKey).test(req.url)){
            if (/open[0-9]+/.test(uri)){
                var time = uri.match(/open([0-9]+)/)[1];
                console.log('Open ' + time + ' command received at ' + new Date());
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

            handleLights();
        }
        else {
            console.log('401 on open at ' + new Date());
            reply(response, 401);
        }
    }
    else if (uri == '/state'){ // call from user
        callTessel('state', function(state){
            //console.dir(state);
            reply(response, state);
        });
    }
    else if (uri == '/home'){ 
        console.log("Nest home at " + new Date());
        exec('/home/felix/bin/snapshot.sh', function callback(error, stdout, stderr){
            if (error) console.log("Failed to save snapshot. " + error);
        });

        reply(response, "Got it.");
    }
    else {
        reply(response, 404);
    }
}).listen(8888);

function callTessel(uri, callback){
  request(tesselAddress + '/' + uri, function(err, res, body){
      if (err){
          callback("Error: " + err);
      }
      else {
          callback(body);
      }
  });
}

function handleLights(){
    for (var i = 0; i < 5; i++){
        wemo.discover(function(deviceInfo){
            if (deviceInfo) console.log(i + ": discovered device " + deviceInfo.friendlyName);
            if (deviceInfo && deviceInfo.friendlyName == 'Lamp'){
                i = 5;
                var client = wemo.getClient(deviceInfo);
                client.getBinaryState(function(err, state){
                    if (err) {
                        console.log("Error getting lamp state: " + err);
                    }
                    else if (state == 0){
                        console.log("Turning on lamp.");
                        client.setBinaryState(1);
                    }
                    else console.log("Lamp wasn't off.");
                });
            }
        });
    }
}

