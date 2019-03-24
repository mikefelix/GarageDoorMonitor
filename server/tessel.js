var request = require('request'),
    timeout = require('./timeout.js'),
    log = require('./log.js')('Tessel');

module.exports = class Tessel {
    constructor(address){
        this.tesselAddress = address;
    }
 
    get(uri){
        let prom = new Promise((resolve, reject) => {
            try {
                request(this.tesselAddress + '/' + uri, (err, res, body) => {
                    if (err){
                        reject(err);
                    }
                    else {
                        resolve(body);
                    }
                });
            }
            catch (e) {
                log(1, "Could not communicate with Tessel: " + e);
                reject(e);
            }
        });

        return timeout(5000, {offline: true})(prom, 'get tessel state');
    }

    post(uri, callback){
        let prom = new Promise((resolve, reject) => {
            try {
                request(this.tesselAddress + '/' + uri, (err, res, body) => {
                    if (err){
                        reject("Error: " + err);
                    }
                    else {
                        resolve(body);
                    }
                });
            }
            catch (e) {
                log(1, "Could not communicate with Tessel: " + e);
                reject(e);
            }
        });

        return timeout(5000, {offline: true})(prom, 'set tessel state');
    }
}
