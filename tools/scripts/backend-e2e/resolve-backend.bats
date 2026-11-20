#!/usr/bin/env bats
#
# Behavioral tests for resolve-backend.sh.
#
# Run with: bats tools/scripts/backend-e2e/

setup() {
  load 'test-helper'
  export GITHUB_OUTPUT="${BATS_TEST_TMPDIR}/github_output"
  : >"${GITHUB_OUTPUT}"
  stub_git
  export RETRY_DELAYS='0 0 0' GH_TOKEN=ghs_secret_token
}

# output_of <key>: the value resolve-backend.sh wrote for <key>
output_of() {
  sed -n "s/^$1=//p" "${GITHUB_OUTPUT}"
}

# branches <base> [<head>]: runs the branches step for the cplace backend
branches() {
  run env BACKEND_REPO=cplace BASE_REF="$1" HEAD_REF="${2:-}" "$SCRIPTS/resolve-backend.sh" branches
}

@test "cplace-fe maps to cplace, checked out as main" {
  run env FE_REPO=cplace-fe "$SCRIPTS/resolve-backend.sh" repo

  [ "$status" -eq 0 ]
  [ "$(output_of backend_repo)" = cplace ]
  [ "$(output_of repo_dir)" = main ]
}

@test "cplace-paw-fe maps to cplace-paw, checked out under its own name" {
  run env FE_REPO=cplace-paw-fe "$SCRIPTS/resolve-backend.sh" repo

  [ "$status" -eq 0 ]
  [ "$(output_of backend_repo)" = cplace-paw ]
  [ "$(output_of repo_dir)" = cplace-paw ]
}

@test "an unknown repo fails and names it" {
  run env FE_REPO=some-tool "$SCRIPTS/resolve-backend.sh" repo

  [ "$status" -eq 1 ]
  [[ "$output" == *"No backend repo for 'some-tool'"* ]]
  [ ! -s "${GITHUB_OUTPUT}" ]
}

@test "a bare -fe is not a repo name" {
  run env FE_REPO=-fe "$SCRIPTS/resolve-backend.sh" repo

  [ "$status" -eq 1 ]
}

@test "base main maps to master" {
  branches main

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = master ]
  [ "$(output_of e2e_branch)" = master ]
}

@test "base master maps to master" {
  branches master

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = master ]
}

@test "a beta release maps to its release line" {
  remote_has cplace release/26.4
  remote_has cplace-e2e release/26.4

  branches release/26.4-beta

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = release/26.4 ]
  [ "$(output_of e2e_branch)" = release/26.4 ]
}

@test "a beta release without its release line falls back to master with a warning" {
  remote_has cplace release/26.4
  remote_has cplace-e2e master

  branches release/26.4-beta

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = release/26.4 ]
  [ "$(output_of e2e_branch)" = master ]
  [[ "$output" == *"::warning::cplace-e2e has no branch 'release/26.4'"* ]]
}

@test "a release branch maps to itself" {
  remote_has cplace release/26.1
  remote_has cplace-e2e release/26.1

  branches release/26.1

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = release/26.1 ]
}

@test "any other base maps to master with a warning" {
  branches feature/epic

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = master ]
  [[ "$output" == *"::warning::Base branch 'feature/epic'"* ]]
}

@test "a same-named branch is used in each repo that has it" {
  remote_has cplace master
  remote_has cplace-e2e master feature/x

  branches main feature/x

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = master ]
  [ "$(output_of e2e_branch)" = feature/x ]
}

@test "a same-named branch present in both repos is used for both" {
  remote_has cplace feature/x
  remote_has cplace-e2e feature/x

  branches release/26.1 feature/x

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = feature/x ]
  [ "$(output_of e2e_branch)" = feature/x ]
}

@test "a branch that only starts with the head ref is not a match" {
  remote_has cplace feature/x-2
  remote_has cplace-e2e other/feature/x

  branches main feature/x

  [ "$status" -eq 0 ]
  [ "$(output_of backend_branch)" = master ]
  [ "$(output_of e2e_branch)" = master ]
}

@test "an unreachable remote fails after the retries and writes nothing" {
  remote_unreachable cplace

  branches main feature/x

  [ "$status" -eq 2 ]
  [[ "$output" == *"::error::Cannot reach collaborationFactory/cplace"* ]]
  [ "$(git_call_count)" -eq 4 ]
  [ ! -s "${GITHUB_OUTPUT}" ]
}

@test "the token never appears in git's argv" {
  remote_has cplace feature/x

  branches main feature/x

  [ "$status" -eq 0 ]
  ! grep -q ghs_secret_token "${GIT_LOG}"
}

@test "branches without BACKEND_REPO fails" {
  run env BASE_REF=main "$SCRIPTS/resolve-backend.sh" branches

  [ "$status" -eq 1 ]
  [[ "$output" == *'BACKEND_REPO is not set'* ]]
}

@test "an unknown step fails with the usage" {
  run "$SCRIPTS/resolve-backend.sh" both

  [ "$status" -eq 2 ]
  [[ "$output" == *'Usage:'* ]]
}

@test "a missing GITHUB_OUTPUT fails" {
  run env -u GITHUB_OUTPUT FE_REPO=cplace-fe "$SCRIPTS/resolve-backend.sh" repo

  [ "$status" -eq 1 ]
  [[ "$output" == *'GITHUB_OUTPUT is not set'* ]]
}
