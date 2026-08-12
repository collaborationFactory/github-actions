#!/usr/bin/env bats
#
# Behavioural tests for check-lockfile.sh.
#
# The drift cases t1-t6 are the measured evidence behind the two-assertion
# design (design.md Dimension 2): graph invariance is blind to WHICH host an
# entry moved to, prefix exactness is blind to everything else. Each test below
# asserts not merely that the check fails, but that it fails via the RIGHT
# assertion - otherwise the two could silently collapse into one.
#
# Run with: bats tools/scripts/lockfile/

setup() {
  load 'test-helper'
  CHECK="${BATS_TEST_DIRNAME}/check-lockfile.sh"
  NORMALIZE="${BATS_TEST_DIRNAME}/normalize-lockfile.sh"

  # Mirrors reality: the baseline is the un-normalized base branch, the
  # candidate is the normalized PR.
  BASE="${BATS_TEST_TMPDIR}/base.json"
  CAND="${BATS_TEST_TMPDIR}/candidate.json"
  write_mixed_lockfile "${BASE}"
  write_mixed_lockfile "${CAND}"
  "${NORMALIZE}" "${CAND}" >/dev/null
}

@test "passes on a clean normalization" {
  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 0 ]
  [[ "${output}" == *'PASS: dependency graph identical to baseline'* ]]
  [[ "${output}" == *'PASS: exactly 1 registry prefix'* ]]
}

@test "t1: a changed tarball filename fails GRAPH INVARIANCE" {
  mutate "${CAND}" '.packages["node_modules/@scope/alpha"].resolved |=
    sub("alpha-1\\.0\\.0"; "alpha-9.9.9")'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'FAIL: the dependency graph differs'* ]]
  [[ "${output}" == *'node_modules/@scope/alpha'* ]]
  [[ "${output}" != *'distinct registry prefixes'* ]]
}

@test "t2: a typo'd proxy repo name fails PREFIX EXACTNESS" {
  mutate "${CAND}" '.packages["node_modules/beta"].resolved |=
    sub("cplace-npm"; "cplace-nmp")'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'must carry exactly the cplace npm proxy prefix'* ]]
  [[ "${output}" == *'node_modules/beta'* ]]
  [[ "${output}" == *'PASS: dependency graph identical to baseline'* ]]
}

@test "t3: a changed dependency edge fails GRAPH INVARIANCE" {
  mutate "${CAND}" '.packages["node_modules/@scope/alpha"].dependencies.beta = "^9.0.0"'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'FAIL: the dependency graph differs'* ]]
  [[ "${output}" == *'node_modules/@scope/alpha'* ]]
}

@test "t4: an entry left on npmjs fails PREFIX EXACTNESS" {
  mutate "${CAND}" '.packages["node_modules/beta"].resolved =
    "https://registry.npmjs.org/beta/-/beta-2.0.0.tgz"'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'must carry exactly the cplace npm proxy prefix'* ]]
  [[ "${output}" == *'node_modules/beta'* ]]
  [[ "${output}" == *'PASS: dependency graph identical to baseline'* ]]
}

@test "t5: a poisoned integrity fails GRAPH INVARIANCE" {
  mutate "${CAND}" '.packages["node_modules/beta"].integrity = "sha512-POISONED=="'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'FAIL: the dependency graph differs'* ]]
  [[ "${output}" == *'node_modules/beta'* ]]
}

@test "t6: a poisoned version fails GRAPH INVARIANCE" {
  mutate "${CAND}" '.packages["node_modules/beta"].version = "9.9.9"'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'FAIL: the dependency graph differs'* ]]
  [[ "${output}" == *'node_modules/beta'* ]]
}

@test "a dropped entry fails GRAPH INVARIANCE, naming the missing path" {
  mutate "${CAND}" 'del(.packages["node_modules/beta"])'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'node_modules/beta'* ]]
}

@test "a PREFIX failure names the normalizer, which does fix it" {
  mutate "${CAND}" '.packages["node_modules/beta"].resolved =
    "https://registry.npmjs.org/beta/-/beta-2.0.0.tgz"'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'normalize-lockfile.sh'* ]]
  [[ "${output}" == *'tools/scripts/lockfile/README.md'* ]]
}

@test "every failure names the README" {
  mutate "${CAND}" '.packages["node_modules/beta"].version = "9.9.9"'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'tools/scripts/lockfile/README.md'* ]]
}

