#!/usr/bin/env bash
#
# Pins the snapshot versions a frontend PR published into the npm projects that
# consume them, with the same npm call the nightly upmerge uses to bump plugins.
#
# Usage: PACKAGES='["@scope/name", ...]' pin-snapshots.sh <version> <dir>...
#
# A dir without package.json is skipped. Prints one "<dir> <package>@<version>"
# line per pin, and nothing when no dir consumes a published package.

set -euo pipefail

# shellcheck source=tools/scripts/backend-e2e/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  if (($# < 2)) || [[ -z "$1" ]]; then
    echo "Usage: PACKAGES='[\"@scope/name\"]' $(basename "$0") <version> <dir>..." >&2
    exit 2
  fi
  local version="$1"
  shift
  local packages="${PACKAGES:-}"
  [[ -n "${packages// /}" ]] || packages='[]'

  local dir consumed name
  for dir in "$@"; do
    [[ -f "${dir}/package.json" ]] || continue

    consumed="$(consumed_packages "${dir}/package.json" "${packages}")"
    [[ -n "${consumed}" ]] || continue

    local -a names=() specs=()
    mapfile -t names <<<"${consumed}"
    for name in "${names[@]}"; do
      specs+=("${name}@${version}")
    done

    if ! (cd "${dir}" && npm i "${specs[@]}" --save-exact --legacy-peer-deps); then
      echo "pinning failed in ${dir}" >&2
      exit 1
    fi

    for name in "${names[@]}"; do
      echo "${dir} ${name}@${version}"
    done
  done
}

main "$@"
