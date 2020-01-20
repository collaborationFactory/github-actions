#!/bin/sh -l

echo ">>> Executing command <<<"
echo ""
echo ""

export S3_BUCKET=$INPUT_S3_BUCKET
export REPO=$INPUT_REPO
export AWS_ACCESS_KEY_ID=$INPUT_AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY=$INPUT_AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION=$INPUT_AWS_REGION

if ! helm plugin list | grep -q s3; then
    helm plugin install https://github.com/hypnoglow/helm-s3.git --version 0.9.1
fi

if ! helm repo list | grep -q $REPO; then
    helm repo add $REPO $S3_BUCKET
fi
