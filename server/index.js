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

http.createServer(function(req, response) {
    var uri = url.parse(req.url).pathname; 

    if (uri == '/warn'){
        var cmd = 'echo "Garage is open!" | /usr/bin/mail -s "Garage is open!" ' + emailAddress;
        exec(cmd, function callback(error, stdout, stderr){
            if (error) console.log("Failed to mail. " + error);
        });

        reply(response, "OK");
    }
    else if (uri == '/alive'){ // ping from tessel
        console.log("Tessel is alive at " + new Date());
        reply(response, "Yay!");
    }
    else if (uri == '/open'){ // call from tessel
        console.log('open');
        reply(response, "open alert sent");
    }
    else if (uri == '/closed'){ // call from tessel
        console.log('closed');
        reply(response, "closed alert sent");
    }
    else if (uri == '/climate'){ // call from user
        callTessel('climate', function(msg){
            reply(response, msg);
        });
    }
    else if (uri == '/state'){ // call from user
        callTessel('state', function(msg){
            reply(response, msg);
        });
    }
    else if (uri == '/stats'){ // call from user
        callTessel('state', function(stateMsg){
            callTessel('climate', function(climateMsg){
                reply(response, "Garage is " + stateMsg + ".\n" + climateMsg);
            });
        });
    }
    else if (uri == '/home'){ // call from tessel
        console.log("Nest home.");
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

