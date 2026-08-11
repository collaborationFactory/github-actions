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
  [[ "${output}" == *'distinct registry prefixes'* ]]
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
  [[ "${output}" == *'distinct registry prefixes'* ]]
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

@test "every failure names the remediation command and the README" {
  mutate "${CAND}" '.packages["node_modules/beta"].version = "9.9.9"'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'normalize-lockfile.sh'* ]]
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

@test "no failure message leaks the JFrog host, which CI masks as ***" {
  mutate "${CAND}" '.packages["node_modules/beta"].resolved =
    "https://registry.npmjs.org/beta/-/beta-2.0.0.tgz"'

  run "${CHECK}" --baseline "${BASE}" "${CAND}"

  [ "${status}" -eq 1 ]
  [[ "${output}" != *'cplace.jfrog.io'* ]]
}
