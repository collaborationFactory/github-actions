#!/usr/bin/env bats
#
# Behavioral tests for node-indexes.sh.
#
# Run with: bats tools/scripts/backend-e2e/

setup() {
  load 'test-helper'
}

@test "anything but a positive integer fails with the value in the message" {
  local value
  for value in '' abc 0 05 -1; do
    run "$SCRIPTS/node-indexes.sh" "$value"

    [ "$status" -eq 1 ]
    [ "$output" = "NODES must be a positive integer, got '$value'" ]
  done
}

@test "1 gives a single node" {
  run "$SCRIPTS/node-indexes.sh" 1

  [ "$status" -eq 0 ]
  [ "$output" = '[0]' ]
}

@test "3 gives three nodes" {
  run "$SCRIPTS/node-indexes.sh" 3

  [ "$status" -eq 0 ]
  [ "$output" = '[0,1,2]' ]
}
