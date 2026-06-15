#!/bin/bash

apachectl -D FOREGROUND &

chmod 600 /usr/local/smokeping/etc/smokeping_secrets.dist

/usr/local/smokeping/bin/smokeping /usr/local/smokeping/etc/config

chown www-data:www-data -R /usr/local/smokeping

tail -f /var/log/apache2/access.log
