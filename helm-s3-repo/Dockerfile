FROM alpine/helm:3.0.1

RUN apk add --no-cache --virtual build-dependencies py-pip
RUN apk add --no-cache bash git
RUN python -m pip install awscli

RUN apk del build-dependencies

COPY entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
