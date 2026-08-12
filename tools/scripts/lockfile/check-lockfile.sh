#!/usr/bin/env bash
#
# Proves that a package-lock.json differs from its baseline ONLY in registry
# prefixes, and that every `resolved` URL points at the one correct proxy.
#
# Usage:
#   ./tools/scripts/lockfile/check-lockfile.sh [--baseline <ref-or-file>] [<candidate>]
#   ./tools/scripts/lockfile/check-lockfile.sh --prefix-only [<candidate>]
#
#   --baseline HEAD~1                 the commit before the lockfile commit (default: HEAD)
#   --baseline :2:                    "ours" during a merge conflict
#   --baseline :3:                    "theirs" during a merge conflict
#   --baseline path/to/other.json     an explicit file
#   --prefix-only                     assertion 2 only; THE PR GUARD
#
# The two modes are mutually exclusive, and the difference matters:
#
#   1. graph invariance - the whole document, with every `resolved` reduced to a
#      registry-independent tarball path, must equal the baseline. Forbids ANY
#      dependency change, so it verifies a normalization commit and must never
#      gate an everyday pull request.
#   2. prefix exactness - every `resolved` that is an http(s) URL must carry
#      exactly the one proxy prefix. This is what CI asserts.
#
# Neither alone is sufficient for a normalization commit: (1) is blind to WHICH
# host an entry moved to, and (2) is blind to everything except the host.
# See design.md Dimension 2.
#
# See tools/scripts/lockfile/README.md

set -euo pipefail

# shellcheck source=tools/scripts/lockfile/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() {
  err "usage: ${0##*/} [--baseline <git-ref-or-file>] [--prefix-only] [<candidate-lockfile>]"
  exit 2
}

# Writes the baseline lockfile to ${2}, resolving ${1} as a file path if one
# exists, otherwise as a git ref. Always prints what it resolved, so a wrong
# baseline is visible rather than silent.
resolve_baseline() {
  local ref="$1" out="$2"
  # The candidate's own path, so a nested lockfile compares against the same
  # path in the baseline ref. Hardcoding `package-lock.json` made
  # `--baseline HEAD sub/package-lock.json` either fail outright or, in a repo
  # with both a root and a nested lockfile, silently compare two different files
  # and report every entry as drifted.
  local lockfile_path="${3:-package-lock.json}"

  if [[ -f "${ref}" ]]; then
    cat "${ref}" >"${out}"
    info "baseline: file ${ref}"
    return
  fi

  local spec="${ref}"
  if [[ "${spec}" == *: ]]; then
    spec="${spec}${lockfile_path}" # `:2:` -> `:2:<path>`
  elif [[ "${spec}" != *:* ]]; then
    spec="${spec}:${lockfile_path}" # `HEAD~1` -> `HEAD~1:<path>`
  fi

  if ! git show "${spec}" >"${out}" 2>/dev/null; then
    die "cannot read baseline '${ref}' (tried '${spec}'); pass a git ref or an existing file"
  fi
  info "baseline: ${spec}"
}

