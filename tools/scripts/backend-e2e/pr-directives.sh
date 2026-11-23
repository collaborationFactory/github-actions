#!/usr/bin/env bash
#
# Reads the backend E2E directives from a frontend PR's description, so a PR can
# name the backend and cplace-e2e branch it is tested against.
#
# Usage: PR_BODY="<description>" pr-directives.sh
#
# A directive is a line of its own:
#   backend-branch: <branch>
#   cplace-e2e-branch: <branch>
#
# Prints BACKEND_BRANCH_OVERRIDE=<branch> and E2E_BRANCH_OVERRIDE=<branch>, empty
# when the body has no such line. The last matching line wins; everything else
# in the body is ignored. The value is not validated here: resolve-backend.sh
# checks that it is a branch that exists.
#
# The body is untrusted input. It arrives through the environment, never as
# part of a script.

set -euo pipefail

main() {
  local backend='' e2e='' line
  local backend_re='^backend-branch:[[:space:]]*([^[:space:]]+)'
  local e2e_re='^cplace-e2e-branch:[[:space:]]*([^[:space:]]+)'
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    if [[ "${line}" =~ ${backend_re} ]]; then
      backend="${BASH_REMATCH[1]}"
    elif [[ "${line}" =~ ${e2e_re} ]]; then
      e2e="${BASH_REMATCH[1]}"
    fi
  done <<<"${PR_BODY:-}"

  echo "BACKEND_BRANCH_OVERRIDE=${backend}"
  echo "E2E_BRANCH_OVERRIDE=${e2e}"
}

main "$@"
