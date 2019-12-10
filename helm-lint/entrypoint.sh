#!/bin/sh -l

CHART=$1
AWS_ACCESS_KEY_ID=$2
AWS_SECRET_ACCESS_KEY=$3
AWS_DEFAULT_REGION=$4

echo ">>> Executing command <<<"
echo ""
echo ""

helm dependecy update $CHART
helm lint --debug $CHART
