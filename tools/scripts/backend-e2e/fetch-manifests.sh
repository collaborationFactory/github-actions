#!/usr/bin/env bash
#
# Fetches the manifests that tell whether a frontend PR's published packages are
# consumed: every */assets/package.json of the backend and the package.json of
# cplace-e2e. Uses blob-less sparse clones, so only those files are downloaded.
#
# Usage: fetch-manifests.sh <dest-root>
#
# Env:
#   BACKEND_REPO    the backend repository, e.g. cplace
#   BACKEND_BRANCH  the backend branch to read
#   E2E_BRANCH      the cplace-e2e branch to read
#   GH_TOKEN        a token that can read BACKEND_REPO and cplace-e2e
#
# Clones into <dest-root>/backend and <dest-root>/cplace-e2e.

set -euo pipefail

# shellcheck source=tools/scripts/backend-e2e/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# manifests <repo> <branch> <dir> <pattern>: a sparse checkout of <pattern> from
# collaborationFactory/<repo> at <branch> into <dir>.
manifests() {
  local repo="$1" branch="$2" dir="$3" pattern="$4"
  git_with_token clone --quiet --depth 1 --filter=blob:none --no-checkout --branch "${branch}" \
    "https://github.com/collaborationFactory/${repo}.git" "${dir}"
  git_with_token -C "${dir}" sparse-checkout set --no-cone "${pattern}"
  git_with_token -C "${dir}" checkout --quiet
}

main() {
  if (($# != 1)); then
    echo "Usage: $(basename "$0") <dest-root>" >&2
    exit 2
  fi
  local var
  for var in BACKEND_REPO BACKEND_BRANCH E2E_BRANCH GH_TOKEN; do
    if [[ -z "${!var:-}" ]]; then
      echo "${var} is not set" >&2
      exit 1
    fi
  done

  local dest="$1"
  manifests "${BACKEND_REPO}" "${BACKEND_BRANCH}" "${dest}/backend" '/*/assets/package.json'
  manifests cplace-e2e "${E2E_BRANCH}" "${dest}/cplace-e2e" '/package.json'
}

main "$@"