@test "resolves a baseline from a git ref" {
  cd "${BATS_TEST_TMPDIR}"
  git init -q -b main .
  git config user.email 'test@example.com'
  git config user.name 'test'
  write_mixed_lockfile package-lock.json
  git add package-lock.json
  git commit -qm 'baseline'
  "${NORMALIZE}" package-lock.json >/dev/null

  run "${CHECK}" --baseline HEAD

  [ "${status}" -eq 0 ]
  [[ "${output}" == *'baseline: HEAD:package-lock.json'* ]]
}

@test "accepts two explicit file paths and prints both" {
  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 0 ]
  [[ "${output}" == *"baseline: file ${BASE}"* ]]
  [[ "${output}" == *"candidate: ${CAND}"* ]]
}

@test "fails readably on a baseline ref that cannot be resolved" {
  cd "${BATS_TEST_TMPDIR}"

  run "${CHECK}" --baseline no-such-ref "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'cannot read baseline'* ]]
}

@test "fails cleanly when the candidate does not exist" {
  run "${CHECK}" --baseline "${BASE}" "${BATS_TEST_TMPDIR}/absent.json"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'no such lockfile'* ]]
}

# --- the ongoing PR guard: --prefix-only ------------------------------------
#
# Raised in review of PR #163: comparing against the base branch fails every
# pull request that legitimately adds or updates a dependency. Graph invariance
# is for verifying a normalization commit, not for guarding everyday PRs.

@test "prefix-only accepts a PR that legitimately ADDS a dependency" {
  mutate "${CAND}" '.packages["node_modules/gamma"] = {
    "version": "3.0.0",
    "resolved": "https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/gamma/-/gamma-3.0.0.tgz",
    "integrity": "sha512-CCCC=="
  }'

  run "${CHECK}" --prefix-only "${CAND}"

  [ "${status}" -eq 0 ]
}

@test "prefix-only accepts a PR that UPDATES a dependency's version" {
  mutate "${CAND}" '.packages["node_modules/beta"].version = "2.1.0"
    | .packages["node_modules/beta"].resolved =
        "https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/beta/-/beta-2.1.0.tgz"'

  run "${CHECK}" --prefix-only "${CAND}"

  [ "${status}" -eq 0 ]
}

@test "prefix-only accepts a PR that REMOVES a dependency" {
  mutate "${CAND}" 'del(.packages["node_modules/beta"])'

  run "${CHECK}" --prefix-only "${CAND}"

  [ "${status}" -eq 0 ]
}

@test "prefix-only still rejects a newly added entry that is NOT on the proxy" {
  mutate "${CAND}" '.packages["node_modules/gamma"] = {
    "version": "3.0.0",
    "resolved": "https://registry.npmjs.org/gamma/-/gamma-3.0.0.tgz",
    "integrity": "sha512-CCCC=="
  }'

  run "${CHECK}" --prefix-only "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'node_modules/gamma'* ]]
}

@test "prefix-only needs no baseline, so it works outside a git repository" {
  cd "${BATS_TEST_TMPDIR}"

  run "${CHECK}" --prefix-only "${CAND}"

  [ "${status}" -eq 0 ]
  [[ "${output}" != *'baseline'* ]]
}

# --- the root package entry --------------------------------------------------
#
# The root package's key is the empty string. Emitted verbatim it produced a
# blank line that `[[ -n ... ]]` read as "no drift", so changes to the project's
# OWN declared dependencies passed silently.

@test "a change to the root package's declared dependencies fails GRAPH INVARIANCE" {
  mutate "${CAND}" '.packages[""].dependencies["@scope/alpha"] = "^9.0.0"'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'FAIL: the dependency graph differs'* ]]
  [[ "${output}" == *'<root package>'* ]]
}

@test "a graph failure does not advise running the normalizer, which cannot fix it" {
  mutate "${CAND}" '.packages["node_modules/beta"].version = "9.9.9"'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'NOT fixed by normalizing'* ]]
  [[ "${output}" == *'--prefix-only'* ]]
}

@test "no failure message leaks the JFrog host, which CI masks as ***" {
  mutate "${CAND}" '.packages["node_modules/beta"].resolved =
    "https://registry.npmjs.org/beta/-/beta-2.0.0.tgz"'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" != *'cplace.jfrog.io'* ]]
}

