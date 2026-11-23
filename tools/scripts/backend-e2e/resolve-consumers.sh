#!/usr/bin/env bash
#
# Decides whether a frontend PR is worth a backend E2E run: when the backend or
# cplace-e2e consumes a package the PR published, or when the PR changed its
# in-repo specs.
#
# Usage: PACKAGES='["@scope/name", ...]' SPECS_CHANGED=true|false #          resolve-consumers.sh <backend-checkout> <e2e-checkout>
#
# Reads <backend-checkout>/*/assets/package.json and <e2e-checkout>/package.json.
# An empty or unset PACKAGES counts as `[]`. SPECS_CHANGED is true when the PR
# changed a file under e2e-tests/.
#
# Writes to GITHUB_OUTPUT:
#   backend_packages  JSON array of the published packages the backend consumes
#   e2e_packages      JSON array of the published packages cplace-e2e consumes
#   run               true when either array is non-empty or SPECS_CHANGED is true

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
  if [[ "${backend_packages}" != '[]' || "${e2e_packages}" != '[]' || "${SPECS_CHANGED:-false}" == true ]]; then
    run=true
  fi

  {
    echo "backend_packages=${backend_packages}"
    echo "e2e_packages=${e2e_packages}"
    echo "run=${run}"
  } >>"${GITHUB_OUTPUT}"
}

main "$@"
