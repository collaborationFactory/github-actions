#!/bin/sh -l

echo ">>> Executing command <<<"
echo ""
echo ""

helm dependecy update $CHART
helm lint --debug $CHART
