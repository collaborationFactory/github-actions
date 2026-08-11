#!/usr/bin/env bash
#
# Proves that a package-lock.json differs from its baseline ONLY in registry
# prefixes, and that every `resolved` URL points at the one correct proxy.
#
# Usage:
#   ./tools/scripts/lockfile/check-lockfile.sh [--baseline <ref-or-file>] [<candidate>]
#
#   --baseline HEAD~1                 the commit before the lockfile commit (default: HEAD)
#   --baseline :2:                    "ours" during a merge conflict
#   --baseline :3:                    "theirs" during a merge conflict
#   --baseline path/to/other.json     an explicit file
#
# Two independent assertions, BOTH required to pass:
#   1. graph invariance - the whole document, with every `resolved` reduced to a
#      registry-independent tarball path, must equal the baseline;
#   2. prefix exactness - every `resolved` must carry exactly the one proxy prefix.
#
# Neither alone is sufficient: (1) is blind to WHICH host an entry moved to, and
# (2) is blind to everything except the host. See design.md Dimension 2.
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

  if [[ -f "${ref}" ]]; then
    cat "${ref}" >"${out}"
    info "baseline: file ${ref}"
    return
  fi

  local spec="${ref}"
  if [[ "${spec}" == *: ]]; then
    spec="${spec}package-lock.json" # `:2:` -> `:2:package-lock.json`
  elif [[ "${spec}" != *:* ]]; then
    spec="${spec}:package-lock.json" # `HEAD~1` -> `HEAD~1:package-lock.json`
  fi

  if ! git show "${spec}" >"${out}" 2>/dev/null; then
    die "cannot read baseline '${ref}' (tried '${spec}'); pass a git ref or an existing file"
  fi
  info "baseline: ${spec}"
}

# Assertion 1. Prints every drifted package path; returns 1 if any.
assert_graph_invariant() {
  local baseline="$1" candidate="$2"
  local fp_base fp_cand drift

  fp_base="$(mktemp)"
  fp_cand="$(mktemp)"

  fingerprint_of "${baseline}" >"${fp_base}"
  fingerprint_of "${candidate}" >"${fp_cand}"

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
  ')"

  # Cleaned up explicitly rather than via `trap ... RETURN`: a RETURN trap set
  # inside a function is global unless `functrace` is set, so it would also fire
  # on unrelated function returns later in the run.
  rm -f "${fp_base}" "${fp_cand}"

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

  offenders="$(jq -r --arg proxy "${JFROG_NPM_PROXY}" --arg tarball_re "${TARBALL_PATH_RE}" '
    .packages
    | to_entries[]
    | select(.key != "")
    | select((.value.resolved | sub($tarball_re; "")) != $proxy)
    | .key
  ' "${candidate}")"

  distinct="$(jq -r --arg tarball_re "${TARBALL_PATH_RE}" '
    [ .packages | to_entries[] | select(.key != "")
      | (.value.resolved | sub($tarball_re; "")) ] | unique | length
  ' "${candidate}")"

  if [[ -n "${offenders}" ]]; then
    err "FAIL: ${distinct} distinct registry prefixes found (expected exactly 1)."
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

  while (($# > 0)); do
    case "$1" in
      --baseline)
        [[ $# -ge 2 ]] || usage
        baseline="$2"
        shift 2
        ;;
      --prefix-only)
        prefix_only=1
        shift
        ;;
      -h | --help) usage ;;
      -*) usage ;;
      *)
        candidate="$1"
        shift
        ;;
    esac
  done

  require_jq
  [[ -f "${candidate}" ]] || die "no such lockfile: ${candidate}"
  assert_resolvable "${candidate}"

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

  local baseline_file
  baseline_file="$(mktemp)"
  # shellcheck disable=SC2064  # expand path now, not when the trap fires
  trap "rm -f '${baseline_file}'" EXIT

  resolve_baseline "${baseline}" "${baseline_file}"
  info "candidate: ${candidate}"

  assert_resolvable "${baseline_file}"

  # Run BOTH assertions before failing, so one run reports every problem.
  local failed=0 graph_failed=0
  assert_graph_invariant "${baseline_file}" "${candidate}" || { failed=1; graph_failed=1; }
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
