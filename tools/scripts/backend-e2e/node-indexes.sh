#!/usr/bin/env bash
#
# Prints the node matrix of the backend E2E job: the JSON array [0..n-1].
#
# Usage: node-indexes.sh <n>
#
# Fails unless <n> is a positive integer without a leading zero.

set -euo pipefail

main() {
  local nodes="${1:-}"
  case "${nodes}" in
    '' | *[!0-9]* | 0*) echo "NODES must be a positive integer, got '${nodes}'" >&2; exit 1 ;;
  esac
  jq -cn --argjson n "${nodes}" '[range($n)]'
}

main "$@"
