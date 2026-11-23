#!/usr/bin/env bash
#
# Resolves which backend a frontend PR is tested against, and on which branches.
#
# Usage:
#   resolve-backend.sh repo      writes backend_repo, repo_dir
#   resolve-backend.sh branches  writes base_branch, backend_branch, backend_sha,
#                                e2e_branch, e2e_sha
#
# The two steps are separate because the token that `branches` needs is minted
# for the repository that `repo` resolves.
#
# Env:
#   FE_REPO        (repo) the frontend repository name, e.g. cplace-fe
#   BACKEND_REPO   (branches) the backend repository, as `repo` resolved it
#   BASE_REF       (branches) the PR's base branch
#   HEAD_REF       (branches) the PR's head branch; optional
#   BACKEND_BRANCH_OVERRIDE, E2E_BRANCH_OVERRIDE
#                  (branches) explicit branches from the PR body; optional
#   GH_TOKEN       (branches) a token that can read BACKEND_REPO and cplace-e2e
#   GITHUB_OUTPUT  receives the outputs
#
# The backend's checkout directory (repo_dir) is `main` for cplace, because the
# cplace-gh-workflows actions expect the platform there.
#
# Each branch is resolved to the commit it points to now, so every job of the
# run builds and tests the same commits. See resolve_branch for the order of
# preference. An unreachable remote fails with exit code 2.

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

# lookup <repo> <branch>: sets LOOKUP_SHA to the commit of <branch> in <repo>.
# Returns 1 when the branch does not exist, and exits the script when the
# remote is unreachable.
lookup() {
  local rc=0
  LOOKUP_SHA="$(remote_branch_sha "$1" "$2")" || rc=$?
  if ((rc == 2)); then
    exit 2
  fi
  return "${rc}"
}

# valid_branch_name <name>: a name git accepts as a branch, not an option
valid_branch_name() {
  [[ "$1" != -* ]] && git check-ref-format --branch "$1" >/dev/null 2>&1
}

# resolve_branch <repo> <base-branch> <override>: prints "<branch> <sha>", the
# branch of <repo> to test with and its commit, in this order of preference:
#   1. <override>, an explicit branch from the PR body; a missing or invalid
#      one fails, as an explicit choice must not be silently replaced.
#   2. HEAD_REF when <repo> has it, unless it is main, master or release/*:
#      an upmerge or backport head is never a backend line of its own.
#   3. <base-branch>; a release line <repo> does not have falls back to master.
resolve_branch() {
  local repo="$1" base="$2" override="$3"
  if [[ -n "${override}" ]]; then
    if ! valid_branch_name "${override}"; then
      echo "::error::'${override}' from the PR body is not a valid branch name" >&2
      exit 1
    fi
    if ! lookup "${repo}" "${override}"; then
      echo "::error::${repo} has no branch '${override}', which the PR body asks for" >&2
      exit 1
    fi
    echo "${override} ${LOOKUP_SHA}"
    return
  fi

  case "${HEAD_REF:-}" in
    '' | main | master | release/*) ;;
    *)
      if lookup "${repo}" "${HEAD_REF}"; then
        echo "${HEAD_REF} ${LOOKUP_SHA}"
        return
      fi
      ;;
  esac

  if lookup "${repo}" "${base}"; then
    echo "${base} ${LOOKUP_SHA}"
  elif [[ "${base}" == release/* ]] && lookup "${repo}" master; then
    echo "::warning::${repo} has no branch '${base}', testing against master" >&2
    echo "master ${LOOKUP_SHA}"
  else
    echo "::error::${repo} has no branch '${base}'" >&2
    exit 1
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

  local backend e2e backend_branch backend_sha e2e_branch e2e_sha
  backend="$(resolve_branch "${BACKEND_REPO}" "${base_branch}" "${BACKEND_BRANCH_OVERRIDE:-}")"
  e2e="$(resolve_branch cplace-e2e "${base_branch}" "${E2E_BRANCH_OVERRIDE:-}")"
  read -r backend_branch backend_sha <<<"${backend}"
  read -r e2e_branch e2e_sha <<<"${e2e}"

  {
    echo "base_branch=${base_branch}"
    echo "backend_branch=${backend_branch}"
    echo "backend_sha=${backend_sha}"
    echo "e2e_branch=${e2e_branch}"
    echo "e2e_sha=${e2e_sha}"
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
