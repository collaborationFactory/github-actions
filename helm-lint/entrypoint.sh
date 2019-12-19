#!/bin/sh -l

echo ">>> Executing command <<<"
echo ""
echo ""

CHART=$INPUT_CHART
AWS_ACCESS_KEY_ID=$INPUT_AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=$INPUT_AWS_SECRET_ACCESS_KEY
AWS_DEFAULT_REGION=$INPUT_AWS_DEFAULT_REGION

helm dependecy update $CHART
helm lint --debug $CHART
