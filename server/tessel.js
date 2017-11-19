var request = require('request');

module.exports = class Tessel {
    constructor(address){
        this.tesselAddress = address;
    }
 
    call(uri, callback){
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
                console.log("Could not communicate with Tessel: " + e);
                reject(e);
            }
        });
    }
}
