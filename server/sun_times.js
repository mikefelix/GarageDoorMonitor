var suncalc = require("suncalc");
var moment = require('moment-timezone');
var format = require('./format.js');

function isNight(log){
    let date = new Date();
    let times = getSunTimes(log);
    let sunrise = times.sunrise;
    let sunset = times.sunset;

    if (date.getTime() < sunrise || date.getTime() > sunset){
        if (log) console.log('I conclude that it is night.');
        return true;
    }
    else {
        if (log) console.log('I conclude that it is day.');
        return false;
    }
}

function getSunTimes(){
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

    return ret;
}

module.exports = {
    get: getSunTimes,
    isNight: isNight
};
