#!/usr/bin/env bash
#
# Shared helpers for the backend E2E scripts (.github/workflows/fe-backend-e2e.yml).
#
# This file is sourced, never executed, so it sets no shell options of its own.

# consumed_packages <package.json> <packages-json>
#
# Prints the names from the JSON array <packages-json> that <package.json>
# lists in `dependencies` or `devDependencies`, one per line, sorted. A blank
# <packages-json> counts as `[]`, as fe-pr-snapshot.yml leaves its `packages`
# output empty when it publishes nothing.
consumed_packages() {
  local manifest="$1" packages="$2"
  [[ -n "${packages// /}" ]] || packages='[]'
  jq -r --argjson published "${packages}" \
    '[(.dependencies // {}), (.devDependencies // {})] | add | keys[] | select(. as $name | $published | index($name))' \
    "${manifest}"
}

# git_with_token <git-args>...
#
# Runs git with a credential helper that answers with GH_TOKEN from the
# environment, so the token never appears in argv. The -c settings reach the
# child processes git starts, such as the lazy blob fetch of a partial clone.
git_with_token() {
  # Single quotes on purpose: the helper's shell expands GH_TOKEN, not this one.
  # shellcheck disable=SC2016
  git -c credential.helper= \
    -c 'credential.helper=!f() { echo username=x-access-token; echo "password=${GH_TOKEN:-}"; }; f' \
    "$@"
}

# remote_branch_exists <repo> <branch>
#
# Returns 0 when collaborationFactory/<repo> has exactly refs/heads/<branch>, 1
# when it does not, and 2 when the remote stays unreachable after the retries.
# Compares the listed refs itself instead of trusting `ls-remote --exit-code`,
# whose pattern also matches refs that merely end in <branch> (PFM-ISSUE-34932).
# RETRY_DELAYS holds the seconds to wait before each retry (default "5 10 20").
remote_branch_exists() {
  local repo="$1" branch="$2" heads delay ref
  local -a delays
  read -r -a delays <<<"${RETRY_DELAYS-5 10 20}"
  for delay in "${delays[@]}" ''; do
    if heads="$(git_with_token ls-remote --heads "https://github.com/collaborationFactory/${repo}.git" "refs/heads/${branch}")"; then
      while IFS=$'\t' read -r _ ref; do
        [[ "${ref}" == "refs/heads/${branch}" ]] && return 0
      done <<<"${heads}"
      return 1
    fi
    if [[ -n "${delay}" ]]; then
      echo "Listing the branches of ${repo} failed, retrying in ${delay}s" >&2
      sleep "${delay}"
    fi
  done
  echo "::error::Cannot reach collaborationFactory/${repo} to look up branch '${branch}'" >&2
  return 2
}
