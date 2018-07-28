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

module.exports = function(segment, dateFormat) {
    if (dateFormat === false)
        return () => {};

    if (!dateFormat) dateFormat = 'MM/DD h:mm:ssa';

    return (msg) => {
        if (typeof msg == 'object'){
            console.dir(msg);
            return;
        }

        let time = new Date();
        let prefix = `${segment} (${format(time, dateFormat)})`;
        let padding = '';
        for (let i = prefix.length; i < pad; i++) 
            padding += ' ';

        console.log(`${prefix}:${padding}${msg}`);

        if (kafkaReady) {
            let body = { segment, time, msg };
            producer.send([{ topic: 'events', messages: JSON.stringify(body) }], (err, data) => {
                if (err){
                    console.log(`Error: ${err}`);
                }
            });
        }
    };
}
