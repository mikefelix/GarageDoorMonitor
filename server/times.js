let suncalc = require("suncalc"),
    moment = require('moment-timezone'),
    log = require('./log.js')("Times"),
    format = require('./format.js');

function get(formatted){
    let tz = 'America/Denver'; // Was I using this?
    let now = moment();
    let times = suncalc.getTimes(now, 40.7608, -111.891);
    
    let sr = moment(Date.parse(times.sunrise));
    sr.date(now.date());
    let sunrise = new Date(sr); 

    let ss = moment(Date.parse(times.sunsetStart));
    ss.date(now.date());
    let sunset = new Date(ss);

    let fourAm = moment().startOf('day').add(4, 'hours').toDate();
    now = now.toDate();

    return {
        current: formatted ? format(now) : now,
        today: dayNames[dayNum()],
        todayNum: dayNum(),
        isNight: now.getTime() < sunrise || now.getTime() > sunset,
        sunrise: formatted ? format(sunrise) : sunrise,
        sunset: formatted ? format(sunset) : sunset,
        dayReset: formatted ? format(fourAm) : fourAm
    };
}

const dayNames = [
    'monday_odd', 'tuesday_odd', 'wednesday_odd', 'thursday_odd', 'friday_odd', 'saturday_odd', 'sunday_odd',
    'monday_even', 'tuesday_even', 'wednesday_even', 'thursday_even', 'friday_even', 'saturday_even', 'sunday_even'
];

const simpleTimeRegex = /^([0-9]+):([0-9]+)$/;
const tomorrowTimeRegex = /^\+([0-9]+):([0-9]+)$/;
const modifiedTimeRegex = /^([0-9]+):([0-9]+)([-+])([0-9]+)$/;
const namedTimeRegex = /^([a-z][a-z0-9_]*)$/;
const modifiedNamedTimeRegex = /^([a-z0-9_]+)([-+])([0-9]+)$/;

function dateFromNow(formatted, unit, num){
    let date = moment().startOf('day').add(num, unit);
    return formatted ? format(date, 'HH:mm') : date;
}

function dayNum(plus, date){
    date = moment(date).startOf('day').add(plus || 0, 'days');;
    return (Math.floor(date / 8.64e7) - 18015) % 14;
}

function dayName(){
    return dayNames[dayNum()];
}

function toHoursAndMinutes(text){
    return format(parse(text), 'HH:mm');
}

function parse(date){
    if (!date) return undefined;

    if (typeof date != 'string'){
        log(1, `Cannot parse date of type ${typeof date}: ${JSON.stringify(date)}`);
        return undefined;
    } 

    try {
        let text, hour, min, op = '+', plus = 0;
        if (simpleTimeRegex.test(date)){
            [text, hour, min] = date.match(simpleTimeRegex);
            return moment().startOf('day').add(hour, 'hours').add(min, 'minutes').toDate();
        }
        else if (tomorrowTimeRegex.test(date)){
            [text, hour, min] = date.match(tomorrowTimeRegex);
            return moment().startOf('day').add(1, 'day').add(hour, 'hours').add(min, 'minutes').toDate();
        }
        else if (modifiedTimeRegex.test(date)){
            let op, plus;
            [text, hour, min, op, plus] = date.match(modifiedTimeRegex);
            return moment().startOf('day').add(hour, 'hours').add(min, 'minutes')
                .add((op == '-' ? -1 : 1) * plus, 'minutes').toDate();
        }
        else if (namedTimeRegex.test(date)){
            let sunTimes = get();
            let [d, name] = date.match(namedTimeRegex);
            let time = sunTimes[name];
            if (!time)
                return undefined;

            return moment(time).toDate();
        }
        else if (modifiedNamedTimeRegex.test(date)){
            let op, plus, name, sunTimes = get();
            [text, name, op, plus] = date.match(modifiedNamedTimeRegex);
            time = sunTimes[name];
            if (!time)
                throw `Unknown named time "${name}"`;

            return moment(time)
                .add((op == '-' ? -1 : 1) * plus, 'minutes').toDate();
        }
        else {
            return undefined;
        }
    }
    catch (e){
        throw `Cannot parse date ${date}: ${e}`;
    }

    throw `Cannot parse date ${date}`;
} 

