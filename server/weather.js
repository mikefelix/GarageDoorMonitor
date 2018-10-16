let axios = require("axios"),
    log = require("./log.js")("Weather", 4);
        
module.exports = class Weather {
    constructor(weatherUrl){
        this.weatherUrl = weatherUrl;
    }

    async getState(prop, value){
        try {
            let res = await axios({ method: 'GET', url: this.weatherUrl });
            return res.data;
        }
        catch (err){
            log(1, `Error while calling weather URL: ${err}`);
            return undefined;
        }
    }
}
