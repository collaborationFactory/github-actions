#!/usr/bin/env bats
#
# Behavioral tests for build-report.sh, with EnricoMi results JSON fixtures
# under fixtures/.
#
# Run with: bats tools/scripts/backend-e2e/

setup() {
  load 'test-helper'
  export GITHUB_OUTPUT="${BATS_TEST_TMPDIR}/github_output" GITHUB_STEP_SUMMARY="${BATS_TEST_TMPDIR}/summary"
  : >"${GITHUB_OUTPUT}"
  BODY="${BATS_TEST_TMPDIR}/body.md"
  export BUILD_RESULT=success E2E_RESULT=success NODES=2 NODES_REPORTED=2 ADVISORY=false \
    BACKEND_REPO=cplace BACKEND_BRANCH=master BACKEND_SHA=abc123 E2E_BRANCH=master E2E_SHA=def456 \
    SNAPSHOT_VERSION=0.0.0-feat-1-42 BACKEND_PACKAGES='["@cplace-next/cf-platform"]' E2E_PACKAGES='[]' \
    RUN_URL=https://github.com/collaborationFactory/cplace-fe/actions/runs/7
}

output_of() {
  sed -n "s/^$1=//p" "${GITHUB_OUTPUT}"
}

report() {
  run "$SCRIPTS/build-report.sh" "${SCRIPTS}/fixtures/$1" "${BODY}"
}

@test "all passed: marker, verdict, counts, table and links, no failure list" {
  report results-passed.json

  [ "$status" -eq 0 ]
  [ "$(output_of tests)" = 12 ]
  [ "$(output_of failed)" = 0 ]
  [ "$(output_of outcome)" = passed ]
  [ "$(sed -n 1p "${BODY}")" = '<!-- fe-backend-e2e -->' ]
  grep -qxF '### ✅ Backend E2E' "${BODY}"
  grep -qxF '12 passed, 0 failed, 0 skipped' "${BODY}"
  grep -qxF '| Backend | `cplace` @ `master` `abc123` |' "${BODY}"
  grep -qxF '| Pinned in the backend | `["@cplace-next/cf-platform"]` |' "${BODY}"
  grep -qxF '[Workflow run](https://github.com/collaborationFactory/cplace-fe/actions/runs/7) · [Test Results Backend E2E](https://github.com/collaborationFactory/cplace-fe/runs/1)' "${BODY}"
  ! grep -q 'Failing tests' "${BODY}"
}

@test "failures from failure and error are listed once each, with the spec fallback" {
  report results-failed.json

  [ "$status" -eq 0 ]
  [ "$(output_of tests)" = 12 ]
  [ "$(output_of failed)" = 3 ]
  [ "$(output_of outcome)" = test-failure ]
  grep -qxF '### ❌ Backend E2E' "${BODY}"
  grep -qxF -- '- `cypress/e2e/cplace-fe/platform/startPage.spec.ts`: `TC01: renders the platform footer after login`' "${BODY}"
  grep -qxF -- '- `menu.spec.ts`: `TC02: opens the menu`' "${BODY}"
  grep -qxF -- '- `cypress/e2e/cplace/specs/footer.spec.ts`: `TC03: from the result`' "${BODY}"
  [ "$(grep -c '^- `' "${BODY}")" -eq 3 ]
}

@test "advisory mode marks the heading" {
  ADVISORY=true report results-failed.json

  [ "$status" -eq 0 ]
  grep -qxF '### ❌ Backend E2E (advisory)' "${BODY}"
}

@test "more than 20 failures are capped with an and-more line" {
  report results-many-failures.json

  [ "$status" -eq 0 ]
  grep -qxF '**Failing tests** (first 20 of 25):' "${BODY}"
  [ "$(grep -c '^- `cypress' "${BODY}")" -eq 20 ]
  grep -qxF -- '- and 5 more' "${BODY}"
}

@test "a Markdown title comes out as one plain code span, truncated" {
  report results-markdown-title.json

  [ "$status" -eq 0 ]
  local line
  line="$(grep '^- `cypress' "${BODY}")"
  [ "$(grep -c 'someone' "${BODY}")" -eq 1 ]
  [[ "${line}" == '- `cypress/e2e/evil.spec.ts`: `Evil titlewith @someone and [x](y) aaa'* ]]
  [[ "${line}" == *'…`' ]]
  [ "$(tr -cd '`' <<<"${line}" | wc -c)" -eq 4 ]
}

@test "a missing node shows up in the outcome even when the others passed" {
  NODES_REPORTED=1 report results-passed.json

  [ "$status" -eq 0 ]
  [ "$(output_of outcome)" = infrastructure-failure ]
  grep -qF '**infrastructure-failure**: 1 of 2 E2E nodes produced no results' "${BODY}"
}

@test "a missing results JSON fails instead of reporting zeros" {
  run "$SCRIPTS/build-report.sh" "${BATS_TEST_TMPDIR}/nope.json" "${BODY}"

  [ "$status" -eq 1 ]
  [[ "$output" == *'::error::No readable test results JSON'* ]]
  [ ! -s "${GITHUB_OUTPUT}" ]
}

@test "wrong arguments fail with the usage" {
  run "$SCRIPTS/build-report.sh" x

  [ "$status" -eq 2 ]
  [[ "$output" == *'Usage:'* ]]
}
