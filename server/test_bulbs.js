let Bulbs = require('./bulbs');

let hueKey='KgVPpqOz3wdHb5ILmgwHdG5SA35WzbTEDKYrsxz0';
let hueAddress = 'http://192.168.0.115/api/' + hueKey + '/lights';
let bulbs = new Bulbs(hueAddress);

function toggleBulb(name) {
    console.log(`Toggling ${name} for 5 seconds.`);
    bulbs.toggle(name);
    return new Promise(resolve => {
        setTimeout(() => {
            bulbs.toggle(name);
            resolve(true);
        }, 5000);
    });
}

async function testBulbs(){
    console.log('Testing bulbs.');
    let bulbs = ['aquarium', 'lamp', 'breezeway', 'garage', 'driveway'];

    for (let i = 0; i < bulbs.length; i++){
        try {
            let bulb = bulbs[i];
            /*
            let state = await readBulbState(bulb);
            console.log(bulb + ": ");
            console.log(state);
            */
            await toggleBulb(bulb);
        }
        catch (e){
            console.log(e);
        }
    };

    process.exit(0);
}

async function readBulbState(){
    //return bulbs.
}

testBulbs();