# Assertion 1. Prints every drifted package path; returns 1 if any.
assert_graph_invariant() {
  local baseline="$1" candidate="$2" fp_base="$3" fp_cand="$4"
  local drift

  # Every step below is checked. main() calls this function inside a `||` list,
  # which disables `set -e` for its whole body, so an unchecked failure here does
  # not abort - it leaves `drift` empty and falls through to "PASS: dependency
  # graph identical to baseline". This is the strongest assertion in the toolkit
  # and the only one that ever looks at integrity hashes; it must fail CLOSED.
  fingerprint_of "${baseline}" >"${fp_base}" \
    || die "internal error: cannot fingerprint the baseline (is ${FINGERPRINT_JQ} present?)"
  fingerprint_of "${candidate}" >"${fp_cand}" \
    || die "internal error: cannot fingerprint ${candidate} (is ${FINGERPRINT_JQ} present?)"

  drift="$(jq -n -r --slurpfile a "${fp_base}" --slurpfile b "${fp_cand}" '
    ($a[0]) as $A | ($b[0]) as $B
    | [ ((($A | keys) + ($B | keys)) | unique)[]
        | select(. != "packages")
        | select(($A[.] | tojson) != ($B[.] | tojson))
        | "top-level key: " + . ]
      + [ (((($A.packages // {}) | keys) + (($B.packages // {}) | keys)) | unique)[]
          | select((($A.packages[.]) | tojson) != (($B.packages[.]) | tojson))
          # The root package uses the empty string as its key. Emitted verbatim
          # that is a blank line, which the caller test reads as "no drift",
          # silently hiding any change to the declared dependencies of this
          # project. Name it so it is both detectable and readable.
          | if . == "" then "<root package>" else . end ]
    | .[]
  ')" || die "internal error: graph comparison failed"

  if [[ -n "${drift}" ]]; then
    err "FAIL: the dependency graph differs from the baseline. Drifted entries:"
    while IFS= read -r package_path; do
      err "  ${package_path}"
    done <<<"${drift}"
    return 1
  fi

  info "PASS: dependency graph identical to baseline"
}

# Assertion 2. Prints every package path not on the one correct proxy.
assert_prefix_exactness() {
  local candidate="$1"
  local offenders distinct

  # Considers only entries whose `resolved` is an http(s) URL. A `link:`/`file:`/
  # workspace entry is not a registry reference at all, so rejecting it here
  # would block the first pull request introducing an npm workspace - and would
  # contradict warn-foreign-registry.sh, which passes over the same class.
  offenders="$(jq -r --arg proxy "${JFROG_NPM_PROXY}" --arg tarball_re "${TARBALL_PATH_RE}" \
    "[ ${JQ_REGISTRY_ENTRIES} | select((.value.resolved | sub(\$tarball_re; \"\")) != \$proxy) | .key ] | .[]" \
    "${candidate}")" || die "cannot read ${candidate} as a lockfile (is it valid JSON?)"

  distinct="$(jq -r --arg proxy "${JFROG_NPM_PROXY}" --arg tarball_re "${TARBALL_PATH_RE}" \
    "[ ${JQ_REGISTRY_ENTRIES} | (.value.resolved | sub(\$tarball_re; \"\")) ] | unique | length" \
    "${candidate}")" || die "cannot read ${candidate} as a lockfile (is it valid JSON?)"

  if [[ -n "${offenders}" ]]; then
    # Name the expectation, not the cardinality. `distinct` counts how many
    # prefixes exist, not how many are wrong, so a lockfile uniformly on npmjs
    # used to fail with "1 distinct registry prefixes found (expected exactly 1)"
    # - which reads as though the check itself is broken. That is the state of
    # every branch before this tooling lands, i.e. the rollout case.
    err "FAIL: every 'resolved' must carry exactly the cplace npm proxy prefix"
    err "      (${distinct} distinct prefix(es) present in ${candidate})."
    err "These entries do not resolve via the cplace npm proxy:"
    while IFS= read -r package_path; do
      err "  ${package_path}"
    done <<<"${offenders}"
    return 1
  fi

  info "PASS: exactly ${distinct} registry prefix, matching the expected proxy"
}

main() {
  local baseline='HEAD' candidate='package-lock.json' prefix_only=0
  local baseline_given=0 candidate_given=0

  while (($# > 0)); do
    case "$1" in
      --baseline)
        [[ $# -ge 2 ]] || usage
        baseline="$2"
        baseline_given=1
        shift 2
        ;;
      --prefix-only)
        prefix_only=1
        shift
        ;;
      -h | --help) usage ;;
      -*) usage ;;
      *)
        # A second positional used to silently replace the first, so the natural
        # two-file form `check base.json cand.json` dropped the baseline, fell
        # back to HEAD, and printed a drift report naming every package in the
        # repo - reading as catastrophic corruption of a file that is fine.
        if ((candidate_given)); then
          err "ERROR: only one candidate lockfile may be given (got '${candidate}' and '$1')."
          err "To compare two files, pass the baseline explicitly: --baseline '${candidate}' '$1'"
          usage
        fi
        candidate="$1"
        candidate_given=1
        shift
        ;;
    esac
  done

  # --baseline asks for a graph comparison; --prefix-only says not to make one.
  # Silently honouring the second reported OK on a poisoned integrity hash, and
  # `--baseline HEAD~1 --prefix-only` is the natural thing to type once the
  # README calls --prefix-only "the PR guard".
  if ((prefix_only)) && ((baseline_given)); then
    err "ERROR: --prefix-only and --baseline are mutually exclusive."
    err "  --prefix-only  asserts only that every entry resolves via the proxy (the PR guard)"
    err "  --baseline     additionally asserts the dependency graph is unchanged"
    usage
  fi

  require_jq
  [[ -f "${candidate}" ]] || die "no such lockfile: ${candidate}"
  assert_supported_lockfile "${candidate}"

  # --prefix-only is the ONGOING guard: it answers "does every entry resolve via
  # the proxy?" and nothing else, so a pull request may freely add, remove or
  # update dependencies. Graph invariance deliberately forbids exactly that, which
  # makes it the wrong gate for everyday pull requests - it belongs to verifying a
  # normalization commit, where the graph genuinely must not move.
  if ((prefix_only)); then
    info "candidate: ${candidate} (prefix-exactness only; dependency changes allowed)"
    if ! assert_prefix_exactness "${candidate}"; then
      err ""
      err "To fix: run ${NORMALIZE_CMD}"
      err "See ${README_PATH}"
      exit 1
    fi
    info "OK: ${candidate} resolves entirely via the cplace npm proxy"
    return 0
  fi

  command -v git >/dev/null 2>&1 || die "git is required but not installed"

  local baseline_file fp_base fp_cand
  baseline_file="$(mktemp)"
  fp_base="$(mktemp)" || die "internal error: mktemp failed"
  fp_cand="$(mktemp)" || die "internal error: mktemp failed"
  # The fingerprint scratch files belong to assert_graph_invariant but are made
  # and trapped here: every `|| die` in that function exits, so a cleanup at its
  # end is bypassed on exactly the fail-closed paths it exists to take.
  # shellcheck disable=SC2064  # expand paths now, not when the trap fires
  trap "rm -f '${baseline_file}' '${fp_base}' '${fp_cand}'" EXIT

  resolve_baseline "${baseline}" "${baseline_file}" "${candidate}"
  info "candidate: ${candidate}"

  # assert_resolvable is a precondition for FINGERPRINTING - every entry must
  # have a tarball path to compare on - not for prefix exactness. It therefore
  # belongs here, on the baseline path, and not in front of --prefix-only, where
  # it hard-failed on exactly the workspace and link: entries that mode promises
  # to allow.
  assert_resolvable "${baseline_file}"
  assert_resolvable "${candidate}"

  # Run BOTH assertions before failing, so one run reports every problem.
  local failed=0 graph_failed=0
  assert_graph_invariant "${baseline_file}" "${candidate}" "${fp_base}" "${fp_cand}" \
    || { failed=1; graph_failed=1; }
  assert_prefix_exactness "${candidate}" || failed=1

  if ((failed != 0)); then
    err ""
    if ((graph_failed)); then
      # Do not tell people to run the normalizer here: it rewrites prefixes and
      # would not touch a graph difference, so the advice would be misleading.
      err "A graph difference is NOT fixed by normalizing. Either the baseline is"
      err "wrong for what you are checking, or something other than a registry"
      err "prefix really did change - work out which before proceeding."
      err "For a pull request that legitimately changes dependencies, use --prefix-only."
    else
      err "To fix: run ${NORMALIZE_CMD}"
      err "then re-run: ${0} --baseline ${baseline}"
    fi
    err "See ${README_PATH}"
    exit 1
  fi

  info "OK: ${candidate} is normalized and graph-identical to its baseline"
}

main "$@"
