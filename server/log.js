const moment = require('moment-timezone'),
      format = require('./format.js'),
      kafka = require('kafka-node'),
      //client = new kafka.KafkaClient({kafkaHost: 'localhost:9092'}),
      producer = {on:()=>{}},//*/new kafka.Producer(client),
      pad = 38;

let kafkaReady = false;

producer.on('ready', (err) => {
    kafkaReady = true;
});

producer.on('error', (err) => {
    console.log(`Error! ${err}`);
});

module.exports = function(segment, filterLevel){
    let dateFormat = 'MM/DD h:mm:ssa';

    const logIt = function() {
        let msg, level;
        if (arguments.length == 2 && typeof arguments[0] == 'number'){
            level = arguments[0];
            msg = arguments[1];
        }
        else {
            level = 3;
            msg = arguments[0];
        }

        if (typeof msg == 'object')
            msg = JSON.stringify(msg);

        let time = new Date();
        let prefix = `${segment} (${format(time, dateFormat)})`;
        let padding = '';
        for (let i = prefix.length; i < pad; i++) 
            padding += ' ';

        filterLevel = filterLevel || process.env.LOG_LEVEL || 3;
        if (filterLevel >= level)
            console.log(`${prefix} @${level}:${padding}${msg}`);

        if (kafkaReady && level <= 3) {
            let body = { segment, level, time, msg };
            producer.send([{ topic: 'events', partition: 0, messages: [JSON.stringify(body)] }], (err, data) => {
                if (err){
                    console.log(`Error: ${err}`);
                }
            });
        }
    };

    logIt.error = logIt.bind(null, 1);
    logIt.warn = logIt.bind(null, 2);
    logIt.info = logIt.bind(null, 3);
    logIt.debug = logIt.bind(null, 4);
    logIt.trace = logIt.bind(null, 5);
    logIt.setLevel = function(level) { filterLevel = level; };

    return logIt;
}
