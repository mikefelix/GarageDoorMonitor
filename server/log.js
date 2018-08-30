const moment = require('moment-timezone'),
      format = require('./format.js'),
      kafka = require('kafka-node'),
      client = new kafka.KafkaClient({kafkaHost: 'localhost:9092'}),
      producer = new kafka.Producer(client),
      pad = 32;

let kafkaReady = false;

producer.on('ready', (err) => {
    kafkaReady = true;
});

producer.on('error', (err) => {
    console.log(`Error! ${err}`);
});

module.exports = function(segment, defaultLevel){
    if (defaultLevel === false)
        return () => {};

    if (!defaultLevel)
        defaultLevel = 3;

    let dateFormat = 'MM/DD h:mm:ssa';

    return function() {
        let msg, level;
        if (arguments.length == 2 && typeof arguments[0] == 'number'){
            level = arguments[0];
            msg = arguments[1];
        }
        else {
            level = defaultLevel;
            msg = arguments[0];
        }

        if (typeof msg == 'object')
            msg = JSON.stringify(msg);

        let time = new Date();
        let prefix = `${segment} (${format(time, dateFormat)})`;
        let padding = '';
        for (let i = prefix.length; i < pad; i++) 
            padding += ' ';

        let filterLevel = process.env.LOG_LEVEL || 3;
        if (filterLevel >= level)
            console.log(`${prefix}:${padding}${msg}`);

        if (kafkaReady && level <= 3) {
            let body = { segment, level, time, msg };
            producer.send([{ topic: 'events', messages: JSON.stringify(body) }], (err, data) => {
                if (err){
                    console.log(`Error: ${err}`);
                }
            });
        }
    };
}
