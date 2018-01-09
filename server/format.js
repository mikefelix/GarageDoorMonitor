var moment = require("moment-timezone");

module.exports = function format(date, noQuotes){
    if (!date) return undefined;
    var q = noQuotes ? '' : '"'
    return q + moment(date).format("MM/DD/YYYY, h:mm:ssa") + q;
}
