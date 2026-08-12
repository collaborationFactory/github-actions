#!/usr/bin/env bats
#
# Behavioural tests for normalize-lockfile.sh.
#
# Run with: bats tools/scripts/lockfile/

setup() {
  load 'test-helper'
  NORMALIZE="${BATS_TEST_DIRNAME}/normalize-lockfile.sh"
  TMP="${BATS_TEST_TMPDIR}/package-lock.json"
}

@test "rewrites npmjs entries onto the proxy and leaves proxy entries alone" {
  write_mixed_lockfile "${TMP}"

  run "${NORMALIZE}" "${TMP}"

  [ "${status}" -eq 0 ]
  [ "$(grep -c 'registry.npmjs.org' "${TMP}" || true)" -eq 0 ]
  [ "$(jq -r '.packages["node_modules/@scope/alpha"].resolved' "${TMP}")" \
    = "${PROXY}@scope/alpha/-/alpha-1.0.0.tgz" ]
  [ "$(jq -r '.packages["node_modules/beta"].resolved' "${TMP}")" \
    = "${PROXY}beta/-/beta-2.0.0.tgz" ]
  [ "$(jq -r '.packages["node_modules/@scope/alpha"].integrity' "${TMP}")" = 'sha512-AAAA==' ]
}

@test "reports how many entries it rewrote" {
  write_mixed_lockfile "${TMP}"

  run "${NORMALIZE}" "${TMP}"

  [ "${status}" -eq 0 ]
  [[ "${output}" == *'entries rewritten: 1'* ]]
}

@test "is idempotent - a second run rewrites nothing and changes no bytes" {
  write_mixed_lockfile "${TMP}"
  "${NORMALIZE}" "${TMP}" >/dev/null
  local before
  before="$(wc -c <"${TMP}")"

  run "${NORMALIZE}" "${TMP}"

  [ "${status}" -eq 0 ]
  [[ "${output}" == *'entries rewritten: 0'* ]]
  [[ "${output}" == *'already normalized'* ]]
  [ "$(wc -c <"${TMP}")" -eq "${before}" ]
}

@test "leaves version, integrity and dependency edges untouched" {
  write_mixed_lockfile "${TMP}"
  local before
  before="$(jq -S 'del(.packages[].resolved)' "${TMP}")"

  "${NORMALIZE}" "${TMP}" >/dev/null

  [ "$(jq -S 'del(.packages[].resolved)' "${TMP}")" = "${before}" ]
}

@test "preserves the trailing newline" {
  write_mixed_lockfile "${TMP}"

  "${NORMALIZE}" "${TMP}" >/dev/null

  # od, not xxd: the workflow installs only bats and shellcheck, so anything
  # outside coreutils is an undeclared dependency on the runner image.
  [ "$(tail -c 1 "${TMP}" | od -An -tx1 | tr -d '[:space:]')" = '0a' ]
}

@test "fails, naming the package path, when an entry has no resolved URL" {
  write_unresolvable_lockfile "${TMP}"

  run "${NORMALIZE}" "${TMP}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'node_modules/beta'* ]]
  [[ "${output}" == *'no usable tarball URL'* ]]
}

@test "fails, naming the package path, on a git+ssh resolved URL" {
  write_git_protocol_lockfile "${TMP}"

  run "${NORMALIZE}" "${TMP}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'node_modules/beta'* ]]
  # A jq capture stack trace would leak through here instead of a named path.
  [[ "${output}" != *'jq: error'* ]]
}

@test "fails, naming the package path, on a tarball URL that is not .tgz" {
  write_mixed_lockfile "${TMP}"
  mutate "${TMP}" '.packages["node_modules/beta"].resolved =
    "https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/beta/-/beta-2.0.0.zip"'

  run "${NORMALIZE}" "${TMP}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'node_modules/beta'* ]]
  [[ "${output}" != *'jq: error'* ]]
}

@test "leaves the lockfile untouched when it refuses to normalize" {
  write_git_protocol_lockfile "${TMP}"
  local before
  before="$(cat "${TMP}")"

  run "${NORMALIZE}" "${TMP}"

  [ "${status}" -eq 1 ]
  [ "$(cat "${TMP}")" = "${before}" ]
}

@test "fails cleanly when the lockfile does not exist" {
  run "${NORMALIZE}" "${BATS_TEST_TMPDIR}/absent.json"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'no such lockfile'* ]]
}

@test "no failure message leaks the JFrog host, which CI masks as ***" {
  write_unresolvable_lockfile "${TMP}"

  run "${NORMALIZE}" "${TMP}"

  [ "${status}" -eq 1 ]
  [[ "${output}" != *'cplace.jfrog.io'* ]]
}

@test "the reported count matches what the rewrite actually changes" {
  # count_foreign_entries used `startswith($proxy)` while the rewrite asked
  # whether $proxy + <captured tarball path> differed. An entry already under
  # the proxy host but with a stray path segment satisfied the first and not the
  # second, so the normalizer reported "0 rewritten / already normalized" while
  # silently rewriting the file - and README Flow 1 makes that count the
  # documented verification signal.
  write_mixed_lockfile "${TMP}"
  mutate "${TMP}" '.packages["node_modules/beta"].resolved =
    "https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/extra/beta/-/beta-2.0.0.tgz"'
  local before
  before="$(wc -c <"${TMP}")"

  run "${NORMALIZE}" "${TMP}"

  [ "${status}" -eq 0 ]
  [[ "${output}" == *'entries rewritten: 2'* ]]
  [[ "${output}" != *'already normalized'* ]]
  [ "$(wc -c <"${TMP}")" -ne "${before}" ]
}

@test "an unsupported lockfileVersion fails readably instead of a jq trace" {
  printf '{"name":"x","lockfileVersion":1}\n' >"${TMP}"

  run "${NORMALIZE}" "${TMP}"

  [ "${status}" -eq 1 ]
  [[ "${output}" == *'lockfileVersion 1'* ]]
  [[ "${output}" != *'jq: error'* ]]
}

@test "the self-assertion FAILS CLOSED and leaves the lockfile untouched when it cannot run" {
  # `if ! diff -q <(fingerprint_of A) <(fingerprint_of B)` disabled `set -e` for
  # the condition, so a failing fingerprint_of produced two empty streams, diff
  # called them identical, and the file was overwritten unverified with exit 0.
  write_mixed_lockfile "${TMP}"
  local before
  before="$(cat "${TMP}")"
  local hidden="${BATS_TEST_TMPDIR}/fingerprint.jq.hidden"
  mv "${BATS_TEST_DIRNAME}/fingerprint.jq" "${hidden}"

  run "${NORMALIZE}" "${TMP}"
  local rc="${status}" out="${output}"

  mv "${hidden}" "${BATS_TEST_DIRNAME}/fingerprint.jq"

  [ "${rc}" -ne 0 ]
  [[ "${out}" == *'left untouched'* ]]
  [ "$(cat "${TMP}")" = "${before}" ]
}
