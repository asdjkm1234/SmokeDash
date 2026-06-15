FROM debian:11 AS build

RUN sed -i 's/deb.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list && \
    sed -i 's/security.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list && \
    apt-get update

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        gcc make libwww-perl libcgi-fast-perl libtext-soundex-perl \
        libio-pty-perl libcrypt-ssleay-perl rrdtool librrds-perl \
        libssl-dev libc6-dev wget autoconf fping acl curl apache2 \
        git graphviz imagemagick libapache2-mod-fcgid mtr-tiny nmap fonts-wqy-zenhei; \
    rm -rf /var/lib/apt/lists/*; \
    apt-get clean; \
    rm -rf /tmp/*

WORKDIR /usr/local/src
RUN wget https://oss.oetiker.ch/smokeping/pub/smokeping-2.8.2.tar.gz && \
    tar zxf smokeping-2.8.2.tar.gz

WORKDIR /usr/local/src/smokeping-2.8.2
RUN LC_ALL=C ./configure --prefix=/usr/local/smokeping && \
    make install

FROM debian:11 AS runtime

RUN sed -i 's/deb.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list && \
    sed -i 's/security.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list && \
    apt-get update

RUN apt-get update && \
    apt-get install -y apache2 libapache2-mod-fcgid fping fonts-wqy-zenhei librrds-perl && \
    rm -rf /var/lib/apt/lists/*; \
    apt-get clean

COPY --from=build /usr/local/smokeping /usr/local/smokeping

RUN mkdir -p /usr/local/smokeping/cache && \
    mkdir -p /usr/local/smokeping/data && \
    mkdir -p /usr/local/smokeping/var && \
    mkdir -p /usr/local/smokeping/etc

EXPOSE 80

COPY apache2_config /etc/apache2/conf-available/

RUN ln -s /etc/apache2/conf-available/smokeping.conf /etc/apache2/conf-enabled/ && \
    a2enconf smokeping && \
    a2enmod cgid

RUN sed -i 's/FcgidConnectTimeout 20/FcgidConnectTimeout 20\n   MaxRequestLen 157286400000/g' /etc/apache2/mods-available/fcgid.conf

COPY start.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/start.sh

CMD ["/usr/local/bin/start.sh"]
