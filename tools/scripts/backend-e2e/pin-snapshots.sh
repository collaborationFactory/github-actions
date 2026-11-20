#!/usr/bin/env bash
#
# Pins the snapshot versions a frontend PR published into the npm projects that
# consume them, with the same npm call the nightly upmerge uses to bump plugins.
#
# Usage: PACKAGES='["@scope/name", ...]' pin-snapshots.sh <version> <glob>...
#
# Each glob is expanded to npm project dirs; a blank glob is ignored, and the
# script fails when no glob matches a dir. A literal path expands to itself.
# A dir without package.json is skipped. Prints one "<dir> <package>@<version>"
# line per pin, and nothing when no dir consumes a published package.

set -euo pipefail

# shellcheck source=tools/scripts/backend-e2e/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  if (($# < 2)) || [[ -z "$1" ]]; then
    echo "Usage: PACKAGES='[\"@scope/name\"]' $(basename "$0") <version> <glob>..." >&2
    exit 2
  fi
  local version="$1"
  shift
  local packages="${PACKAGES:-}"

  local pattern
  local -a dirs=()
  shopt -s nullglob
  for pattern in "$@"; do
    [[ -n "${pattern// /}" ]] || continue
    # Unquoted on purpose: the pattern is a glob to expand.
    # shellcheck disable=SC2206
    dirs+=(${pattern})
  done
  shopt -u nullglob
  if ((${#dirs[@]} == 0)); then
    echo "No directory matches: $*" >&2
    exit 1
  fi

  local dir consumed name
  for dir in "${dirs[@]}"; do
    [[ -f "${dir}/package.json" ]] || continue

    consumed="$(consumed_packages "${dir}/package.json" "${packages}")"
    [[ -n "${consumed}" ]] || continue

    local -a names=() specs=()
    mapfile -t names <<<"${consumed}"
    for name in "${names[@]}"; do
      specs+=("${name}@${version}")
    done

    if ! (cd "${dir}" && npm i "${specs[@]}" --save-exact --legacy-peer-deps >&2); then
      echo "pinning failed in ${dir}" >&2
      exit 1
    fi

    for name in "${names[@]}"; do
      echo "${dir} ${name}@${version}"
    done
  done
}

main "$@"
