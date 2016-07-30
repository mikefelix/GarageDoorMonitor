var http = require("http"),
    url = require("url"),
    path = require("path"),
    request = require('request'),
    exec = require('child_process').exec;

if (!process.argv[4]){
    console.log("Usage:\nnode garage.js PORT EMAIL TESSEL_URL");
    throw "Invalid usage";
}

var port = process.argv[2]; 
var emailAddress = process.argv[3];
var tesselAddress = process.argv[4];

function reply(res, msg){
    if (typeof msg == 'number'){
        res.writeHead(msg);
    }
    else if (typeof msg == 'string'){
        res.writeHead(200);
        res.write(msg);
    }

    res.end();
}

function auth(token){
  return token == 'bubblicious';
}

function mail(subj, body){
    var cmd = 'echo "' + subj + '" | /usr/bin/mail -s "' + body + '" ' + emailAddress;

    exec(cmd, function callback(error, stdout, stderr){
        if (error) console.log("Failed to mail. " + error);
    });
}

http.createServer(function(req, response) {
    var uri = url.parse(req.url).pathname; 

    if (uri == '/warn1'){
        mail("Garage left open", "The garage has been open for too long. Shutting it.");
        reply(response, "OK");
    }
    if (uri == '/warn2'){
        mail("Garage failed to close", "Garage didn't shut when I tried. Trying again.");
        reply(response, "OK");
    }
    if (uri == '/warn3'){
        mail("Garage is stuck open!", "Garage is open and I cannot shut it! I tried twice.");
        reply(response, "OK");
    }
    else if (uri == '/alive'){ // ping from tessel
        console.log("Tessel is alive at " + new Date());
        reply(response, "Yay!");
    }
    else if (uri == '/opened'){ // call from tessel
        console.log('opened');
        reply(response, "open alert received");
    }
    else if (uri == '/closed'){ // call from tessel
        console.log('closed');
        reply(response, "closed alert received");
    }
    else if (uri == '/close'){ // call from user
        if (/auth=gungeon/.test(req.url)){
            callTessel('close', function(msg){
                reply(response, msg);
            });
        }
        else {
            reply(response, 401);
        }
    }
    else if (uri == '/open'){ // call from user
        if (/auth=gungeon/.test(req.url)){
            if (/force=true/.test(req.url)){
                callTessel('forceopen', function(msg){
                    reply(response, msg);
                });
            }
            else {
                callTessel('open', function(msg){
                    reply(response, msg);
                });
            }
        }
        else {
            reply(response, 401);
        }
    }
    else if (uri == '/state'){ // call from user
        callTessel('state', function(msg){
            reply(response, msg);
        });
    }
    else if (uri == '/home'){ // call from tessel
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

