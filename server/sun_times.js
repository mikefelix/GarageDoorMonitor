var suncalc = require("suncalc");
var moment = require('moment-timezone');
var format = require('./format.js');

function getSunTimes(log){
    var tz = 'America/Denver';
    var date = moment();
    var times = suncalc.getTimes(date, 40.7608, -111.891);
    var sr = moment(Date.parse(times.sunrise));
    sr.date(date.date());
    var sunrise = new Date(sr); 
    var ss = moment(Date.parse(times.sunsetStart));
    ss.date(date.date());
    var sunset = new Date(ss);
    var lampOn = new Date(sunset.getTime() - (1000 * 60 * 30));
    var elevenThirtyPm = date.startOf('day').add(23, 'hours').add(30, 'minutes').toDate();
    //var sevenThirtyPm = date.startOf('day').add(20, 'hours').add(30, 'minutes').toDate();

    var ret = {
        retrieved: new Date(),
        sunrise: sunrise,
        sunset: sunset,
        lampOn: lampOn,//sevenThirtyPm,
        lampOff: elevenThirtyPm
    };

    if (log) {
        console.log('Current time is: ' + format(ret.retrieved));
        console.log('Sunrise time is: ' + format(ret.sunrise));
        console.log('Lamp on time is: ' + format(ret.lampOn));
        console.log('Sunset time is: ' + format(ret.sunset));
        console.log('Lamp off time is: ' + format(ret.lampOff));
    }

    return ret;
}

module.exports = {
    get: getSunTimes
};
