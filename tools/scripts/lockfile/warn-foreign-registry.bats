#!/usr/bin/env bats
#
# Behavioural tests for warn-foreign-registry.sh.
#
# The overriding property is that this check is ADVISORY: it runs inside
# use-npmrc in every consumer's pipeline, so it must never fail a build no
# matter what it is pointed at.
#
# Run with: bats tools/scripts/lockfile/

setup() {
  load 'test-helper'
  WARN="${BATS_TEST_DIRNAME}/warn-foreign-registry.sh"
  TMP="${BATS_TEST_TMPDIR}/package-lock.json"
  SUMMARY="${BATS_TEST_TMPDIR}/summary.md"
}

@test "is silent on a lockfile that resolves entirely through the proxy" {
  write_mixed_lockfile "${TMP}"
  "${BATS_TEST_DIRNAME}/normalize-lockfile.sh" "${TMP}" >/dev/null

  run "${WARN}" "${TMP}"

  [ "${status}" -eq 0 ]
  [ -z "${output}" ]
}

@test "warns, with a count, when entries resolve elsewhere" {
  write_mixed_lockfile "${TMP}"

  run "${WARN}" "${TMP}"

  [ "${status}" -eq 0 ]
  [[ "${output}" == *'::warning'* ]]
  [[ "${output}" == *'1 entries'* ]]
}

@test "ignores local-path resolved values, which are not registry references" {
  write_mixed_lockfile "${TMP}"
  "${BATS_TEST_DIRNAME}/normalize-lockfile.sh" "${TMP}" >/dev/null
  mutate "${TMP}" '.packages["node_modules/local-plugin"] =
    {"version":"1.0.0","resolved":"tools/eslint-rules","link":true}'

  run "${WARN}" "${TMP}"

  [ "${status}" -eq 0 ]
  [ -z "${output}" ]
}

@test "writes a job summary when GITHUB_STEP_SUMMARY is set" {
  write_mixed_lockfile "${TMP}"

  GITHUB_STEP_SUMMARY="${SUMMARY}" run "${WARN}" "${TMP}"

  [ "${status}" -eq 0 ]
  [ -f "${SUMMARY}" ]
  grep -q 'outside the cplace npm proxy' "${SUMMARY}"
  grep -q 'node_modules/@scope/alpha' "${SUMMARY}"
}

@test "the warning names no URL, so it survives *** masking" {
  write_mixed_lockfile "${TMP}"

  GITHUB_STEP_SUMMARY="${SUMMARY}" run "${WARN}" "${TMP}"

  [[ "${output}" != *'cplace.jfrog.io'* ]]
  [[ "${output}" != *'registry.npmjs.org'* ]]
}

# --- advisory guarantee: none of these may fail a build -----------------------

@test "exits 0 and says nothing when the lockfile does not exist" {
  run "${WARN}" "${BATS_TEST_TMPDIR}/absent.json"

  [ "${status}" -eq 0 ]
  [ -z "${output}" ]
}

@test "exits 0 on a lockfile that is not valid JSON" {
  printf 'not json at all\n' >"${TMP}"

  run "${WARN}" "${TMP}"

  [ "${status}" -eq 0 ]
}

@test "exits 0 on a lockfile with no packages section" {
  printf '{"name":"x","lockfileVersion":3}\n' >"${TMP}"

  run "${WARN}" "${TMP}"

  [ "${status}" -eq 0 ]
  [ -z "${output}" ]
}

@test "falls back to GITHUB_WORKSPACE when given no argument" {
  write_mixed_lockfile "${BATS_TEST_TMPDIR}/package-lock.json"

  GITHUB_WORKSPACE="${BATS_TEST_TMPDIR}" run "${WARN}"

  [ "${status}" -eq 0 ]
  [[ "${output}" == *'::warning'* ]]
}

@test "reports an entry on the right host but with a stray path segment" {
  # `startswith($proxy)` passed this and reported nothing, while
  # check-lockfile.sh correctly rejected it. The advisory inventory decides when
  # the replace-registry-host mitigation can be removed, so a false negative
  # here could green-light removing it while lockfiles are still broken.
  write_mixed_lockfile "${TMP}"
  "${BATS_TEST_DIRNAME}/normalize-lockfile.sh" "${TMP}" >/dev/null
  mutate "${TMP}" '.packages["node_modules/beta"].resolved =
    "https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/extra/beta/-/beta-2.0.0.tgz"'

  run "${WARN}" "${TMP}"

  [ "${status}" -eq 0 ]
  [[ "${output}" == *'::warning'* ]]
  [[ "${output}" == *'1 entries'* ]]
}

@test "agrees with check-lockfile.sh about what is an offender" {
  write_mixed_lockfile "${TMP}"
  "${BATS_TEST_DIRNAME}/normalize-lockfile.sh" "${TMP}" >/dev/null
  mutate "${TMP}" '.packages["node_modules/beta"].resolved =
    "https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/extra/beta/-/beta-2.0.0.tgz"'

  run "${BATS_TEST_DIRNAME}/check-lockfile.sh" --prefix-only "${TMP}"
  local check_rc="${status}"
  run "${WARN}" "${TMP}"

  # check-lockfile fails (1) exactly when the advisory warns (non-empty output).
  [ "${check_rc}" -eq 1 ]
  [[ "${output}" == *'::warning'* ]]
}

@test "exits 0 silently when lib.sh cannot be sourced" {
  write_mixed_lockfile "${TMP}"
  local hidden="${BATS_TEST_TMPDIR}/lib.sh.hidden"
  mv "${BATS_TEST_DIRNAME}/lib.sh" "${hidden}"

  run "${WARN}" "${TMP}"
  local rc="${status}" out="${output}"

  mv "${hidden}" "${BATS_TEST_DIRNAME}/lib.sh"

  [ "${rc}" -eq 0 ]
  [ -z "${out}" ]
}
