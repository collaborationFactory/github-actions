#!/usr/bin/env bats
#
# Behavioral tests for resolve-specs.sh.
#
# Run with: bats tools/scripts/backend-e2e/

setup() {
  load 'test-helper'
  export GITHUB_OUTPUT="${BATS_TEST_TMPDIR}/github_output"
  : >"${GITHUB_OUTPUT}"
  DEFAULTS='cypress/e2e/cplace/specs/a/**/*.spec.ts,cypress/e2e/cplace/specs/b/**/*.spec.ts'
}

specs_output() {
  sed -n 's/^specs=//p' "${GITHUB_OUTPUT}"
}

# specs <spec-map> <consumed> [<in-repo-specs>]
specs() {
  run env E2E_SPECS="${DEFAULTS}" SPEC_MAP="$1" CONSUMED="$2" IN_REPO_SPECS="${3:-false}" FE_REPO=cplace-fe \
    "$SCRIPTS/resolve-specs.sh"
}

@test "without a map the filter is the default" {
  specs '' '["@cplace-next/cf-platform"]'

  [ "$status" -eq 0 ]
  [ "$(specs_output)" = "${DEFAULTS}" ]
}

@test "a consumed package adds its mapped globs after the default" {
  specs '{"@cplace-next/cf-platform":"cypress/e2e/cplace/specs/footer/**/*.spec.ts, cypress/e2e/cplace/specs/menu/**/*.spec.ts"}' \
    '["@cplace-next/cf-platform"]'

  [ "$status" -eq 0 ]
  [ "$(specs_output)" = "${DEFAULTS},cypress/e2e/cplace/specs/footer/**/*.spec.ts,cypress/e2e/cplace/specs/menu/**/*.spec.ts" ]
}

@test "an unconsumed package is ignored" {
  specs '{"@cplace-next/cf-shell":"cypress/e2e/cplace/specs/shell/**/*.spec.ts"}' '["@cplace-next/cf-platform"]'

  [ "$status" -eq 0 ]
  [ "$(specs_output)" = "${DEFAULTS}" ]
}

@test "duplicate globs collapse in order" {
  specs '{"@cplace-next/cf-platform":"cypress/e2e/cplace/specs/b/**/*.spec.ts,cypress/e2e/x.spec.ts","@cplace-next/cf-shell":"cypress/e2e/x.spec.ts"}' \
    '["@cplace-next/cf-platform","@cplace-next/cf-shell"]'

  [ "$status" -eq 0 ]
  [ "$(specs_output)" = "${DEFAULTS},cypress/e2e/x.spec.ts" ]
}

@test "an invalid map fails" {
  local map
  for map in 'not json' '["a"]' '{"@cplace-next/cf-platform":["a"]}'; do
    : >"${GITHUB_OUTPUT}"
    specs "${map}" '[]'

    [ "$status" -eq 1 ]
    [[ "$output" == *'::error::SPEC_MAP is not a JSON object'* ]]
    [ ! -s "${GITHUB_OUTPUT}" ]
  done
}

@test "an invalid consumed list fails" {
  specs '{}' 'nope'

  [ "$status" -eq 1 ]
  [ ! -s "${GITHUB_OUTPUT}" ]
}

@test "in-repo specs append the FE repo's glob once, last" {
  specs '{"@cplace-next/cf-platform":"cypress/e2e/cplace-fe/**/*.spec.ts"}' '["@cplace-next/cf-platform"]' true

  [ "$status" -eq 0 ]
  [ "$(specs_output)" = "${DEFAULTS},cypress/e2e/cplace-fe/**/*.spec.ts" ]

  : >"${GITHUB_OUTPUT}"
  specs '' '[]' true

  [ "$(specs_output)" = "${DEFAULTS},cypress/e2e/cplace-fe/**/*.spec.ts" ]
}

@test "no in-repo specs leave the filter unchanged" {
  specs '' '[]' false

  [ "$status" -eq 0 ]
  [ "$(specs_output)" = "${DEFAULTS}" ]
}

@test "in-repo specs without FE_REPO fail" {
  run env E2E_SPECS="${DEFAULTS}" IN_REPO_SPECS=true "$SCRIPTS/resolve-specs.sh"

  [ "$status" -eq 1 ]
  [[ "$output" == *'FE_REPO is not set'* ]]
}
