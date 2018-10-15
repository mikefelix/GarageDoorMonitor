// Any copyright is dedicated to the Public Domain.
// http://creativecommons.org/publicdomain/zero/1.0/

/*********************************************
This basic accelerometer example logs a stream
of x, y, and z data from the accelerometer
*********************************************/

var tessel = require('tessel');
var accel = require('accel-mma84').use(tessel.port['A']);
//var climate = require('climate-si7020').use(tessel.port['B']);
var relay = require('relay-mono').use(tessel.port['B']);

var request = require('request');
var http = require('http');
var url = require('url');

var ALERT_BASE_URL = "https://mozzarelly.com/home/";

var lastX = 0, lastY = 0, lastZ = 0;
var currX = 0, currY = 0, currZ = 0;
var closeTimer;
var keepOpen = false;
var triedToClose = 0;
var defaultAutoCloseMins = 10;
var lastOpenTime, lastCloseTime, nextCloseTime;

sendAlert('alive');

function isOpen(){
    return currZ != 0;
}

function stateHasChanged(){
    return currZ != lastZ;
}

function reply(res, msg){
    if (typeof msg == 'number'){
        res.writeHead(msg); // use number as status code, no body
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

function sendAlert(alert, body){
    console.log("Send " + alert);
    request({
        uri: ALERT_BASE_URL + alert,
        method: "POST",
        timeout: 10000,
        body: body,
        followRedirect: true,
        maxRedirects: 10
    }, function(error, response, body) {
        if (error)
          console.log("Error: " + error);
    });
}

function stateChange(){
    if (isOpen()){
        doorOpened();
    }
    else {
        doorClosed();
    }
}

function doorClosed(){
    sendAlert("closed");
    triedToClose = 0;
    lastCloseTime = new Date();
    keepOpen = false;
    resetCloseTimer();
}

function doorOpened(){
    lastOpenTime = new Date();
    if (keepOpen === false)
        keepOpen = defaultAutoCloseMins;

    sendAlert("opened" + keepOpen);
    resetCloseTimer();
};

function attemptToClose(){
    if (triedToClose == 2){
        sendAlert("warn3");
    }
    if (triedToClose == 1){
        triedToClose = 2;
        pulseRelay(function(){
            sendAlert("warn2");
        });
    }
    else {
        triedToClose = 1;
        pulseRelay(function(){
            sendAlert("warn1");
        });
    }
}

accel.on('ready', function () {
    accel.on('data', function (xyz) {
        currX = Math.round(xyz[0]);
        currY = Math.round(xyz[1]);
        currZ = Math.round(xyz[2]);
    });
});

accel.on('error', function(err){
  console.log('Error:', err);
});

setInterval(function(){
    //if (counter == 1800)
        //counter = 0;

    //if (counter == 0)
        //sendAlert('alive');

    //counter++;

    if (stateHasChanged())
        stateChange();

    lastX = currX;
    lastY = currY;
    lastZ = currZ;

}, 3000);

function pulseRelay(cb){
    relay.toggle(1, function (err) {
        if (err) {
            console.log("Error 1 toggling relay.", err);
            cb("Error 1 toggling relay. " + err);
        }
        else {
            setTimeout(function(){
                relay.toggle(1, function (err) {
                    if (err) {
                        console.log("Error 2 toggling relay.", err);
                        cb('Error 2 toggling relay. ' + err);
                    }
                    else {
                        cb('Toggled relay.');
                    }
                });
            }, 500);
        }
    });
}

function resetCloseTimer(){
    if (closeTimer) 
        clearTimeout(closeTimer);

    closeTimer = null;
    nextCloseTime = null;

    if (typeof keepOpen == 'number') {
        var wait = keepOpen * 60000;
        nextCloseTime = new Date(Date.now() + wait);
        closeTimer = setTimeout(attemptToClose, wait);
    }
};

process.on('uncaughtException', function (err) {
    let msg = 'Uncaught exception: ' + err.message + "\n";
    msg += err.stack;
    sendAlert('garage-error', msg);
});

process.on('unhandledRejection', (reason, promise) => {
    let msg = 'Unhandled promise: ' + reason + "\n";
    sendAlert('garage-error', msg);
});

process.on('warning', e => console.warn(e.stack));

http.createServer(function(request, response){
  var uri = url.parse(request.url).pathname;
  if (uri == '/state'){
      reply(response, {
          is_open: isOpen(),
          keep_open: keepOpen,
          last_open_time: lastOpenTime,
          last_close_time: lastCloseTime,
          next_close_time: nextCloseTime,
          close_attempts: triedToClose,
          current_time: new Date()
      });
  }
  /*else if (uri == '/climate'){
      climate.readTemperature('f', function (err, temp) {
          climate.readHumidity(function (err, humid) {
              reply(response, 'Temp: ' + temp.toFixed(1) + 'F' + ', Hum: ' + humid.toFixed(1) + '%');
          });
      });
  }*/
  else if (/^\/default/.test(uri)){ 
      var match = uri.match(/^\/default([0-9]*)/);
      if (match[1]){
          defaultAutoCloseMins = Math.floor(match[1]);
          reply(response, 'Set default autoclose minutes to ' + match[1]);
      }
      else {
          reply(response, 400);
      }
  }
  else if (/^\/open/.test(uri)){ 
      var match = uri.match(/^\/open([0-9]*)/);
      if (match[1] == '0'){
          keepOpen = true;
      }
      else if (match[1]){
          keepOpen = Math.floor(match[1]);
      }
      else {
          keepOpen = false;
      }
      
      if (!isOpen()){
          pulseRelay(function(msg){
              reply(response, msg + ' Opened ' + (keepOpen === true ? 'indefinitely' : keepOpen) + '.');
          });
      }
      else {
          resetCloseTimer();
          reply(response, 'Already open. Remaining open ' + (keepOpen === true ? 'indefinitely' : keepOpen) + '.');
      }
  }
  else if (uri == '/close'){
      if (isOpen()){
          keepOpen = false;
          resetCloseTimer();
          pulseRelay(function(msg){
              reply(response, msg);
          });
      }
      else {
          reply(response, 'Already closed.');
      }
  }
  else {
      reply(response, 404);
  }
}).listen(8888);
