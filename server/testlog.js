let log = require('./log.js')('Test');

log('hello');
setTimeout(() => log('goodbye'), 2000);
