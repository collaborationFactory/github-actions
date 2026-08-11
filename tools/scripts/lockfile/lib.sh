#!/usr/bin/env bash
#
# Shared constants and helpers for the package-lock.json normalizer and checker.
#
# This file is sourced, never executed. It deliberately depends on nothing but
# bash and jq: the scripts that source it exist to repair the lockfile that
# makes `npm ci` fail, so they cannot require `npm ci` to have succeeded.
#
# See tools/scripts/lockfile/README.md

# The one npm proxy every `resolved` URL in this repository's package-lock.json
# must point at.
#
# Hard-coded on purpose. This constant *is* the invariant that check-lockfile.sh
# asserts; if it were caller-supplied, a typo'd prefix handed to both scripts
# would validate itself. It is not a secret - it is already committed in
# plaintext in every JFrog-hosted lockfile entry - and it is NOT the JFROG_URL
# publish target (`.../artifactory/cplace-npm-local`, see
# tools/scripts/artifacts/configuration.ts:2), which points somewhere else.
readonly JFROG_NPM_PROXY='https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/'

# Extracts the registry-independent tarball path from a `resolved` URL:
#   https://<host>/<any/prefix>/@scope/name/-/name-1.2.3.tgz -> @scope/name/-/name-1.2.3.tgz
#   https://<host>/<any/prefix>/name/-/name-1.2.3.tgz        -> name/-/name-1.2.3.tgz
# Anchored at the end and safe because every `resolved` in this lockfile
# contains exactly one `/-/` (verified: 542/542).
#
# Defined once, here, and passed to jq via --arg, so that the normalizer and
# fingerprint.jq can never drift apart.
readonly TARBALL_PATH_RE='(?<t>(?:@[^/]+/)?[^/]+/-/[^/]+)$'

# Shape every non-root entry's `resolved` must have. Checked BEFORE any
# `capture`, because jq's capture raises an error rather than returning null
# when it does not match - which would replace a readable "package X has no
# usable tarball URL" with a jq stack trace.
readonly RESOLVED_URL_RE='^https?://[^/]+/.*(?:@[^/]+/)?[^/]+/-/[^/]+$'

readonly README_PATH='tools/scripts/lockfile/README.md'
# shellcheck disable=SC2034  # consumed by check-lockfile.sh, which shellcheck cannot see from here
readonly NORMALIZE_CMD='./tools/scripts/lockfile/normalize-lockfile.sh'

LOCKFILE_TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly LOCKFILE_TOOLS_DIR
readonly FINGERPRINT_JQ="${LOCKFILE_TOOLS_DIR}/fingerprint.jq"

info() {
  printf '%s\n' "$*"
}

err() {
  printf '%s\n' "$*" >&2
}

die() {
  err "ERROR: $*"
  exit 1
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    die "jq is required but not installed (macOS: brew install jq). See ${README_PATH}"
  fi
}

byte_size() {
  wc -c <"$1" | tr -d '[:space:]'
}

# Fails, naming every offending package path, if any non-root entry lacks a
# usable tarball URL. Never echoes a URL: CI masks the JFrog host as ***, so a
# message built from one is unreadable exactly when it matters most.
assert_resolvable() {
  local lockfile="$1"
  local offenders
  offenders="$(jq -r --arg url_re "${RESOLVED_URL_RE}" '
    .packages
    | to_entries[]
    | select(.key != "")
    | select(((.value.resolved | type) != "string")
             or ((.value.resolved | test($url_re)) | not))
    | .key
  ' "${lockfile}")"

  if [[ -n "${offenders}" ]]; then
    err "ERROR: these entries in ${lockfile} have no usable tarball URL:"
    while IFS= read -r package_path; do
      err "  ${package_path}"
    done <<<"${offenders}"
    err ""
    err 'Every non-root entry must carry a standard <name>/-/<file>.tgz "resolved" URL.'
    err "A link:/file:/git+ssh: dependency is a deliberate, reviewed loosening of this"
    err "assertion - see ${README_PATH}."
    exit 1
  fi
}

# Reduces a lockfile to its registry-independent comparable form. Sorted keys so
# the output is diffable and order-insensitive.
fingerprint_of() {
  jq -S --arg tarball_re "${TARBALL_PATH_RE}" -f "${FINGERPRINT_JQ}" "$1"
}

# Number of entries not already on the proxy - i.e. how much work there is to do.
count_foreign_entries() {
  jq --arg proxy "${JFROG_NPM_PROXY}" '
    [ .packages[]
      | select((type == "object") and ((.resolved | type) == "string"))
      | select((.resolved | startswith($proxy)) | not)
    ] | length
  ' "$1"
}
