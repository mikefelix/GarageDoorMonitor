let moment = require('moment-timezone');

/*
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
*/

function currentTimeIs(time){
    let now = moment(); 
    let nowMinute = now.minute();
    let nowHour = now.hour();

    if (time.match && time.match(/^[0-9]+:[0-9]+$/)){
        let [a, h, m] = time.match(/([0-9]+):([0-9]+)/);
        return nowMinute == m && nowHour == h;
    }
    else {
        let then = moment(time);
        return nowMinute == then.minute() && nowHour == then.hour();
    }
}

console.log('with string: ' + currentTimeIs('3:30'));
console.log('with date: ' + currentTimeIs(new Date()));
console.log('with moment: ' + currentTimeIs(moment()));
console.log('hour: ' + moment().hour());
