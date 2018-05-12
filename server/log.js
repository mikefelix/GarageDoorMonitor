let moment = require('moment-timezone'),
    format = require('./format.js'),
    pad = 32;

module.exports = function(name, dateFormat) {
    if (!dateFormat) dateFormat = 'MM/DD h:mm:ssa';

    return (msg) => {
        if (typeof msg == 'object'){
            console.dir(msg);
            return;
        }

        let prefix = `${name} (${format(new Date(), dateFormat)})`;
        let padding = '';
        for (let i = prefix.length; i < pad; i++) padding += ' ';
        console.log(`${prefix}:${padding}${msg}`);
    };
}
