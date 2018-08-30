const http = require("http"),
      path = require("path"),
      util = requre('util'),
      exec = util.promisify(require('child_process').exec),
      request = require('request');

let playing = false;

const routes = {
    'POST /go': () => {
        playing = true;
        return 200;
    },
    'POST /stop': () => {
        playing = false;
        return 200;
    }
}

async function play(){
    try {
        if (playing){
            let res = await exec('omxplayer -o local alarm.mp3');
            console.log('Played alarm at ' + new Date());
        }

        setTimeout(play, 1000);
    }
    catch (err){
        console.log('Failed. ' + err);
        process.exit(1);
    }
};

async function handleRequest(request, response){
    let req = request.method + ' ' + request.url.replace(/\?.*$/, '');

    try {
        for (let route in routes){
            let match;
            if (match = req.match(new RegExp(route))){
                let args = [request];
                for (let i = 1; match.hasOwnProperty(i); i++){ 
                    args.push(match[i]);
                }

                return await routes[route].apply(null, args);
            }
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
        res.end();
    }
    else if (msg === false){
        res.writeHead(500, headers);
        res.end();
    }
    else if (typeof msg == 'number'){
        res.writeHead(msg, headers);
        res.end();
    }
    else if (typeof msg == 'object'){
        res.writeHead(200, headers);
        res.end(JSON.stringify(msg));
    }
    else if (typeof msg == 'string'){
        res.writeHead(200, headers);
        res.end(JSON.stringify({result:msg}));
    }
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
    handleRequest(request, response)
        .then(result => {
            reply(response, result);
        })
        .catch(err => {
            reply(response, 500);
        });
    }
}).listen(80);

console.log('Process started on 80');
