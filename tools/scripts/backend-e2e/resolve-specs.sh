#!/usr/bin/env bash
#
# Builds the cplace-e2e spec filter of a backend E2E run: the caller's default
# filter, the specs mapped to the packages the backend and cplace-e2e consume,
# and the FE repo's in-repo specs.
#
# Usage: resolve-specs.sh
#
# Env:
#   E2E_SPECS      comma-separated spec globs every run includes
#   SPEC_MAP       JSON object {"@scope/pkg": "glob,glob"}; optional, default {}
#   CONSUMED       JSON array of the published packages the backend or
#                  cplace-e2e consumes
#   IN_REPO_SPECS  true when the FE repo has an e2e-tests/ folder; its specs
#                  are copied to cypress/e2e/<FE_REPO>/ in cplace-e2e
#   FE_REPO        the frontend repository name; required with IN_REPO_SPECS
#   GITHUB_OUTPUT  receives specs, the comma-joined globs without duplicates,
#                  in that order

set -euo pipefail

main() {
  if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
    echo "GITHUB_OUTPUT is not set" >&2
    exit 1
  fi
  local map="${SPEC_MAP:-}" consumed="${CONSUMED:-}"
  [[ -n "${map// /}" ]] || map='{}'
  [[ -n "${consumed// /}" ]] || consumed='[]'
  if ! jq -e 'type == "object" and all(.[]; type == "string")' <<<"${map}" >/dev/null 2>&1; then
    echo "::error::SPEC_MAP is not a JSON object of comma-separated globs: ${map}" >&2
    exit 1
  fi
  if ! jq -e 'type == "array"' <<<"${consumed}" >/dev/null 2>&1; then
    echo "::error::CONSUMED is not a JSON array: ${consumed}" >&2
    exit 1
  fi

  local in_repo=''
  if [[ "${IN_REPO_SPECS:-false}" == true ]]; then
    if [[ -z "${FE_REPO:-}" ]]; then
      echo "FE_REPO is not set" >&2
      exit 1
    fi
    in_repo="cypress/e2e/${FE_REPO}/**/*.spec.ts"
  fi

  local specs
  specs="$(jq -rn --arg defaults "${E2E_SPECS:-}" --argjson map "${map}" --argjson consumed "${consumed}" --arg in_repo "${in_repo}" '
    [ ($defaults | split(",")[]),
      ($map | to_entries[] | select(.key as $k | $consumed | index($k)) | .value | split(",")[]),
      $in_repo ]
    | map(gsub("^\\s+|\\s+$"; "") | select(length > 0))
    | reduce .[] as $glob ([]; if index([$glob]) then . else . + [$glob] end)
    | join(",")')"

  echo "specs=${specs}" >>"${GITHUB_OUTPUT}"
}

main "$@"
