#!/usr/bin/env bash
#
# Builds the backend E2E PR comment from the results JSON of
# EnricoMi/publish-unit-test-result-action, and classifies the run with
# classify-outcome.sh.
#
# Usage: build-report.sh <results-json> <body-out>
#
# Env:
#   ADVISORY        true when failures are reported as warnings only
#   BUILD_RESULT, E2E_RESULT, NODES, NODES_REPORTED
#                   passed on to classify-outcome.sh
#   BACKEND_REPO, BACKEND_BRANCH, BACKEND_SHA, E2E_BRANCH, E2E_SHA,
#   SNAPSHOT_VERSION, BACKEND_PACKAGES, E2E_PACKAGES
#                   shown in the comment's table
#   RUN_URL         the workflow run, linked from the comment
#   GITHUB_OUTPUT   receives tests, failed, outcome and message
#
# Test names and spec paths come from the PR's own specs, so every value is
# written inside a code span, without backticks or line breaks and cut to 200
# characters: a title cannot add links, Markdown or @mentions to the comment.

set -euo pipefail

readonly MARKER='<!-- fe-backend-e2e -->'
readonly MAX_FAILURES=20

main() {
  if (($# != 2)); then
    echo "Usage: $(basename "$0") <results-json> <body-out>" >&2
    exit 2
  fi
  if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
    echo "GITHUB_OUTPUT is not set" >&2
    exit 1
  fi
  local results="$1" body="$2"
  if ! jq -e 'type == "object"' "${results}" >/dev/null 2>&1; then
    echo "::error::No readable test results JSON at ${results}" >&2
    exit 1
  fi

  local tests failed
  read -r tests failed < <(jq -r '.stats // {} | "\(.tests // 0) \((.tests_fail // 0) + (.tests_error // 0))"' "${results}")

  local classified outcome message
  classified="$(mktemp)"
  GITHUB_OUTPUT="${classified}" TESTS="${tests}" FAILED="${failed}" \
    "$(dirname "${BASH_SOURCE[0]}")/classify-outcome.sh"
  outcome="$(sed -n 's/^outcome=//p' "${classified}")"
  message="$(sed -n 's/^message=//p' "${classified}")"

  jq -r \
    --arg marker "${MARKER}" \
    --argjson max "${MAX_FAILURES}" \
    --arg outcome "${outcome}" \
    --arg message "${message}" \
    --arg advisory "${ADVISORY:-false}" \
    --arg backend_repo "${BACKEND_REPO:-}" \
    --arg backend_branch "${BACKEND_BRANCH:-}" \
    --arg backend_sha "${BACKEND_SHA:-}" \
    --arg e2e_branch "${E2E_BRANCH:-}" \
    --arg e2e_sha "${E2E_SHA:-}" \
    --arg snapshot_version "${SNAPSHOT_VERSION:-}" \
    --arg backend_packages "${BACKEND_PACKAGES:-}" \
    --arg e2e_packages "${E2E_PACKAGES:-}" \
    --arg run_url "${RUN_URL:-}" '
    def code: tostring | gsub("[`\r\n]"; "") | (if length > 200 then .[0:200] + "…" else . end) | "`\(.)`";
    def spec_of: .test_file // ((.result_file // "") | split("/") | last | sub("^cplace-e2e-results-"; "") | sub("\\.xml$"; ""));
    (.stats // {}) as $stats
    | [ (.cases // [])[] as $case
        | (($case.states.failure // []) + ($case.states.error // []))[0:1][]
        | {spec: spec_of, name: ($case.test_name // .test_name // "")} ] as $failures
    | [ $marker,
        "### \(if $outcome == "passed" then "✅" else "❌" end) Backend E2E\(if $advisory == "true" then " (advisory)" else "" end)",
        "",
        "\($stats.tests_succ // 0) passed, \(($stats.tests_fail // 0) + ($stats.tests_error // 0)) failed, \($stats.tests_skip // 0) skipped",
        "",
        "**\($outcome)**: \($message)",
        "",
        "| | |",
        "|---|---|",
        "| Backend | \($backend_repo | code) @ \($backend_branch | code) \($backend_sha | code) |",
        "| cplace-e2e | \($e2e_branch | code) \($e2e_sha | code) |",
        "| Snapshot version | \(if $snapshot_version == "" then "none" else $snapshot_version end | code) |",
        "| Pinned in the backend | \($backend_packages | code) |",
        "| Pinned in cplace-e2e | \($e2e_packages | code) |" ]
      + (if ($failures | length) > 0 then
          [ "",
            "**Failing tests**\(if ($failures | length) > $max then " (first \($max) of \($failures | length))" else "" end):",
            "" ]
          + [ $failures[0:$max][] | "- \(.spec | code): \(.name | code)" ]
          + (if ($failures | length) > $max then [ "- and \(($failures | length) - $max) more" ] else [] end)
        else [] end)
      + [ "",
          "[Workflow run](\($run_url))\(if .check_url then " · [Test Results Backend E2E](\(.check_url))" else "" end)" ]
    | join("\n")' "${results}" >"${body}"

  {
    echo "tests=${tests}"
    echo "failed=${failed}"
    cat "${classified}"
  } >>"${GITHUB_OUTPUT}"
  rm -f "${classified}"
}

main "$@"
