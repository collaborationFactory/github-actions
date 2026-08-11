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

  [ "$(tail -c 1 "${TMP}" | xxd -p)" = '0a' ]
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
