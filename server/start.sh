#!/bin/bash
echo Running node $(node --version) at $(which node)
while sleep 2; do 
    d=`date`
    node index.js | tee ~/garage_${d// /_}.log
done
