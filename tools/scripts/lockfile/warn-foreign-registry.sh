#!/usr/bin/env bash
#
# Advisory check: warn when a lockfile has `resolved` URLs that do NOT go
# through the cplace JFrog npm proxy.
#
# Usage:
#   ./tools/scripts/lockfile/warn-foreign-registry.sh [<lockfile>]
#
# Runs inside the `use-npmrc` composite, so it inspects the CONSUMER's lockfile
# on the runner. Under `replace-registry-host=never`, which `use-npmrc` sets,
# those entries are fetched verbatim from the registry they name - outside the
# proxy. Without that flag the outcome depends on the npm version: 10.2.4
# rewrites the host onto the configured registry correctly and resolves THROUGH
# the proxy, while 11.3.0 drops the registry's path prefix and fails with an
# E404 masked as *** (PFM-ISSUE-34453). Measured 2026-08-14, both ways.
#
# ADVISORY ONLY - this must never fail a consumer's build. Every exit is 0.
# It is a discovery mechanism: the warnings are the inventory of lockfiles that
# still need normalizing, and the moment that inventory is empty the
# `replace-registry-host=never` mitigation can be dropped.
#
# Emits a `::warning` annotation (surfaces at the top of the run and against the
# file) plus a job-summary table. Names package paths only, never URLs, so the
# message survives *** masking of the JFrog host.
#
# See tools/scripts/lockfile/README.md

set -uo pipefail

# Sourced, not re-implemented. This script previously carried its own copy of the
# proxy URL and its own `startswith($proxy)` predicate - which is the exact bug
# lib.sh documents as already found and fixed once: an entry on the right host
# but with a stray path segment satisfies `startswith` and was silently reported
# as compliant. That mattered here more than anywhere else, because these
# warnings are the inventory that decides when the mitigation can be removed.
#
# Sourcing is guarded on both sides: an unreachable or unloadable lib.sh exits 0
# silently rather than failing a consumer's build, which the advisory contract
# below requires and which the script's own care cannot cover once it has to
# reference an undefined constant under `set -u`.
LIB="$(dirname "${BASH_SOURCE[0]}")/lib.sh"
readonly LIB
[[ -r "${LIB}" ]] || exit 0
# shellcheck source=tools/scripts/lockfile/lib.sh
source "${LIB}" || exit 0

readonly MAX_LISTED=10

main() {
  local lockfile="${1:-${GITHUB_WORKSPACE:-.}/package-lock.json}"

  # Every precondition is a silent success: an advisory check must not become a
  # new way for consumer pipelines to fail.
  [[ -f "${lockfile}" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local offenders total
  # The SAME predicate check-lockfile.sh asserts on, via lib.sh: strip the
  # tarball path and require the remaining prefix to equal the proxy exactly.
  # `startswith` was wrong here - it passes an entry on the right host with a
  # stray path segment, e.g. `.../cplace-npm/extra/beta/-/beta-2.0.0.tgz`, which
  # check-lockfile.sh correctly rejects. The two must agree, or this inventory
  # under-reports the very lockfiles it exists to find.
  #
  # JQ_REGISTRY_ENTRIES considers only http(s) `resolved` values: local-path
  # values (e.g. "tools/eslint-rules" for a workspace-local plugin) are not
  # hosted anywhere and must not be reported - 4 of 41 FE repos have them.
  offenders="$(jq -r --arg proxy "${JFROG_NPM_PROXY}" --arg tarball_re "${TARBALL_PATH_RE}" \
    "[ ${JQ_REGISTRY_ENTRIES} | select((.value.resolved | sub(\$tarball_re; \"\")) != \$proxy) | .key ] | .[]" \
    "${lockfile}" 2>/dev/null)" || return 0

  [[ -n "${offenders}" ]] || return 0

  total="$(printf '%s\n' "${offenders}" | wc -l | tr -d '[:space:]')"

  printf '::warning file=%s::%s entries in package-lock.json do not resolve via the cplace npm proxy. Under replace-registry-host=never (set by use-npmrc) they are fetched from the registry they name, bypassing the proxy; without that flag they fail on npm 11 and newer. Normalize this lockfile - see PFM-ISSUE-34453.\n' \
    "$(basename "${lockfile}")" "${total}"

  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    # shellcheck disable=SC2016  # backticks here are markdown for the job summary, not command substitution
    {
      printf '### Lockfile entries outside the cplace npm proxy\n\n'
      printf '**%s** `resolved` entries in `%s` point somewhere other than the cplace npm proxy.\n\n' \
        "${total}" "${lockfile#"${GITHUB_WORKSPACE:-}/"}"
      printf '`use-npmrc` sets `replace-registry-host=never`, so npm fetches each of these URLs verbatim '
      printf '**from the registry the lockfile names, not through the cplace proxy**.\n\n'
      printf 'What would happen without that flag depends on the npm version: **npm 10.2.4** rewrites the '
      printf 'host onto the configured registry correctly, and the entry resolves *through* the proxy; '
      printf '**npm 11.3.0** drops the path prefix and fails with an `E404` masked as `***`. Both measured '
      printf '2026-08-14. Runners pinned to node 18.19.1 are on npm 10; developer machines, and any runner '
      printf 'moving to node 24, are not.\n\n'
      printf 'Fix by normalizing the lockfile onto the proxy (PFM-ISSUE-34453) - it then resolves through '
      printf 'the proxy on every npm version, with or without the flag, and the mitigation can be removed '
      printf 'once no lockfile reports this.\n\n'
      printf '<details><summary>First %s affected packages</summary>\n\n' "${MAX_LISTED}"
      printf '```\n'
      printf '%s\n' "${offenders}" | head -n "${MAX_LISTED}"
      (( total > MAX_LISTED )) && printf '… and %s more\n' "$((total - MAX_LISTED))"
      printf '```\n\n</details>\n\n'
    } >>"${GITHUB_STEP_SUMMARY}"
  fi

  return 0
}

main "$@"
