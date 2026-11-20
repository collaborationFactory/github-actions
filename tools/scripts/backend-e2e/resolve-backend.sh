#!/usr/bin/env bash
#
# Resolves which backend a frontend PR is tested against, and on which branches.
#
# Env:
#   FE_REPO        the frontend repository name, e.g. cplace-fe
#   BASE_REF       the PR's base branch
#   GITHUB_OUTPUT  receives backend_repo, repo_dir, backend_branch, e2e_branch
#
# The backend's checkout directory (repo_dir) is `main` for cplace, because the
# cplace-gh-workflows actions expect the platform there.

set -euo pipefail

main() {
  if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
    echo "GITHUB_OUTPUT is not set" >&2
    exit 1
  fi

  local backend_repo repo_dir
  case "${FE_REPO:-}" in
    cplace-fe) backend_repo=cplace; repo_dir=main ;;
    ?*-fe) backend_repo="${FE_REPO%-fe}"; repo_dir="${backend_repo}" ;;
    *) echo "No backend repo for '${FE_REPO:-}': expected cplace-fe or <name>-fe" >&2; exit 1 ;;
  esac

  local base_branch
  case "${BASE_REF:-}" in
    main | master) base_branch=master ;;
    release/[0-9]*.[0-9]*-beta) base_branch="${BASE_REF%-beta}" ;;
    release/*) base_branch="${BASE_REF}" ;;
    *)
      base_branch=master
      echo "::warning::Base branch '${BASE_REF:-}' has no backend counterpart, testing against master"
      ;;
  esac

  {
    echo "backend_repo=${backend_repo}"
    echo "repo_dir=${repo_dir}"
    echo "backend_branch=${base_branch}"
    echo "e2e_branch=${base_branch}"
  } >>"${GITHUB_OUTPUT}"
}

main "$@"