function isBetween(start, end, time){
    if (!time) 
        time = moment();

    if (typeof time != 'string')
        time = format(moment(time), "HH:mm");

    if (!/[0-9]{2}:[0-9]{2}/.test(time))
        throw `time ${time} must be of the format 00:00`;
    if (!/[0-9]{2}:[0-9]{2}/.test(start))
        throw `start time ${start} must be of the format 00:00`;
    if (!/[0-9]{2}:[0-9]{2}/.test(end))
        throw `end time ${end} must be of the format 00:00`;

    let [hours, minutes] = time.split(':');
    let [startHours, startMinutes] = start.split(':');
    let [endHours, endMinutes] = end.split(':');
    
    let afterStart = startHours == hours ? startMinutes <= minutes : startHours < hours;
    let beforeEnd = endHours == hours ? endMinutes > minutes : endHours > hours;
    log.debug(`${time} afterStart ${start}: ${afterStart}`);
    log.debug(`${time} beforeEnd ${end}: ${beforeEnd}`);

    if (startHours > endHours) { // nighttime range
        return afterStart || beforeEnd;
    }
    else {
        return afterStart && beforeEnd;
    }
}

function inRange(range){
}

function currentTimeIs(time){
    if (typeof time != 'string') {
        log.error('currentTimeIs needs a HH:mm time. Not ' + typeof time);
        log.error(time);
        return false;
    }

    let now = moment();
    let nowMinute = now.minute();
    let nowHour = now.hour();

    if (!time) {
        log.error('Cannot match time ' + time);
        return false;
    }

    if (time.match && time.match(/^[0-9]+:[0-9]+$/)){
        let [a, h, m] = time.match(/([0-9]+):([0-9]+)/);
        return nowMinute == m && nowHour == h;
    }
    else {
        let then = moment(time);
        return nowMinute == then.minute() && nowHour == then.hour();
    }
}

function currentTimeAtOrAfter(time){
    if (typeof time != 'string' || !time.match(/^[0-9]+:[0-9]+$/)) {
        log.error('currentTimeIs needs a HH:mm time. Not ' + typeof time);
        log.error(time);
        return false;
    }

    let [a, hour, minute] = time.match(/([0-9]+):([0-9]+)/);
    let [b, nowHour, nowMinute] = dateFromNow(true, 'minutes', 0).match(/([0-9]+):([0-9]+)/);

    hour = +hour; nowHour = +nowHour; minute = +minute; nowMinute = +nowMinute;
    if (hour < 3) hour = hour + 24;
    if (nowHour < 3) nowHour = nowHour + 24;

    return (nowHour > hour) || (nowHour == hour && nowMinute >= minute);
}

module.exports = { 
    get, 
    parse, 
    dayNum,
    dayName,
    isBetween, 
    toHM: toHoursAndMinutes,
    currentTimeIs,
    currentTimeAtOrAfter,
    getDate: {
        current: dateFromNow.bind(null, false, 'minutes', 0),
        minutesFromNow: dateFromNow.bind(null, false, 'minutes'),
        hoursFromNow: dateFromNow.bind(null, false, 'hours'),
        daysFromNow: dateFromNow.bind(null, false, 'days')
    },
    getHM: {
        current: dateFromNow.bind(null, true, 'minutes', 0),
        minutesFromNow: dateFromNow.bind(null, true, 'minutes'),
        hoursFromNow: dateFromNow.bind(null, true, 'hours'),
        daysFromNow: dateFromNow.bind(null, true, 'days')
    }
};
