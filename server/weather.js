let axios = require("axios"),
    log = require("./log.js")("Weather");
        
module.exports = class Weather {
    constructor(weatherUrl){
        this.weatherUrl = weatherUrl;
    }

    async getState(prop, value){
        if (this.cached){
            return this.cached;
        }

        try {
            let res = await axios({ method: 'GET', url: this.weatherUrl });
            res = res.data;

            let weather = res.main;
            if (res.weather && res.weather[0])
                weather.cond = res.weather[0].description

            if (res.wind)
                weather.windspeed = res.wind.speed;

            if (res.rain)
                weather.rain = res.rain;

            this.cached = weather;
            setTimeout(() => delete this.cached, 1000 * 60 * 5);

            return weather;
        }
        catch (err){
            log(1, `Error while calling weather URL: ${err}`);
            return undefined;
        }
    }
}

/*
{
    "coord":{
        "lon":-111.89,"lat":40.67
    },
    "weather":[{"id":800,"main":"Clear","description":"clear sky","icon":"01d"}],
    "base":"stations",
    "main":{
        "temp":283.62,
        "pressure":1015,
        "humidity":53,
        "temp_min":278.15,
        "temp_max":287.04
    },
    "visibility":16093,
    "wind":{
        "speed":4.6,
        "deg":180
    },
    "clouds":{
        "all":1
    },
    "dt":1553701070,
    "sys":{
        "type":1,
        "id":6116,
        "message":0.007,
        "country":"US",
        "sunrise":1553692769,
        "sunset":1553737572
    },
    "id":5778755,
    "name": "Murray",
    "cod":200
}
*/
