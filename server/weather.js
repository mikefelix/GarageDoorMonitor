let axios = require("axios"),
    log = require("./log.js")("Weather");
        
module.exports = class Weather {
    constructor(weatherUrl){
        this.weatherUrl = weatherUrl;
    }

    async get(prop, value){
        try {
            let res = await axios({ method: 'GET', url: this.weatherUrl });
            return res;
        }
        catch (err){
            log(`Error while calling weather URL: ${err}`);
            return undefined;
        }
    }
}
