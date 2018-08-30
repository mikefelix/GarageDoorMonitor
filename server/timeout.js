const log = require('./log.js')('Timeout');

module.exports = function(ms, defaultVal){
    return function(promise, action){
        let id;

        if (typeof promise == 'function'){
            let func = promise;
            promise = new Promise((resolve, reject) => {
                try {
                    resolve(func());
                }
                catch (e){
                    reject(e);
                }
            });
        }

        let start = new Date();
        let timeoutPromise = new Promise((resolve, reject) => {
            id = setTimeout(() => {
                clearTimeout(id);
                let msg = `Promise timed out${action ? ' (' + action + ')' : ''}.`;
                if (defaultVal !== undefined){
                    log(2, msg);
                    resolve(defaultVal);
                }
                else {
                    reject(msg);
                }
            }, ms);
        });

        return Promise.race([
            promise.then(d => { 
                let end = new Date();
                clearTimeout(id);
                log(5, `${action || 'Promise'} completed in ${end.getTime() - start.getTime()} millis.`);
                return d;
            }),
            timeoutPromise
        ]);
    }
}
