#!/bin/bash
echo Running node $(node --version) at $(which node)
if [[ "x" == "$1x" ]]; then
    level=3
else
    level=$1
fi

while sleep 2; do 
    d=`date`
    LOG_LEVEL=$level node index.js | tee ~/garage_${d// /_}.log
done
