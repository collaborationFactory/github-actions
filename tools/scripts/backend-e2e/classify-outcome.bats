#!/usr/bin/env bats
#
# Behavioral tests for classify-outcome.sh.
#
# Run with: bats tools/scripts/backend-e2e/

setup() {
  load 'test-helper'
  export GITHUB_OUTPUT="${BATS_TEST_TMPDIR}/github_output" GITHUB_STEP_SUMMARY="${BATS_TEST_TMPDIR}/summary"
  : >"${GITHUB_OUTPUT}"
  : >"${GITHUB_STEP_SUMMARY}"
}

output_of() {
  sed -n "s/^$1=//p" "${GITHUB_OUTPUT}"
}

# classify <build> <e2e> <tests> <failed> [<nodes> <reported>]
classify() {
  run env BUILD_RESULT="$1" E2E_RESULT="$2" TESTS="$3" FAILED="$4" NODES="${5:-2}" NODES_REPORTED="${6:-2}" \
    BACKEND_REPO=cplace BACKEND_BRANCH=master BACKEND_SHA=abc123 "$SCRIPTS/classify-outcome.sh"
}

@test "every node passing is passed" {
  classify success success 12 0

  [ "$status" -eq 0 ]
  [ "$(output_of outcome)" = passed ]
  grep -qxF '### Backend E2E: passed' "${GITHUB_STEP_SUMMARY}"
}

@test "failed tests are a test failure" {
  classify success failure 12 3

  [ "$(output_of outcome)" = test-failure ]
  [[ "$(output_of message)" == "3 of 12 backend E2E tests failed"* ]]
}

@test "a failed build is a build failure naming the backend commit" {
  classify failure skipped 0 0

  [ "$(output_of outcome)" = build-failure ]
  [[ "$(output_of message)" == *'`cplace` @ `master` `abc123`'* ]]
  [[ "$(output_of message)" == *'no test ran'* ]]
}

@test "a build failure wins over a skipped e2e with no results" {
  classify failure skipped 0 0 2 0

  [ "$(output_of outcome)" = build-failure ]
}

@test "failed nodes without results are an infrastructure failure" {
  classify success failure 0 0

  [ "$(output_of outcome)" = infrastructure-failure ]
  [[ "$(output_of message)" == *'(E2E nodes: `failure`)'* ]]
}

@test "a cancelled run is cancelled" {
  classify success cancelled 4 1

  [ "$(output_of outcome)" = cancelled ]
}

@test "two of two nodes reported and passing is passed" {
  classify success success 12 0 2 2

  [ "$(output_of outcome)" = passed ]
}

@test "one of two nodes reported and passing is an infrastructure failure" {
  classify success success 6 0 2 1

  [ "$(output_of outcome)" = infrastructure-failure ]
  [[ "$(output_of message)" == '1 of 2 E2E nodes produced no results'* ]]
}

@test "one of two nodes reported with failures is a test failure that names the missing node" {
  classify success success 6 2 2 1

  [ "$(output_of outcome)" = test-failure ]
  [[ "$(output_of message)" == '2 of 6 backend E2E tests failed'*'1 of 2 E2E nodes produced no results'* ]]
}

@test "a count that is not a number fails" {
  classify success success '' 0

  [ "$status" -eq 1 ]
  [[ "$output" == *'TESTS is not a non-negative integer'* ]]
  [ ! -s "${GITHUB_OUTPUT}" ]
}
