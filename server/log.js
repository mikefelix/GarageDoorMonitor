const moment = require('moment-timezone'),
      format = require('./format.js'),
      kafka = require('kafka-node'),
      client = new kafka.KafkaClient({kafkaHost: 'localhost:9092'}),
      producer = {on:()=>{}},//*/new kafka.Producer(client),
      pad = 35;

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

    logIt.error = function(msg) { return logIt(1, msg); };
    logIt.warn = function(msg) { return logIt(2, msg); };
    logIt.info = function(msg) { return logIt(3, msg); };
    logIt.debug = function(msg) { return logIt(4, msg); };
    logIt.trace = function(msg) { return logIt(5, msg); };
    logIt.setLevel = function(level) { filterLevel = level; };

    return logIt;
}
