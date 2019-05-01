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
                    log.warn(msg);
                    resolve(defaultVal);
                }
                else if (typeof devaultVal == 'function'){
                    resolve(defaultVal());
                }
                else {
                    reject(msg);
                }
            }, ms);
        });

        if (typeof promise.then != 'function') log.error(ms + '/' +promise + '/' + action)
        return Promise.race([
            promise.then(d => { 
                let end = new Date();
                clearTimeout(id);
                log.debug(`${action || 'Promise'} completed in ${end.getTime() - start.getTime()} millis.`);
                return d;
            }).catch(e => {
                log.error(`Error during timed promise '${action}': ${e}.`);
                log.error(e.stack);
                return defaultVal;
            }),
            timeoutPromise
        ]);
    }
}
