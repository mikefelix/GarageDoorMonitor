let request = require('request');

class Hue {
    constructor(address){
        this.hueAddress = address;
    }

    getState(bulb){
        return new Promise((resolve, reject) => {    
            request.get({
                headers: {'content-type' : 'application/json'},
                url: this.hueAddress + '/' + bulb
            }, (err, res, body) => {
                if (err)
                    reject("Error getting bulb state: " + err);
                else  
                    resolve(body && /"on": ?true/.test(body));
            });
        });
    }

    async toggle(bulbs) {
        if (typeof bulbs == 'number')
            bulbs = [bulbs];

        for (let i = 0; i < bulbs.length; i++){
            let bulb = bulbs[i];
            request.get({
                headers: {'content-type' : 'application/json'},
                url: this.hueAddress + '/' + bulb
            }, (err, res, body) => {
                if (err){
                    console.log("Error getting bulb state: " + err);
                } 
                else {
                    let on = body && /"on": ?true/.test(body);
                    this.hueRequest(bulb, !on);
                }
            });
        }
    }

    hueRequest(bulb, on, timeout){
        console.log(`Setting bulb ${bulb} to ${on ? 'on' : 'off'} at ${new Date()}`);
        request.put({
            headers: {'content-type' : 'application/json'},
            url:     this.hueAddress + '/' + bulb + '/state',
            body:    JSON.stringify({on:on})
        }, (err, res, body) => {
            if (err){
                console.log('Hue error: ' + err);
            }
            else if (timeout){
                setTimeout(() => this.hueRequest(bulb, false), timeout);
            }
        });
    }

    allHueBulbsOff(){
        this.hueRequest(1, false);
        this.hueRequest(2, false);
        this.hueRequest(3, false);
        this.hueRequest(4, false);
    }

}

module.exports = Hue;
