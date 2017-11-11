var request = require('request');

var Tessel = module.exports = function(address){
    this.tesselAddress = address;
}

Tessel.prototype.call = function(uri, callback){
    try {
        request(this.tesselAddress + '/' + uri, (err, res, body) => {
            if (err){
                callback("Error: " + err);
            }
            else {
                callback(body);
            }
        });
    }
    catch (e) {
        console.log("Could not communicate with Tessel: " + e);
    }
}

