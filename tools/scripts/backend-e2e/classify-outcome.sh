#!/usr/bin/env bash
#
# Says what kind of result a backend E2E run had, so a reader knows whether to
# look at the backend build, the test infrastructure or the tests.
#
# Usage: classify-outcome.sh
#
# Env:
#   BUILD_RESULT    the build job's result (success, failure, cancelled, skipped)
#   E2E_RESULT      the e2e matrix's result
#   TESTS           the number of test results
#   FAILED          the number of failed and errored tests
#   NODES           the number of e2e nodes
#   NODES_REPORTED  the number of nodes that uploaded results
#   BACKEND_REPO, BACKEND_BRANCH, BACKEND_SHA
#                   the backend that was built, named on a build failure
#   GITHUB_OUTPUT   receives outcome and message
#   GITHUB_STEP_SUMMARY  receives a heading with the message
#
# outcome is one of cancelled, build-failure, test-failure,
# infrastructure-failure and passed, checked in that order. Missing nodes are
# named in the message of a test failure too.

set -euo pipefail

# non_negative <name>: fails unless the env var <name> is a non-negative integer
non_negative() {
  if [[ ! "${!1:-}" =~ ^[0-9]+$ ]]; then
    echo "$1 is not a non-negative integer: '${!1:-}'" >&2
    exit 1
  fi
}

main() {
  local var
  for var in GITHUB_OUTPUT GITHUB_STEP_SUMMARY; do
    if [[ -z "${!var:-}" ]]; then
      echo "${var} is not set" >&2
      exit 1
    fi
  done
  for var in TESTS FAILED NODES NODES_REPORTED; do
    non_negative "${var}"
  done

  local missing=$((NODES - NODES_REPORTED)) missing_text=''
  if ((missing > 0)); then
    missing_text="${missing} of ${NODES} E2E nodes produced no results (crashed or timed out); see their logs."
  fi

  local outcome message
  if [[ "${BUILD_RESULT:-}" == cancelled || "${E2E_RESULT:-}" == cancelled ]]; then
    outcome=cancelled
    message='The run was cancelled, usually by a newer push.'
  elif [[ "${BUILD_RESULT:-}" != success ]]; then
    outcome=build-failure
    message="The backend build failed (\`${BACKEND_REPO:-}\` @ \`${BACKEND_BRANCH:-}\` \`${BACKEND_SHA:-}\`), so no test ran. Check the build job's log."
  elif ((FAILED > 0)); then
    outcome=test-failure
    message="${FAILED} of ${TESTS} backend E2E tests failed; see 'Test Results Backend E2E'.${missing_text:+ ${missing_text}}"
  elif ((missing > 0)); then
    outcome=infrastructure-failure
    message="${missing_text}"
  elif ((TESTS == 0)); then
    outcome=infrastructure-failure
    message="No backend E2E test results were produced (E2E nodes: \`${E2E_RESULT:-}\`): docker, cplace startup or the Cypress harness broke before any test ran. Check the E2E node logs."
  else
    outcome=passed
    message="All ${TESTS} backend E2E tests passed."
  fi

  {
    echo "outcome=${outcome}"
    echo "message=${message}"
  } >>"${GITHUB_OUTPUT}"
  {
    echo "### Backend E2E: ${outcome}"
    echo
    echo "${message}"
  } >>"${GITHUB_STEP_SUMMARY}"
}

main "$@"
