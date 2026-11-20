#!/usr/bin/env bash
#
# Shared helpers for the backend E2E scripts (.github/workflows/fe-backend-e2e.yml).
#
# This file is sourced, never executed, so it sets no shell options of its own.

# consumed_packages <package.json> <packages-json>
#
# Prints the names from the JSON array <packages-json> that <package.json>
# lists in `dependencies` or `devDependencies`, one per line, sorted.
consumed_packages() {
  local manifest="$1" packages="$2"
  jq -r --argjson published "${packages}" \
    '[(.dependencies // {}), (.devDependencies // {})] | add | keys[] | select(. as $name | $published | index($name))' \
    "${manifest}"
}
