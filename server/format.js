var moment = require("moment-timezone");

module.exports = function format(date, noQuotes){
    var q = noQuotes ? '' : '"'
    return q + moment(date).format("dddd, MMMM Do YYYY, h:mm:ss a") + q;
}
