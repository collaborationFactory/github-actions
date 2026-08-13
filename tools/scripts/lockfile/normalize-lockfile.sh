#!/usr/bin/env bash
#
# Rewrites every `resolved` URL in a package-lock.json onto the cplace JFrog npm
# proxy, changing nothing else. Idempotent.
#
# Usage:
#   ./tools/scripts/lockfile/normalize-lockfile.sh [<lockfile>]
#
# Defaults to ./package-lock.json.
#
# Requires only bash and jq - no node, no `npm ci`. That is the point: this
# script repairs the lockfile whose npmjs URLs make `npm ci` fail against a
# JFrog ~/.npmrc, so it cannot depend on `npm ci` having worked.
#
# See tools/scripts/lockfile/README.md

set -euo pipefail

# shellcheck source=tools/scripts/lockfile/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  local lockfile="${1:-package-lock.json}"

  require_jq
  [[ -f "${lockfile}" ]] || die "no such lockfile: ${lockfile}"
  assert_supported_lockfile "${lockfile}"

  assert_resolvable "${lockfile}"

  local before_bytes rewritten
  before_bytes="$(byte_size "${lockfile}")"
  rewritten="$(count_foreign_entries "${lockfile}")"

  local tmp
  tmp="$(mktemp)"
  # shellcheck disable=SC2064  # expand ${tmp} now, not when the trap fires
  trap "rm -f '${tmp}'" EXIT

  # The guards are the shared predicate's own terms (lib.sh's
  # JQ_REGISTRY_ENTRIES), so that what this rewrites and what
  # count_foreign_entries reports cannot disagree. Without the `.key != ""` arm
  # the root entry was rewritten while the count - which excludes it - still
  # said "entries rewritten: 0, already normalized" about a changed file; and a
  # root `resolved` that is not a tarball URL lost its key entirely, because a
  # non-matching capture yields empty and `|= empty` deletes.
  jq --arg proxy "${JFROG_NPM_PROXY}" --arg tarball_re "${TARBALL_PATH_RE}" '
    .packages |= with_entries(
      if .key != ""
        and (.value | type) == "object"
        and (.value.resolved | type) == "string"
        and (.value.resolved | test("^https?://"; "i"))
      then
        .value.resolved |= ($proxy + (capture($tarball_re) | .t))
      else
        .
      end
    )
  ' "${lockfile}" >"${tmp}" || die "internal error: the rewrite failed; ${lockfile} left untouched"

  # Self-assertion. Secondary by design: it cannot see drift that arrived BEFORE
  # this run (a bad merge), which is why check-lockfile.sh compares against a git
  # baseline instead. It does make this script safe to run standalone.
  #
  # Both fingerprints are materialised and CHECKED first, rather than compared
  # through process substitution inside `if !`. That construct disables `set -e`
  # for the condition, so if fingerprint_of failed, both substitutions produced
  # empty output, `diff` called them identical, the assertion "passed" - and the
  # lockfile was overwritten unverified, exit 0. It has to fail CLOSED: this is
  # the step that decides whether to write the file at all.
  local fp_before fp_after
  fp_before="$(mktemp)" || die "internal error: mktemp failed"
  fp_after="$(mktemp)" || die "internal error: mktemp failed"
  # shellcheck disable=SC2064  # expand paths now, not when the trap fires
  trap "rm -f '${tmp}' '${fp_before}' '${fp_after}'" EXIT

  fingerprint_of "${lockfile}" >"${fp_before}" \
    || die "internal error: cannot fingerprint ${lockfile} (is ${FINGERPRINT_JQ} present?); left untouched"
  fingerprint_of "${tmp}" >"${fp_after}" \
    || die "internal error: cannot fingerprint the rewritten lockfile (is ${FINGERPRINT_JQ} present?); ${lockfile} left untouched"

  if ! diff -q "${fp_before}" "${fp_after}" >/dev/null; then
    die "internal error: normalization altered the dependency graph; ${lockfile} left untouched"
  fi

  # `cat >` rather than `mv`, to preserve the file's existing permissions.
  cat "${tmp}" >"${lockfile}"

  local after_bytes
  after_bytes="$(byte_size "${lockfile}")"

  info "normalized ${lockfile}"
  info "  entries rewritten: ${rewritten}"
  info "  byte delta:        $((after_bytes - before_bytes)) (${before_bytes} -> ${after_bytes})"
  if ((rewritten == 0)); then
    info "  already normalized - nothing to do"
  fi
}

main "$@"
