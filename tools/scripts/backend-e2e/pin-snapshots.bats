#!/usr/bin/env bats
#
# Behavioral tests for pin-snapshots.sh. npm is stubbed on PATH.
#
# Run with: bats tools/scripts/backend-e2e/

bats_require_minimum_version 1.5.0

setup() {
  load 'test-helper'
  stub_npm
}

@test "pins only published packages that the assets dir depends on" {
  make_assets_dir plugin.a '{"dependencies":{"@cplace-next/cf-platform":"0.0.0-SNAPSHOT-x","lodash":"4.17.21"}}'

  run env PACKAGES='["@cplace-next/cf-platform","@cplace-next/cf-shell"]' \
    "$SCRIPTS/pin-snapshots.sh" 0.0.0-feat-1-42 "$WORK/plugin.a/assets"

  [ "$status" -eq 0 ]
  assert_npm_called_in "$WORK/plugin.a/assets" \
    "i @cplace-next/cf-platform@0.0.0-feat-1-42 --save-exact --legacy-peer-deps"
}

@test "a dir that consumes no published package is left alone, silently" {
  make_assets_dir plugin.a '{"dependencies":{"lodash":"4.17.21"}}'

  run env PACKAGES='["@cplace-next/cf-platform"]' \
    "$SCRIPTS/pin-snapshots.sh" 0.0.0-feat-1-42 "$WORK/plugin.a/assets"

  [ "$status" -eq 0 ]
  [ "$(npm_call_count)" -eq 0 ]
  [ -z "$output" ]
}

@test "a published package in devDependencies is pinned too" {
  make_assets_dir plugin.a '{"devDependencies":{"@cplace-next/cf-e2e-testing-sdk":"26.4.1"}}'

  run env PACKAGES='["@cplace-next/cf-e2e-testing-sdk"]' \
    "$SCRIPTS/pin-snapshots.sh" 0.0.0-feat-1-42 "$WORK/plugin.a/assets"

  [ "$status" -eq 0 ]
  assert_npm_called_in "$WORK/plugin.a/assets" \
    "i @cplace-next/cf-e2e-testing-sdk@0.0.0-feat-1-42 --save-exact --legacy-peer-deps"
}

@test "a dir without package.json is skipped" {
  mkdir -p "$WORK/plugin.empty/assets"

  run env PACKAGES='["@cplace-next/cf-platform"]' \
    "$SCRIPTS/pin-snapshots.sh" 0.0.0-feat-1-42 "$WORK/plugin.empty/assets"

  [ "$status" -eq 0 ]
  [ "$(npm_call_count)" -eq 0 ]
}

@test "an npm failure fails the script and names the dir" {
  make_assets_dir plugin.a '{"dependencies":{"@cplace-next/cf-platform":"1.0.0"}}'

  run env NPM_EXIT=1 PACKAGES='["@cplace-next/cf-platform"]' \
    "$SCRIPTS/pin-snapshots.sh" 0.0.0-feat-1-42 "$WORK/plugin.a/assets"

  [ "$status" -ne 0 ]
  [[ "$output" == *"pinning failed in $WORK/plugin.a/assets"* ]]
}

@test "several dirs get one npm call each" {
  make_assets_dir plugin.a '{"dependencies":{"@cplace-next/cf-platform":"1.0.0"}}'
  make_assets_dir plugin.b '{"dependencies":{"@cplace-next/cf-shell":"1.0.0"}}'

  run env PACKAGES='["@cplace-next/cf-platform","@cplace-next/cf-shell"]' \
    "$SCRIPTS/pin-snapshots.sh" 0.0.0-feat-1-42 "$WORK/plugin.a/assets" "$WORK/plugin.b/assets"

  [ "$status" -eq 0 ]
  [ "$(npm_call_count)" -eq 2 ]
  assert_npm_called_in "$WORK/plugin.a/assets" \
    "i @cplace-next/cf-platform@0.0.0-feat-1-42 --save-exact --legacy-peer-deps"
  assert_npm_called_in "$WORK/plugin.b/assets" \
    "i @cplace-next/cf-shell@0.0.0-feat-1-42 --save-exact --legacy-peer-deps"
}

