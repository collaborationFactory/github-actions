#!/usr/bin/env bats
#
# Behavioral tests for resolve-consumers.sh.
#
# Run with: bats tools/scripts/backend-e2e/

setup() {
  load 'test-helper'
  export GITHUB_OUTPUT="${BATS_TEST_TMPDIR}/github_output"
  : >"${GITHUB_OUTPUT}"
  mkdir -p "${WORK}/e2e"
  printf '%s\n' '{"devDependencies":{"@cplace-next/cf-e2e-testing-sdk":"1.0.0","cypress":"14.0.0"}}' >"${WORK}/e2e/package.json"
  make_assets_dir plugin.a '{"dependencies":{"@cplace-next/cf-platform":"1.0.0","lodash":"4.17.21"}}'
  make_assets_dir plugin.b '{"dependencies":{"@cplace-next/cf-platform":"1.0.0","@cplace-next/cf-shell":"1.0.0"}}'
}

# output_of <key>: the value resolve-consumers.sh wrote for <key>
output_of() {
  sed -n "s/^$1=//p" "${GITHUB_OUTPUT}"
}

consumers() {
  run env PACKAGES="$1" "$SCRIPTS/resolve-consumers.sh" "${WORK}" "${WORK}/e2e"
}

@test "a package only the backend consumes runs, listed once across plugins" {
  consumers '["@cplace-next/cf-platform","@cplace-next/cf-shell","@cplace-next/other"]'

  [ "$status" -eq 0 ]
  [ "$(output_of backend_packages)" = '["@cplace-next/cf-platform","@cplace-next/cf-shell"]' ]
  [ "$(output_of e2e_packages)" = '[]' ]
  [ "$(output_of run)" = true ]
}

@test "a package only cplace-e2e consumes runs" {
  consumers '["@cplace-next/cf-e2e-testing-sdk"]'

  [ "$status" -eq 0 ]
  [ "$(output_of backend_packages)" = '[]' ]
  [ "$(output_of e2e_packages)" = '["@cplace-next/cf-e2e-testing-sdk"]' ]
  [ "$(output_of run)" = true ]
}

@test "packages nobody consumes skip" {
  consumers '["@cplace-next/unused"]'

  [ "$status" -eq 0 ]
  [ "$(output_of backend_packages)" = '[]' ]
  [ "$(output_of e2e_packages)" = '[]' ]
  [ "$(output_of run)" = false ]
}

@test "an empty package list skips" {
  consumers '[]'

  [ "$status" -eq 0 ]
  [ "$(output_of run)" = false ]
}

@test "a blank package list counts as empty" {
  consumers ' '

  [ "$status" -eq 0 ]
  [ "$(output_of backend_packages)" = '[]' ]
  [ "$(output_of run)" = false ]
}

@test "a backend without assets warns and consumes nothing" {
  mkdir -p "${BATS_TEST_TMPDIR}/empty"

  run env PACKAGES='["@cplace-next/cf-platform"]' "$SCRIPTS/resolve-consumers.sh" "${BATS_TEST_TMPDIR}/empty" "${WORK}/e2e"

  [ "$status" -eq 0 ]
  [[ "$output" == *"::warning::"*"has no */assets/package.json"* ]]
  [ "$(output_of run)" = false ]
}

@test "an invalid package list fails" {
  consumers 'not json'

  [ "$status" -ne 0 ]
  [ ! -s "${GITHUB_OUTPUT}" ]
}

@test "wrong arguments fail with the usage" {
  run "$SCRIPTS/resolve-consumers.sh" "${WORK}"

  [ "$status" -eq 2 ]
  [[ "$output" == *'Usage:'* ]]
}
