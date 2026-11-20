#!/usr/bin/env bash
#
# Decides whether a frontend PR's snapshot is worth a backend E2E run: only when
# the backend or cplace-e2e consumes a package the PR published.
#
# Usage: PACKAGES='["@scope/name", ...]' resolve-consumers.sh <backend-checkout> <e2e-checkout>
#
# Reads <backend-checkout>/*/assets/package.json and <e2e-checkout>/package.json.
# An empty or unset PACKAGES counts as `[]`, as fe-pr-snapshot.yml leaves it
# empty when it publishes nothing.
#
# Writes to GITHUB_OUTPUT:
#   backend_packages  JSON array of the published packages the backend consumes
#   e2e_packages      JSON array of the published packages cplace-e2e consumes
#   run               true when either array is non-empty

set -euo pipefail

# shellcheck source=tools/scripts/backend-e2e/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# consumed_json <packages-json> <package.json>...: the published packages the
# manifests consume, as one sorted JSON array without duplicates.
consumed_json() {
  local packages="$1" manifest
  shift
  for manifest in "$@"; do
    consumed_packages "${manifest}" "${packages}" || return 1
  done | jq -Rsc 'split("\n") | map(select(length > 0)) | unique'
}

main() {
  if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
    echo "GITHUB_OUTPUT is not set" >&2
    exit 1
  fi
  if (($# != 2)); then
    echo "Usage: PACKAGES='[\"@scope/name\"]' $(basename "$0") <backend-checkout> <e2e-checkout>" >&2
    exit 2
  fi
  local backend="$1" e2e="$2"
  local packages="${PACKAGES:-}"
  [[ -n "${packages// /}" ]] || packages='[]'

  local -a backend_manifests e2e_manifests=()
  shopt -s nullglob
  backend_manifests=("${backend}"/*/assets/package.json)
  shopt -u nullglob
  if ((${#backend_manifests[@]} == 0)); then
    echo "::warning::${backend} has no */assets/package.json, so the backend consumes nothing"
  fi
  if [[ -f "${e2e}/package.json" ]]; then
    e2e_manifests=("${e2e}/package.json")
  fi

  local backend_packages e2e_packages run=false
  backend_packages="$(consumed_json "${packages}" ${backend_manifests[@]+"${backend_manifests[@]}"})"
  e2e_packages="$(consumed_json "${packages}" ${e2e_manifests[@]+"${e2e_manifests[@]}"})"
  if [[ "${backend_packages}" != '[]' || "${e2e_packages}" != '[]' ]]; then
    run=true
  fi

  {
    echo "backend_packages=${backend_packages}"
    echo "e2e_packages=${e2e_packages}"
    echo "run=${run}"
  } >>"${GITHUB_OUTPUT}"
}

main "$@"
