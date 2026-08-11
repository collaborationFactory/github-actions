#!/usr/bin/env bash
#
# Advisory check: warn when a lockfile has `resolved` URLs that do NOT go
# through the cplace JFrog npm proxy.
#
# Usage:
#   ./tools/scripts/lockfile/warn-foreign-registry.sh [<lockfile>]
#
# Runs inside the `use-npmrc` composite, so it inspects the CONSUMER's lockfile
# on the runner. Those entries resolve today only because `use-npmrc` sets
# `replace-registry-host=never`; without it npm rewrites their host onto the
# configured registry, drops that registry's path prefix, and fails with an
# E404 masked as *** (PFM-ISSUE-34453).
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

readonly PROXY_PREFIX='https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/'
readonly MAX_LISTED=10

main() {
  local lockfile="${1:-${GITHUB_WORKSPACE:-.}/package-lock.json}"

  # Every precondition is a silent success: an advisory check must not become a
  # new way for consumer pipelines to fail.
  [[ -f "${lockfile}" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local offenders total
  # Only http(s) `resolved` values are registry references. Local-path values
  # (e.g. "tools/eslint-rules" for a workspace-local plugin) are not hosted
  # anywhere and must not be reported - 4 of 41 FE repos have them.
  offenders="$(jq -r --arg proxy "${PROXY_PREFIX}" '
    (.packages // {})
    | to_entries[]
    | select(.key != "")
    | select((.value.resolved | type) == "string")
    | select(.value.resolved | test("^https?://"))
    | select((.value.resolved | startswith($proxy)) | not)
    | .key
  ' "${lockfile}" 2>/dev/null)" || return 0

  [[ -n "${offenders}" ]] || return 0

  total="$(printf '%s\n' "${offenders}" | wc -l | tr -d '[:space:]')"

  printf '::warning file=%s::%s entries in package-lock.json do not resolve via the cplace npm proxy. They install today only because use-npmrc sets replace-registry-host=never. Normalize this lockfile - see PFM-ISSUE-34453.\n' \
    "$(basename "${lockfile}")" "${total}"

  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    # shellcheck disable=SC2016  # backticks here are markdown for the job summary, not command substitution
    {
      printf '### Lockfile entries outside the cplace npm proxy\n\n'
      printf '**%s** `resolved` entries in `%s` point somewhere other than the cplace npm proxy.\n\n' \
        "${total}" "${lockfile#"${GITHUB_WORKSPACE:-}/"}"
      printf 'They install successfully only because `use-npmrc` sets `replace-registry-host=never`. '
      printf 'Without it npm rewrites their host onto the configured registry, drops its path prefix, '
      printf 'and fails with an `E404` masked as `***`.\n\n'
      printf 'Fix by normalizing the lockfile onto the proxy (PFM-ISSUE-34453); the mitigation can be '
      printf 'removed once no lockfile reports this.\n\n'
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
