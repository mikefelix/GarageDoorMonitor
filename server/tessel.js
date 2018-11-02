var request = require('request'),
    log = require('./log.js')('Tessel');

module.exports = class Tessel {
    constructor(address){
        this.tesselAddress = address;
    }
 
    get(uri, callback){
        return new Promise((resolve, reject) => {
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
    }

    post(uri, callback){
        return new Promise((resolve, reject) => {
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
    }
}
