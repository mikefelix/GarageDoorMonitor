const WemoClient = require('wemo-client'),
      wemo = new WemoClient();

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
                        resolve(action(clients[name]));
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
        setState(client, 1);
    }
    catch (err) {
        if (retrying)
            throw err;
        else
            changeState(client, newState, true);
    }
}

export default class Wemo {
    constructor(){
        this.clients = {};
    }

    async on(name, timeout){
        changeState(clients, name, true);
        if (timeout) setTimeout(() => this.off(name), timeout);
    }

    async off(name){ 
        changeState(clients, name, false);
    }

    async toggle(name, timeout){ 
        changeState(clients, name);
        if (timeout) setTimeout(() => this.toggle(name), timeout);
    }
}