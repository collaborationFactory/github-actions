#!/usr/bin/env bats
#
# Behavioral tests for pr-directives.sh.
#
# Run with: bats tools/scripts/backend-e2e/

setup() {
  load 'test-helper'
}

directives() {
  run env PR_BODY="$1" "$SCRIPTS/pr-directives.sh"
}

@test "a body without directives prints empty overrides" {
  directives $'Fixes the footer.\n\nNo special setup.'

  [ "$status" -eq 0 ]
  [ "${lines[0]}" = 'BACKEND_BRANCH_OVERRIDE=' ]
  [ "${lines[1]}" = 'E2E_BRANCH_OVERRIDE=' ]
}

@test "an unset body prints empty overrides" {
  run env -u PR_BODY "$SCRIPTS/pr-directives.sh"

  [ "$status" -eq 0 ]
  [ "${lines[0]}" = 'BACKEND_BRANCH_OVERRIDE=' ]
}

@test "both directives are read" {
  directives $'Pairs with a backend change.\n\nbackend-branch: feature/PFM-1-x\ncplace-e2e-branch:feature/PFM-1-specs\n'

  [ "$status" -eq 0 ]
  [ "${lines[0]}" = 'BACKEND_BRANCH_OVERRIDE=feature/PFM-1-x' ]
  [ "${lines[1]}" = 'E2E_BRANCH_OVERRIDE=feature/PFM-1-specs' ]
}

@test "a CRLF body yields the bare branch" {
  directives $'Intro\r\nbackend-branch: feature/x\r\ncplace-e2e-branch: feature/y\r\n'

  [ "$status" -eq 0 ]
  [ "${lines[0]}" = 'BACKEND_BRANCH_OVERRIDE=feature/x' ]
  [ "${lines[1]}" = 'E2E_BRANCH_OVERRIDE=feature/y' ]
}

@test "a directive inside other text is ignored" {
  directives $'Do not set backend-branch: feature/x here.\n> backend-branch: feature/quoted\n  cplace-e2e-branch: feature/indented'

  [ "$status" -eq 0 ]
  [ "${lines[0]}" = 'BACKEND_BRANCH_OVERRIDE=' ]
  [ "${lines[1]}" = 'E2E_BRANCH_OVERRIDE=' ]
}

@test "the last directive wins" {
  directives $'backend-branch: feature/old\nbackend-branch: feature/new'

  [ "$status" -eq 0 ]
  [ "${lines[0]}" = 'BACKEND_BRANCH_OVERRIDE=feature/new' ]
}

@test "the body is never executed" {
  directives $'backend-branch: $(touch '"${BATS_TEST_TMPDIR}"$'/pwned)\n`touch '"${BATS_TEST_TMPDIR}"$'/pwned2`'

  [ "$status" -eq 0 ]
  [ "${lines[0]}" = 'BACKEND_BRANCH_OVERRIDE=$(touch' ]
  [ ! -e "${BATS_TEST_TMPDIR}/pwned" ]
  [ ! -e "${BATS_TEST_TMPDIR}/pwned2" ]
}
