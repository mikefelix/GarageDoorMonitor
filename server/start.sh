#!/bin/bash
echo Running node $(node --version) at $(which node) as $(whoami)
if [[ "x" == "$1x" ]]; then
    level=3
else
    level=$1
fi

pat="^[0-9]+:[0-9]+:[4-5].+$"

while sleep 2; do 
    d=`date`
    time=`date | awk '{print $4}'`
    echo Time is $time

    if [[ $time =~ $pat ]]; then
        echo "Waiting for the minute to elapse..."
    else
        echo "Running..."
        LOG_LEVEL=$level node index.js | tee ~/garage_${d// /_}.log
        #DEBUG=node-ssdp:* LOG_LEVEL=$level node index.js | tee ~/garage_${d// /_}.log
    fi
done
