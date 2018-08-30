
module.exports = {
    'POST /warn1': async () => {
        return "OK";
    }, 
    'POST /warn2': async () => {
        mail("Garage failed to close", "Garage didn't shut when I tried. Trying again.");
        return "OK";
    },
    'POST /warn3': async () => {
        mail("Garage is stuck open!", "Garage is open and I cannot shut it! I tried twice.");
        return "OK";
    },
    'POST /alive': async () => { // ping from tessel
        log("Tessel reports that it is alive.");
        return "Yay!";
    },
    'POST /opened([0-9+)?': async (request, t) => { // call from tessel
        if (!t) t = 'indefinitely';

        if (Times.get().isNight)
            bulbs.on('outside', 180, 'garage opened at night');

        log(`Tessel reports opened ${t} state.`);
        saveSnap(10);
        return "opened alert received";
    },
    'POST /closed': async () => { // call from tessel
        log('Tessel reports closed state.');
        saveSnap(0);
        return "closed alert received";
    },
    'POST /close': async () => { // call from user
        log('Close command received.');
        let msg = await tessel.post('close');
        log('Tessel replies: ' + msg);
        return msg;
    },
    'POST /open([0-9]+)': async (request, time) => { // call from user
        return await doOpen(time, request.url);
    },
    'GET /time': async () => { // call from user
        let times = Times.get(true);
        for (let t in times){
            if (t != 'isNight') times[t] = format(times[t]);
        }

        return times;
    },
    'GET /state/garage': async () => {
        return await getTesselState();
    },
    'GET /state/lights': async () => {
        return await bulbs.getState();
    },
    'GET /state/lights/hue': async () => {
        return await bulbs.getHueState();
    },
    'GET /state/lights/wemo': async () => {
        return await bulbs.getWemoState();
    },
    'GET /state/lights/etek': async () => {
        return await bulbs.getEtekState();
    },
    'GET /state/times': async () => {
        return Times.get(true);
    },
    'GET /state/schedules': async () => {
        return scheduler.getSchedules();
    },
    'GET /state/thermostat': async () => {
        return await therm.getState();
    },
    'POST /state/thermostat': async () => {
        return await therm.moveTemp1();
    },
    'GET /state': async () => {
        let state = {
            garage: await getTesselState(),
            bulbs: await bulbs.getState(),
            schedules: scheduler.getSchedules(),
            thermostat: await therm.getState(),
            times: Times.get(true)
        };

        state.history = state.bulbs.history;
        delete state.bulbs.history;

        return state;
    },
    'DELETE /therm/away'): async () => {
        return await therm.set('away', false);
    },
    'PUT /therm/away'): async () => {
        return await therm.set('away', true);
    },
    'POST /therm/temp([0-9]+)': async (request, temp) => {
        return await therm.set('target_temperature_f', temp);
    },
    'POST /therm/fan([0-9]+)': async (request, duration) => {
        if (!duration) duration = 15;
        return await therm.set('fan', duration);
    },
    'POST /button': async () => { // Call from AWS Lambda
        if (Times.get().isNight){
            if (!recentLambda){
                log('IoT button pressed at night; turning on outside bulbs.');
                bulbs.on('outside', 180, 'IoT button');
                recentLambda = true;
                setTimeout(() => recentLambda = false, 60000);
            }
            else {
                log('IoT button pressed again at night; opening garage.');
                doOpen(0, request.url);
                recentLambda = false;
            }
        }
        else {
            log('IoT button pressed in daytime; opening garage.');
            doOpen(request.url);
        }

        return 202;
    },
    'GET /nestredirect'): async () => {
        log(request.url);
        return 202;
    },
    'POST /nestaway'): async () => {
        log("Nest reports away state at " + format(new Date()));
        return "Got it.";
    },
    'POST /nesthome'): async () => {
        log("Nest reports people coming home at " + format(new Date()));
        return "Got it.";
    },
    '(POST|GET) /(light|alight|unlight)/([a-z0-9]+)/': async (request, meth, action, light) => {
        if (meth == 'GET')
            return await bulbs.getBulb(light);

        if (meth == 'POST'){
            scheduler.toggleOverride(light);
            bulbs.toggleOverride(light);

            let get;
            if (action == 'light')
                get = bulbs.toggle;
            else if (action == 'alight')
                get = bulbs.on;
            else if (action == 'unlight')
                get = bulbs.off;

            return await get.bind(bulbs)(light, request.url); 
        }

        return 406;
    }
};
