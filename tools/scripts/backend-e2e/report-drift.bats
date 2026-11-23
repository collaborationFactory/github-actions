#!/usr/bin/env bats
#
# Behavioral tests for report-drift.sh. npm is stubbed on PATH.
#
# Run with: bats tools/scripts/backend-e2e/

setup() {
  load 'test-helper'
  stub_npm
  export GITHUB_OUTPUT="${BATS_TEST_TMPDIR}/github_output" GITHUB_STEP_SUMMARY="${BATS_TEST_TMPDIR}/summary"
  : >"${GITHUB_OUTPUT}"
  : >"${GITHUB_STEP_SUMMARY}"
  mkdir -p "${WORK}/.github"
  printf 'FE_PACKAGE_PREFIXES=@cplace-next' >"${WORK}/.github/.frontend-upmerge-env"
  make_assets_dir plugin.a '{"dependencies":{"@cplace-next/cf-platform":"0.0.0-SNAPSHOT-a","@cplace-next/cf-shell":"0.0.0-SNAPSHOT-b","lodash":"4.17.21"}}'
}

output_of() {
  sed -n "s/^$1=//p" "${GITHUB_OUTPUT}"
}

drift() {
  run env PACKAGES="${PACKAGES:-[]}" FE_BASE="$1" "$SCRIPTS/report-drift.sh" "${WORK}"
}

@test "a current and a behind pin are both reported, and only the behind one counts" {
  npm_view_returns @cplace-next/cf-platform@snapshot '"0.0.0-SNAPSHOT-a"'
  npm_view_returns @cplace-next/cf-shell@snapshot '"0.0.0-SNAPSHOT-c"'

  drift master

  [ "$status" -eq 0 ]
  [ "$(output_of drift)" = 1 ]
  grep -qF '| `@cplace-next/cf-platform` | `0.0.0-SNAPSHOT-a` | `0.0.0-SNAPSHOT-a` | current |' "${GITHUB_STEP_SUMMARY}"
  grep -qF '| `@cplace-next/cf-shell` | `0.0.0-SNAPSHOT-b` | `0.0.0-SNAPSHOT-c` | behind |' "${GITHUB_STEP_SUMMARY}"
  ! grep -q lodash "${GITHUB_STEP_SUMMARY}"
}

@test "a release line looks up the highest X.Y version" {
  make_assets_dir plugin.a '{"dependencies":{"@cplace-next/cf-platform":"26.1.3"}}'
  npm_view_returns @cplace-next/cf-platform@26.1 '["26.1.1","26.1.3","26.1.4"]'

  drift release/26.1

  [ "$status" -eq 0 ]
  assert_npm_called_in "${PWD}" "view @cplace-next/cf-platform@26.1 version --json"
  [ "$(output_of drift)" = 1 ]
  grep -qF '| `26.1.3` | `26.1.4` | behind |' "${GITHUB_STEP_SUMMARY}"
}

@test "an npm failure warns, names the package and exits 0" {
  npm_view_returns @cplace-next/cf-platform@snapshot '"0.0.0-SNAPSHOT-a"'

  drift master

  [ "$status" -eq 0 ]
  [[ "$output" == *'::warning::Could not look up the latest @cplace-next/cf-shell@snapshot'* ]]
  [ "$(output_of drift)" = 0 ]
  grep -qF '| `@cplace-next/cf-shell` | `0.0.0-SNAPSHOT-b` | ? | unknown |' "${GITHUB_STEP_SUMMARY}"
}

@test "a published package is excluded" {
  npm_view_returns @cplace-next/cf-shell@snapshot '"0.0.0-SNAPSHOT-b"'

  PACKAGES='["@cplace-next/cf-platform"]' drift main

  [ "$status" -eq 0 ]
  ! grep -q cf-platform "${GITHUB_STEP_SUMMARY}"
  ! grep -q cf-platform "${NPM_LOG}"
  [ "$(output_of drift)" = 0 ]
}

@test "no prefixes file writes one notice and no table" {
  rm "${WORK}/.github/.frontend-upmerge-env"

  drift master

  [ "$status" -eq 0 ]
  [[ "$output" == *'::notice::No FE_PACKAGE_PREFIXES'* ]]
  [ ! -s "${GITHUB_STEP_SUMMARY}" ]
  [ "$(npm_call_count)" -eq 0 ]
  [ "$(output_of drift)" = 0 ]
}

@test "a line without an FE base writes one notice and no table" {
  drift feature/x

  [ "$status" -eq 0 ]
  [[ "$output" == *"::notice::'feature/x' is not a backend line"* ]]
  [ ! -s "${GITHUB_STEP_SUMMARY}" ]
}

@test "the same pin in two plugins is one row" {
  make_assets_dir plugin.b '{"dependencies":{"@cplace-next/cf-platform":"0.0.0-SNAPSHOT-a"}}'
  npm_view_returns @cplace-next/cf-platform@snapshot '"0.0.0-SNAPSHOT-a"'
  npm_view_returns @cplace-next/cf-shell@snapshot '"0.0.0-SNAPSHOT-b"'

  drift master

  [ "$status" -eq 0 ]
  [ "$(grep -c 'cf-platform' "${GITHUB_STEP_SUMMARY}")" -eq 1 ]
}
