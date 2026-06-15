#!/bin/bash

rm -f /var/run/apache2/apache2.pid

apachectl -D FOREGROUND &

sleep 2

chmod 600 /usr/local/smokeping/etc/smokeping_secrets.dist

/usr/local/smokeping/bin/smokeping /usr/local/smokeping/etc/config

sleep 2

chown www-data:www-data -R /usr/local/smokeping

tail -f /var/log/apache2/access.log
