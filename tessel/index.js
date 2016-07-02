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

var WAIT_UNTIL_ALERT = 600; //seconds
var ALERT_BASE_URL = "http://192.168.0.101/garage/";

var lastX = 0, lastY = 0, lastZ = 1;
var currX = 0, currY = 0, currZ = 1;
var counter = 0;
var alertTimer;

function isOpen(){
    return currZ != 0;
}

function stateHasChanged(){
    return currZ != lastZ;
}

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

function sendAlert(alert){
    console.log("Send " + alert);
    request({
        uri: ALERT_BASE_URL + alert,
        method: "POST",
        timeout: 10000,
        followRedirect: true,
        maxRedirects: 10
    }, function(error, response, body) {
        if (error)
          console.log("Error: " + error);
    });
}

function stateChange(){
    var open = isOpen();
    sendAlert(open ? "open" : "closed");

    if (open){
        if (!alertTimer) {
            alertTimer = setTimeout(function () {
                sendAlert("warn");
            }, WAIT_UNTIL_ALERT * 1000);
        }
    }
    else {
        if (alertTimer) {
            clearTimeout(alertTimer);
            alertTimer = null;
        }
    }
};

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
    if (counter == 1800)
        counter = 0;

    if (counter == 0)
        sendAlert('alive');

    counter++;

    if (stateHasChanged())
        stateChange();

    lastX = currX;
    lastY = currY;
    lastZ = currZ;

}, 3000);

http.createServer(function(request, response){
  var uri = url.parse(request.url).pathname;
  if (uri == '/state'){
      reply(response, isOpen() ? "open" : "closed");
  }
  else if (uri == '/climate'){
      climate.readTemperature('f', function (err, temp) {
          climate.readHumidity(function (err, humid) {
              reply(response, 'Temp: ' + temp.toFixed(1) + 'F' + ', Hum: ' + humid.toFixed(1) + '%');
          });
      });
  }
  else if (uri == '/pulse'){
      relay.toggle(1, function (err) {
          if (err) {
              console.log("Err toggling relay.", err);
              reply(response, 'Error toggling relay.');
          }
          else {
              setTimeout(function(){
                  relay.toggle(1, function (err) {
                      if (err) {
                          console.log("Err toggling relay.", err);
                          reply(response, 'Error toggling relay.');
                      }
                      else {
                          reply(response, 'toggled');
                      }
                  });
              }, 500);
          }
      });
  }
  else {
      reply(response, 404);
  }
}).listen(8888);