@test "prints one '<dir> <pkg>@<version>' line per pin, and nothing else on stdout" {
  make_assets_dir plugin.a '{"dependencies":{"@cplace-next/cf-platform":"1.0.0","@cplace-next/cf-shell":"1.0.0"}}'

  run --separate-stderr env PACKAGES='["@cplace-next/cf-platform","@cplace-next/cf-shell"]' \
    "$SCRIPTS/pin-snapshots.sh" 0.0.0-feat-1-42 "$WORK/plugin.a/assets"

  [ "$status" -eq 0 ]
  [ "$(npm_call_count)" -eq 1 ]
  assert_npm_called_in "$WORK/plugin.a/assets" \
    "i @cplace-next/cf-platform@0.0.0-feat-1-42 @cplace-next/cf-shell@0.0.0-feat-1-42 --save-exact --legacy-peer-deps"
  [ "${#lines[@]}" -eq 2 ]
  [ "${lines[0]}" = "$WORK/plugin.a/assets @cplace-next/cf-platform@0.0.0-feat-1-42" ]
  [ "${lines[1]}" = "$WORK/plugin.a/assets @cplace-next/cf-shell@0.0.0-feat-1-42" ]
}

@test "an empty PACKAGES pins nothing" {
  make_assets_dir plugin.a '{"dependencies":{"@cplace-next/cf-platform":"1.0.0"}}'

  run env PACKAGES='' "$SCRIPTS/pin-snapshots.sh" 0.0.0-feat-1-42 "$WORK/plugin.a/assets"

  [ "$status" -eq 0 ]
  [ "$(npm_call_count)" -eq 0 ]
}

@test "a glob matching two dirs pins in both" {
  make_assets_dir plugin.a '{"dependencies":{"@cplace-next/cf-platform":"1.0.0"}}'
  make_assets_dir plugin.b '{"dependencies":{"@cplace-next/cf-platform":"1.0.0"}}'

  run env PACKAGES='["@cplace-next/cf-platform"]' \
    "$SCRIPTS/pin-snapshots.sh" 0.0.0-feat-1-42 "$WORK/*/assets"

  [ "$status" -eq 0 ]
  [ "$(npm_call_count)" -eq 2 ]
  assert_npm_called_in "$WORK/plugin.a/assets" \
    "i @cplace-next/cf-platform@0.0.0-feat-1-42 --save-exact --legacy-peer-deps"
  assert_npm_called_in "$WORK/plugin.b/assets" \
    "i @cplace-next/cf-platform@0.0.0-feat-1-42 --save-exact --legacy-peer-deps"
}

@test "a glob matching nothing fails, names the glob and calls no npm" {
  mkdir -p "$WORK"

  run env PACKAGES='["@cplace-next/cf-platform"]' \
    "$SCRIPTS/pin-snapshots.sh" 0.0.0-feat-1-42 "$WORK/*/assets"

  [ "$status" -eq 1 ]
  [[ "$output" == *"No directory matches: $WORK/*/assets"* ]]
  [ "$(npm_call_count)" -eq 0 ]
}

@test "a blank glob next to a matching one is ignored" {
  make_assets_dir plugin.a '{"dependencies":{"@cplace-next/cf-platform":"1.0.0"}}'

  run env PACKAGES='["@cplace-next/cf-platform"]' \
    "$SCRIPTS/pin-snapshots.sh" 0.0.0-feat-1-42 '' "$WORK/*/assets" ' '

  [ "$status" -eq 0 ]
  [ "$(npm_call_count)" -eq 1 ]
  assert_npm_called_in "$WORK/plugin.a/assets" \
    "i @cplace-next/cf-platform@0.0.0-feat-1-42 --save-exact --legacy-peer-deps"
}

@test "a missing version is a usage error" {
  run "$SCRIPTS/pin-snapshots.sh" '' "$WORK"

  [ "$status" -eq 2 ]
  [[ "$output" == *'Usage:'* ]]
}
