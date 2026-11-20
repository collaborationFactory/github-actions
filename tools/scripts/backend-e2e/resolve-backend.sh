#!/usr/bin/env bash
#
# Resolves which backend a frontend PR is tested against, and on which branches.
#
# Usage:
#   resolve-backend.sh repo      writes backend_repo, repo_dir
#   resolve-backend.sh branches  writes backend_branch, e2e_branch
#
# The two steps are separate because the token that `branches` needs is minted
# for the repository that `repo` resolves.
#
# Env:
#   FE_REPO        (repo) the frontend repository name, e.g. cplace-fe
#   BACKEND_REPO   (branches) the backend repository, as `repo` resolved it
#   BASE_REF       (branches) the PR's base branch
#   HEAD_REF       (branches) the PR's head branch; optional
#   GH_TOKEN       (branches) a token that can read BACKEND_REPO and cplace-e2e
#   GITHUB_OUTPUT  receives the outputs
#
# The backend's checkout directory (repo_dir) is `main` for cplace, because the
# cplace-gh-workflows actions expect the platform there.
#
# The backend and cplace-e2e each get HEAD_REF when they have that branch, and
# the base's counterpart otherwise. A release counterpart the target does not
# have falls back to master. An unreachable remote fails with exit code 2.

set -euo pipefail

# shellcheck source=tools/scripts/backend-e2e/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

resolve_repo() {
  local backend_repo repo_dir
  case "${FE_REPO:-}" in
    cplace-fe) backend_repo=cplace; repo_dir=main ;;
    ?*-fe) backend_repo="${FE_REPO%-fe}"; repo_dir="${backend_repo}" ;;
    *) echo "No backend repo for '${FE_REPO:-}': expected cplace-fe or <name>-fe" >&2; exit 1 ;;
  esac

  {
    echo "backend_repo=${backend_repo}"
    echo "repo_dir=${repo_dir}"
  } >>"${GITHUB_OUTPUT}"
}

# branch_exists <repo> <branch>: like remote_branch_exists, but exits the
# script when the remote is unreachable.
branch_exists() {
  local rc=0
  remote_branch_exists "$1" "$2" || rc=$?
  case "${rc}" in
    0) return 0 ;;
    1) return 1 ;;
    *) exit 2 ;;
  esac
}

# resolve_branch <repo> <base-branch>: prints the branch of <repo> to test with.
resolve_branch() {
  local repo="$1" base="$2"
  if [[ -n "${HEAD_REF:-}" ]] && branch_exists "${repo}" "${HEAD_REF}"; then
    echo "${HEAD_REF}"
  elif [[ "${base}" == release/* ]] && ! branch_exists "${repo}" "${base}"; then
    echo "::warning::${repo} has no branch '${base}', testing against master" >&2
    echo master
  else
    echo "${base}"
  fi
}

resolve_branches() {
  if [[ -z "${BACKEND_REPO:-}" ]]; then
    echo "BACKEND_REPO is not set" >&2
    exit 1
  fi

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

  local backend_branch e2e_branch
  backend_branch="$(resolve_branch "${BACKEND_REPO}" "${base_branch}")"
  e2e_branch="$(resolve_branch cplace-e2e "${base_branch}")"

  {
    echo "backend_branch=${backend_branch}"
    echo "e2e_branch=${e2e_branch}"
  } >>"${GITHUB_OUTPUT}"
}

main() {
  if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
    echo "GITHUB_OUTPUT is not set" >&2
    exit 1
  fi

  case "${1:-}" in
    repo) resolve_repo ;;
    branches) resolve_branches ;;
    *) echo "Usage: $(basename "$0") repo|branches" >&2; exit 2 ;;
  esac
}

main "$@"
