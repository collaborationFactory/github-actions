#!/usr/bin/env bats
#
# Behavioral tests for resolve-backend.sh.
#
# Run with: bats tools/scripts/backend-e2e/

setup() {
  load 'test-helper'
  export GITHUB_OUTPUT="${BATS_TEST_TMPDIR}/github_output"
  : >"${GITHUB_OUTPUT}"
}

# output_of <key>: the value resolve-backend.sh wrote for <key>
output_of() {
  sed -n "s/^$1=//p" "${GITHUB_OUTPUT}"
}

@test "cplace-fe maps to cplace, checked out as main" {
  run env FE_REPO=cplace-fe BASE_REF=main "$SCRIPTS/resolve-backend.sh"

  [ "$status" -eq 0 ]
  [ "$(output_of backend_repo)" = cplace ]
  [ "$(output_of repo_dir)" = main ]
}

@test "cplace-paw-fe maps to cplace-paw, checked out under its own name" {
  run env FE_REPO=cplace-paw-fe BASE_REF=main "$SCRIPTS/resolve-backend.sh"

  [ "$status" -eq 0 ]
  [ "$(output_of backend_repo)" = cplace-paw ]
  [ "$(output_of repo_dir)" = cplace-paw ]
}

@test "an unknown repo fails and names it" {
  run env FE_REPO=some-tool BASE_REF=main "$SCRIPTS/resolve-backend.sh"

  [ "$status" -eq 1 ]
  [[ "$output" == *"No backend repo for 'some-tool'"* ]]
  [ ! -s "${GITHUB_OUTPUT}" ]
}

@test "a bare -fe is not a repo name" {
  run env FE_REPO=-fe BASE_REF=main "$SCRIPTS/resolve-backend.sh"

  [ "$status" -eq 1 ]
}

@test "base main maps to master" {
  run env FE_REPO=cplace-fe BASE_REF=main "$SCRIPTS/resolve-backend.sh"

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = master ]
  [ "$(output_of e2e_branch)" = master ]
}

@test "base master maps to master" {
  run env FE_REPO=cplace-fe BASE_REF=master "$SCRIPTS/resolve-backend.sh"

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = master ]
}

@test "a beta release maps to its release line" {
  run env FE_REPO=cplace-fe BASE_REF=release/26.4-beta "$SCRIPTS/resolve-backend.sh"

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = release/26.4 ]
  [ "$(output_of e2e_branch)" = release/26.4 ]
}

@test "a release branch maps to itself" {
  run env FE_REPO=cplace-fe BASE_REF=release/26.1 "$SCRIPTS/resolve-backend.sh"

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = release/26.1 ]
}

@test "any other base maps to master with a warning" {
  run env FE_REPO=cplace-fe BASE_REF=feature/epic "$SCRIPTS/resolve-backend.sh"

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = master ]
  [[ "$output" == *"::warning::Base branch 'feature/epic'"* ]]
}

@test "a missing GITHUB_OUTPUT fails" {
  run env -u GITHUB_OUTPUT FE_REPO=cplace-fe BASE_REF=main "$SCRIPTS/resolve-backend.sh"

  [ "$status" -eq 1 ]
  [[ "$output" == *'GITHUB_OUTPUT is not set'* ]]
}
