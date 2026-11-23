#!/usr/bin/env bash
#
# Moves an existing clone to one commit, so a test node runs exactly the
# cplace-e2e commit the resolve job chose, even when its branch moved since.
# clone-e2e-repo clones a branch tip and accepts no commit.
#
# Usage: checkout-commit.sh <dir> <sha>
#
# Uses the git credentials the job configured for the clone.

set -euo pipefail

main() {
  if (($# != 2)); then
    echo "Usage: $(basename "$0") <dir> <sha>" >&2
    exit 2
  fi
  local dir="$1" sha="$2" head
  if [[ ! "${sha}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "::error::'${sha}' is not a full commit SHA" >&2
    exit 1
  fi

  git -C "${dir}" fetch --quiet --depth 1 origin "${sha}"
  git -C "${dir}" checkout --quiet --detach "${sha}"
  head="$(git -C "${dir}" rev-parse HEAD)"
  if [[ "${head}" != "${sha}" ]]; then
    echo "::error::${dir} is at ${head} after checking out ${sha}" >&2
    exit 1
  fi
  echo "${dir} is at ${sha}"
}

main "$@"
