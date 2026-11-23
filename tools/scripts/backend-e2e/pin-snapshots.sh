#!/usr/bin/env bash
#
# Pins the snapshot versions a frontend PR published into the npm projects that
# consume them, with the same npm call the nightly upmerge uses to bump plugins.
#
# Usage: PACKAGES='["@scope/name", ...]' INTEGRITIES='{"@scope/name": "sha512-..."}' \
#          pin-snapshots.sh <version> <glob>...
#
# Each glob is expanded to npm project dirs; a blank glob is ignored, and the
# script fails when no glob matches a dir. A literal path expands to itself.
# A dir without package.json is skipped. Prints one "<dir> <package>@<version>"
# line per pin, and nothing when no dir consumes a published package.
#
# Every PR push republishes the same snapshot version. After each install, the
# integrity recorded in the dir's package-lock.json must equal the one this
# run's snapshot job published (INTEGRITIES), so a run never tests a newer
# push's content. A package INTEGRITIES does not list is pinned unchecked, with
# a warning.

set -euo pipefail

# shellcheck source=tools/scripts/backend-e2e/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# verify_integrity <dir> <name> <version> <integrities-json>
verify_integrity() {
  local dir="$1" name="$2" version="$3" integrities="$4" expected actual
  expected="$(jq -r --arg name "${name}" '.[$name] // empty' <<<"${integrities}")"
  if [[ -z "${expected}" ]]; then
    echo "::warning::No published integrity for ${name}@${version}, so it is pinned unchecked"
    return 0
  fi
  actual="$(jq -r --arg key "node_modules/${name}" '.packages[$key].integrity // empty' "${dir}/package-lock.json" 2>/dev/null || true)"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "::error::${name}@${version} changed since this run's snapshot job (republished by a newer push); re-run on the latest push"
    return 1
  fi
}

main() {
  if (($# < 2)) || [[ -z "$1" ]]; then
    echo "Usage: PACKAGES='[\"@scope/name\"]' $(basename "$0") <version> <glob>..." >&2
    exit 2
  fi
  local version="$1"
  shift
  local packages="${PACKAGES:-}"
  local integrities="${INTEGRITIES:-}"
  [[ -n "${integrities// /}" ]] || integrities='{}'
  if ! jq -e 'type == "object"' <<<"${integrities}" >/dev/null 2>&1; then
    echo "INTEGRITIES is not a JSON object: ${integrities}" >&2
    exit 1
  fi

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
      verify_integrity "${dir}" "${name}" "${version}" "${integrities}" >&2
    done
    for name in "${names[@]}"; do
      echo "${dir} ${name}@${version}"
    done
  done
}

main "$@"
