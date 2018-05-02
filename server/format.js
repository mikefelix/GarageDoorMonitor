var moment = require("moment-timezone");

module.exports = function format(date, dateFormat){
    if (!date) return undefined;
    dateFormat = dateFormat || "MM/DD/YYYY, h:mm:ssa"; 
    return moment(date).format(dateFormat);
}
