let log = require('./log.js')('Hue'),
    util = require('util'),
    exec = util.promisify(require('child_process').exec);

module.exports = class Readonly {
    constructor(config, device){
        log.info(`Initializing ${device.name} at ${device.ip}.`);
        this.ip = device.ip;
    }

    async getState(){
        let on = await this.hostIsUp();
        return { ip: this.ip, readonly: true, on };
    }

    async on() { return false; }
    async off() { return false; }

    async hostIsUp() {
        if (!this.ip) {
            log.error(`No host: ${this.ip}`);
            return false;
        }

        let host = this.ip;
        if (this.presence > 0){
            this.presence--;
            return true;
        }

        try {
            log.debug(`Ping ${host}`);
            const { stdout, stderr } = await exec('ping -w 1 ' + host); 

            if (stderr) {
                log.debug("Failed to ping. " + stderr);
            }
            else {
                let [m, num] = stdout.match(/([0-9]+) received/);
                if (num === undefined){
                    log.error("Cannot find packets received in output:");
                    log(stdout);
                }

                if (num > 0){
                    this.presence = 5;
                    return true;
                }
            }
        }
        catch (e) {
            log.debug(`Ping failed to ${host}.`);
        }    

        return false;
    }
}
