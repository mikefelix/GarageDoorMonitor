const WemoClient = require('wemo-client'),
      wemo = new WemoClient();

function getState(client){
    return new Promise((resolve, reject) => {
        try {
             client.getBinaryState((err, state) => {
                 if (err)
                    reject(err);
                 else 
                    resolve(state);
             });
        }
        catch (e){
            reject(e);
        }
    });
}

function setState(client, newState){
    return new Promise((resolve, reject) => {
        try {
            client.getBinaryState((err, state) => {
                if (err) {
                    console.log("Error getting wemo state: " + err);
                }
                else if (newState === undefined){
                    console.log("Toggling wemo state from " + state + ".");
                    client.setBinaryState(state == 0 ? 1 : 0);
                }
                else if (state != newState){
                    console.log("Setting wemo to state " + newState + ".");
                    client.setBinaryState(newState);
                }
                else 
                    console.log("Wemo was already in state " + newState + ".");

                resolve(newState);
            });
        }
        catch (e) {
            console.log("Can't communicate with Wemo: " + e);
            reject(e);
        }
    });
}

function getClient(clients, name, forceDiscover){
    return new Promise((resolve, reject) => {
        name = name.substring(0, 1).toUpperCase() + name.substring(1);
        if (forceDiscover)
            delete clients[name];

        let client = clients[name];
        if (client) {
            resolve(client);
        }
        else {
            wemo.discover(deviceInfo => {
                try {
                    if (deviceInfo && deviceInfo.friendlyName == name){
                        clients[name] = wemo.client(deviceInfo);
                        resolve(clients[name]);
                    }
                } 
                catch (e){
                    console.log("Can't discover devices: " + e);
                    reject(e);
                }
            });
        }
    });
}

async function changeState(clients, name, newState, retrying){
    try {
        let client = await getClient(clients, name);
        setState(client, newState);
    }
    catch (err) {
        if (retrying)
            throw err;
        else
            changeState(client, newState, true);
    }
}

module.exports = class Wemo {
    constructor(bulbs){
        this.clients = {};
        this.bulbs = bulbs;
    }

    async getState(){
        let totalState = {};
        for (let i = 0; i < this.bulbs.length; i++){
            let bulb = this.bulbs[i];
            try {
                totalState[bulb] = await this.getBulbState(bulb);
            }
            catch (e){
                console.log(`Error getting wemo state for bulb ${bulb}`);
            }
        }

        return totalState;
    }

    async getBulbState(bulb){
        let client = await getClient(this.clients, bulb);
        return await getState(client);
    }

    async on(name, timeout){
        changeState(this.clients, name, true);
        if (timeout) setTimeout(() => this.off(name), timeout);
    }

    async off(name){ 
        changeState(this.clients, name, false);
    }

    async toggle(name, timeout){ 
        changeState(this.clients, name);
        if (timeout) setTimeout(() => this.toggle(name), timeout);
    }
}
