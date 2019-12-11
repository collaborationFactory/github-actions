FROM alpine/helm:3.0.1

RUN apk add --no-cache --virtual build-dependencies py-pip git
RUN apk add --no-cache bash
RUN python -m pip install awscli

RUN helm plugin install https://github.com/hypnoglow/helm-s3.git
RUN apk del build-dependencies
