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
# The `\.tgz` suffix is required rather than accepting any filename, so the
# regex matches what the documentation and error messages promise. All 542
# entries are `.tgz` today; anything else is an unexpected shape that should
# fail loudly rather than be silently rehosted.
#
# Defined once, here, and passed to jq via --arg, so that the normalizer and
# fingerprint.jq can never drift apart.
readonly TARBALL_PATH_RE='(?<t>(?:@[^/]+/)?[^/]+/-/[^/]+\.tgz)$'

# Shape every non-root entry's `resolved` must have. Checked BEFORE any
# `capture`, because jq's capture raises an error rather than returning null
# when it does not match - which would replace a readable "package X has no
# usable tarball URL" with a jq stack trace.
#
# The scheme is matched case-insensitively because npm treats it that way: a
# `HTTPS://` entry is a registry reference and must be normalized like any
# other. The `\.tgz` suffix stays case-sensitive - an unexpected shape should
# fail loudly rather than be silently rehosted.
readonly RESOLVED_URL_RE='^(?i:https?)://[^/]+/.*(?:@[^/]+/)?[^/]+/-/[^/]+\.tgz$'

# The single definition of "which entries this tooling has an opinion about",
# and of "what a normalized entry looks like". Three hand-written copies of this
# predicate had drifted apart: `count_foreign_entries` asked `startswith($proxy)`
# while the rewrite asked "does $proxy + <captured tarball path> differ from the
# current value?", so an entry already under the proxy host but with a stray path
# segment was counted as normalized and then silently rewritten anyway.
#
# Requires --arg proxy and --arg tarball_re. Selects only entries whose `resolved`
# is an http(s) URL: `link:`/`file:`/workspace values are not registry references
# and must be passed over rather than rejected. The scheme test carries "i"
# because npm reads it case-insensitively - without the flag a `HTTPS://` entry
# was not a registry entry at all, so --prefix-only reported OK on a lockfile
# pointing at an arbitrary host.
# shellcheck disable=SC2016  # $proxy/$tarball_re are jq variables, bound via --arg
readonly JQ_REGISTRY_ENTRIES='
  (.packages // {})
  | to_entries[]
  | select(.key != "")
  | select((.value.resolved | type) == "string")
  | select(.value.resolved | test("^https?://"; "i"))
'

# Given such an entry, true when the rewrite would change it.
# shellcheck disable=SC2016  # $proxy/$tarball_re are jq variables, bound via --arg
readonly JQ_NEEDS_REWRITE='
  select((.value.resolved | test($tarball_re))
         and (.value.resolved != ($proxy + (.value.resolved | capture($tarball_re) | .t))))
'

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

# These scripts operate on `.packages`, which exists only from lockfileVersion 2.
# Guarding `.packages` alone would make a v1 file pass vacuously - reporting
# "resolves entirely via the proxy" having examined nothing at all, which is a
# worse outcome than the raw jq trace it replaced. Fail loudly instead.
assert_supported_lockfile() {
  local lockfile="$1" version
  version="$(jq -r '.lockfileVersion // "missing"' "${lockfile}" 2>/dev/null)" \
    || die "cannot read ${lockfile} as JSON"

  case "${version}" in
    2 | 3) return 0 ;;
    missing) die "${lockfile} has no lockfileVersion - is it a package-lock.json? See ${README_PATH}" ;;
    *) die "${lockfile} is lockfileVersion ${version}; these scripts need 2 or 3 (they operate on '.packages'). See ${README_PATH}" ;;
  esac
}

# Fails, naming every offending package path, if any non-root entry lacks a
# usable tarball URL. Never echoes a URL: CI masks the JFrog host as ***, so a
# message built from one is unreadable exactly when it matters most.
assert_resolvable() {
  local lockfile="$1"
  local offenders
  # `(.packages // {})`, not `.packages`: a lockfileVersion 1 or hand-truncated
  # file has no such section, and dereferencing it raises a raw jq trace with
  # exit 5 - the unreadable failure these scripts exist to eliminate.
  offenders="$(jq -r --arg url_re "${RESOLVED_URL_RE}" '
    (.packages // {})
    | to_entries[]
    | select(.key != "")
    | select(((.value.resolved | type) != "string")
             or ((.value.resolved | test($url_re)) | not))
    | .key
  ' "${lockfile}")" || die "cannot read ${lockfile} as a lockfile (is it valid JSON?)"

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

# Number of entries the rewrite would actually change - i.e. how much work there
# is to do. Uses the rewrite's own predicate, so the reported count cannot
# disagree with what the normalizer does to the file. README Flow 1 makes this
# number the documented verification signal for a normalization commit, so it
# must not be able to say "untouched" about a file that was modified.
count_foreign_entries() {
  jq --arg proxy "${JFROG_NPM_PROXY}" --arg tarball_re "${TARBALL_PATH_RE}" \
    "[ ${JQ_REGISTRY_ENTRIES} | ${JQ_NEEDS_REWRITE} ] | length" "$1" \
    || die "cannot read $1 as a lockfile (is it valid JSON?)"
}
