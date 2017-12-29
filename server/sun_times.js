var suncalc = require("suncalc");
var moment = require('moment-timezone');
var format = require('./format.js');

function getSunTimes(){
    let tz = 'America/Denver'; // Was I using this?
    let date = moment();
    let times = suncalc.getTimes(date, 40.7608, -111.891);
    let sr = moment(Date.parse(times.sunrise));
    sr.date(date.date());
    let sunrise = new Date(sr); 
    let ss = moment(Date.parse(times.sunsetStart));
    ss.date(date.date());
    let sunset = new Date(ss);
    let now = new Date();
    let fourAm = moment().startOf('day').add(4, 'hours');

    return {
        current: now,
        isNight: now.getTime() < sunrise || now.getTime() > sunset,
        sunrise: sunrise,
        sunset: sunset,
        dayReset: fourAm
    };
}

const simpleTimeRegex = /^([0-9]+):([0-9]+)$/;
const modifiedTimeRegex = /^([0-9]+):([0-9]+)([-+])([0-9]+)$/;
const namedTimeRegex = /^([a-z0-9_]+)$/;
const modifiedNamedTimeRegex = /^([a-z0-9_]+)([-+])([0-9]+)$/;

function parse(date){
    if (!date) return undefined;

    let text, hour, min, op = '+', plus = 0;
    if (simpleTimeRegex.test(date)){
        [text, hour, min] = date.match(simpleTimeRegex);
        return moment().startOf('day').add(hour, 'hours').add(min, 'minutes').toDate();
    }
    else if (modifiedTimeRegex.test(date)){
        let op, plus;
        [text, hour, min, op, plus] = date.match(modifiedTimeRegex);
        return moment().startOf('day').add(hour, 'hours').add(min, 'minutes')
            .add((op == '-' ? -1 : 1) * plus, 'minutes').toDate();
    }
    else if (namedTimeRegex.test(date)){
        let sunTimes = getSunTimes();
        let [d, name] = date.match(namedTimeRegex);
        let time = sunTimes[name];
        if (!time)
            throw `Unknown named time "${name}"`;

        return moment(time);
    }
    else if (modifiedNamedTimeRegex.test(date)){
        let op, plus, name, sunTimes = getSunTimes();
        [text, name, op, plus] = date.match(modifiedNamedTimeRegex);
        time = sunTimes[name];
        if (!time)
            throw `Unknown named time "${name}"`;

        return moment(time)
            .add((op == '-' ? -1 : 1) * plus, 'minutes').toDate();
    }

    throw `Cannot parse date ${date}`;
} 

module.exports = {
    get: getSunTimes,
    parse
};
