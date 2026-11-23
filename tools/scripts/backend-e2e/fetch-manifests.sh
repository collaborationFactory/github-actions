#!/usr/bin/env bash
#
# Fetches the files that tell whether, and how, a frontend PR's published
# packages are consumed: every */assets/package.json and the
# .github/.frontend-upmerge-env of the backend, and the package.json of
# cplace-e2e. Fetches only those files, at the commits resolve-backend.sh chose.
#
# Usage: fetch-manifests.sh <dest-root>
#
# Env:
#   BACKEND_REPO  the backend repository, e.g. cplace
#   BACKEND_SHA   the backend commit to read
#   E2E_SHA       the cplace-e2e commit to read
#   GH_TOKEN      a token that can read BACKEND_REPO and cplace-e2e
#
# Checks out into <dest-root>/backend and <dest-root>/cplace-e2e.

set -euo pipefail

# shellcheck source=tools/scripts/backend-e2e/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# manifests <repo> <sha> <dir> <pattern>...: a blob-less sparse checkout of the
# <pattern>s from collaborationFactory/<repo> at commit <sha> into <dir>.
manifests() {
  local repo="$1" sha="$2" dir="$3"
  shift 3
  git init --quiet "${dir}"
  git -C "${dir}" remote add origin "https://github.com/collaborationFactory/${repo}.git"
  git -C "${dir}" sparse-checkout set --no-cone "$@"
  git_with_token -C "${dir}" fetch --quiet --depth 1 --filter=blob:none origin "${sha}"
  git_with_token -C "${dir}" checkout --quiet --detach "${sha}"
}

main() {
  if (($# != 1)); then
    echo "Usage: $(basename "$0") <dest-root>" >&2
    exit 2
  fi
  local var
  for var in BACKEND_REPO BACKEND_SHA E2E_SHA GH_TOKEN; do
    if [[ -z "${!var:-}" ]]; then
      echo "${var} is not set" >&2
      exit 1
    fi
  done

  local dest="$1"
  manifests "${BACKEND_REPO}" "${BACKEND_SHA}" "${dest}/backend" '/*/assets/package.json' '/.github/.frontend-upmerge-env'
  manifests cplace-e2e "${E2E_SHA}" "${dest}/cplace-e2e" '/package.json'
}

main "$@"
