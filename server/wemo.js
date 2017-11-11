var WemoClient = require('wemo-client'),
    wemo = new WemoClient();

let setState = function(client, newState){
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
            else console.log("Wemo was already in state " + newState + ".");
        });
    }
    catch (e) {
        console.log("Can't communicate with Wemo: " + e);
    }
}

class Wemo {
    constructor(){
        this.wemoClients = {};
    }

    handle(deviceName, action){
        let withClient = (deviceName, action) => {
            if (this.wemoClients[deviceName]){
                try {
                    return action(this.wemoClients[deviceName]);
                } catch (e){
                    delete this.wemoClients[deviceName];
                    return withClient(deviceName, action);
                }
            }

            wemo.discover(deviceInfo => {
                try {
                    if (deviceInfo && deviceInfo.friendlyName == deviceName){
                        this.wemoClients[deviceName] = wemo.client(deviceInfo);
                        return action(this.wemoClients[deviceName]);
                    }
                } 
                catch (e){
                    console.log("Can't discover devices: " + e);
                    return null;
                }
            });
        }

        withClient(deviceName, (client) => {
            action(client);
        });
    }

    on(name){ 
        this.handle(name, client => { 
            this.setState(client, 1); 
        });
    }

    off(name){ 
        this.handle(name, client => { 
            this.setState(client, 0); 
        });
    }

    toggle(name){ 
        this.handle(name, client => { 
            this.setState(client); 
        });
    }

}

module.exports = Wemo;