# --- review of PR #163, second round -----------------------------------------
#
# Every test below pins a defect that reproduced. Several of these FAILED OPEN:
# the check reported success on a lockfile it had not actually verified, which
# is worse than any false positive.

@test "graph invariance FAILS CLOSED when its own jq cannot run" {
  # main() calls the assertion inside a `||` list, which disables `set -e` for
  # the function body. An unchecked jq failure therefore left `drift` empty and
  # fell through to PASS - on a poisoned lockfile.
  mutate "${CAND}" '.packages["node_modules/beta"].integrity = "sha512-POISONED=="'
  local hidden="${BATS_TEST_TMPDIR}/fingerprint.jq.hidden"
  mv "${BATS_TEST_DIRNAME}/fingerprint.jq" "${hidden}"

  run "${CHECK}" --baseline "${BASE}" "${CAND}"
  local rc="${status}" out="${output}"

  mv "${hidden}" "${BATS_TEST_DIRNAME}/fingerprint.jq"

  [ "${rc}" -ne 0 ]
  [[ "${out}" != *'PASS: dependency graph identical'* ]]
  [[ "${out}" == *'cannot fingerprint'* ]]
}

@test "--prefix-only and --baseline are rejected together, not silently ranked" {
  mutate "${CAND}" '.packages["node_modules/beta"].integrity = "sha512-POISONED=="'

  run "${CHECK}" --baseline "${BASE}" --prefix-only "${CAND}"

  [ "${status}" -eq 2 ]
  [[ "${output}" == *'mutually exclusive'* ]]
}

@test "a second positional is rejected rather than silently replacing the first" {
  run "${CHECK}" "${BASE}" "${CAND}"

  [ "${status}" -eq 2 ]
  [[ "${output}" == *'only one candidate lockfile'* ]]
  [[ "${output}" == *'--baseline'* ]]
}

@test "the baseline is read from the candidate's own path, not a hardcoded one" {
  cd "${BATS_TEST_TMPDIR}"
  git init -q -b main .
  git config user.email 'test@example.com'
  git config user.name 'test'
  mkdir -p sub
  write_mixed_lockfile sub/package-lock.json
  git add -A
  git commit -qm 'baseline'
  "${NORMALIZE}" sub/package-lock.json >/dev/null

  run "${CHECK}" --baseline HEAD sub/package-lock.json

  [ "${status}" -eq 0 ]
  [[ "${output}" == *'baseline: HEAD:sub/package-lock.json'* ]]
}

@test "--prefix-only tolerates workspace and link: entries" {
  # These are not registry references at all. Rejecting them blocked the first
  # PR introducing an npm workspace, and contradicted warn-foreign-registry.sh,
  # which passes over the same class.
  mutate "${CAND}" '.packages["tools/eslint-rules"] = {"version":"1.0.0"}
    | .packages["node_modules/eslint-rules"] = {"resolved":"tools/eslint-rules","link":true}'

  run "${CHECK}" --prefix-only "${CAND}"

  [ "${status}" -eq 0 ]
}

@test "an unsupported lockfileVersion fails readably instead of a jq trace" {
  printf '{"name":"x","lockfileVersion":1}\n' >"${CAND}"

  run "${CHECK}" --prefix-only "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'lockfileVersion 1'* ]]
  [[ "${output}" != *'jq: error'* ]]
  # Must not pass vacuously by treating a missing .packages as "nothing wrong".
  [[ "${output}" != *'resolves entirely via'* ]]
}

@test "the prefix failure message does not contradict itself" {
  # `distinct` counts prefixes present, not wrong ones, so a lockfile uniformly
  # on npmjs used to fail with "1 distinct registry prefixes found (expected
  # exactly 1)" - the rollout case, reading as though the check were broken.
  mutate "${CAND}" '.packages["node_modules/@scope/alpha"].resolved =
      "https://registry.npmjs.org/@scope/alpha/-/alpha-1.0.0.tgz"
    | .packages["node_modules/beta"].resolved =
      "https://registry.npmjs.org/beta/-/beta-2.0.0.tgz"'

  run "${CHECK}" --prefix-only "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'must carry exactly the cplace npm proxy prefix'* ]]
  [[ "${output}" != *'distinct registry prefixes found (expected exactly 1)'* ]]
}
