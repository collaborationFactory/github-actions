#!/usr/bin/env bats
#
# Behavioral tests for checkout-commit.sh.
#
# Run with: bats tools/scripts/backend-e2e/

setup() {
  load 'test-helper'
  stub_git
  SHA=3333333333333333333333333333333333333333
}

@test "fetches and checks out the commit" {
  run env STUB_HEAD="${SHA}" "$SCRIPTS/checkout-commit.sh" e2e "${SHA}"

  [ "$status" -eq 0 ]
  grep -qxF -- "-C e2e fetch --quiet --depth 1 origin ${SHA}" "${GIT_LOG}"
  grep -qxF -- "-C e2e checkout --quiet --detach ${SHA}" "${GIT_LOG}"
  [[ "$output" == *"e2e is at ${SHA}"* ]]
}

@test "a HEAD other than the commit fails" {
  run env STUB_HEAD=4444444444444444444444444444444444444444 "$SCRIPTS/checkout-commit.sh" e2e "${SHA}"

  [ "$status" -eq 1 ]
  [[ "$output" == *"::error::e2e is at 4444444444444444444444444444444444444444 after checking out ${SHA}"* ]]
}

@test "a value that is not a full SHA fails before any git call" {
  local value
  for value in '' main 3333333 "--upload-pack=x${SHA}"; do
    run "$SCRIPTS/checkout-commit.sh" e2e "${value}"

    [ "$status" -eq 1 ]
  done
  [ "$(git_call_count)" -eq 0 ]
}

@test "a failing fetch fails the script before the checkout" {
  run env STUB_FAIL=fetch STUB_HEAD="${SHA}" "$SCRIPTS/checkout-commit.sh" e2e "${SHA}"

  [ "$status" -ne 0 ]
  ! grep -q checkout "${GIT_LOG}"
}

@test "wrong arguments fail with the usage" {
  run "$SCRIPTS/checkout-commit.sh" e2e

  [ "$status" -eq 2 ]
  [[ "$output" == *'Usage:'* ]]
}
