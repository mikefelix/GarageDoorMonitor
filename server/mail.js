var exec = require('child_process').exec;
function mail(subj, body){
    var cmd = 'echo "' + body + '" | /usr/bin/mail -s "' + subj + '" ' + emailAddress;

    exec(cmd, function callback(error, stdout, stderr){
        if (error) console.log("Failed to mail. " + error);
    });
}

module.exports = {
    send: mail
}
