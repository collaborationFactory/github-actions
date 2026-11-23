#!/usr/bin/env bash
#
# Reports how far the backend's pins of the frontend packages this PR did not
# publish lag behind the frontend base. Those packages are tested at the
# backend's pins, so a backend that lags its FE base tests the PR against older
# frontend code than the PR is based on. Report only: it never fails the run.
#
# Usage: report-drift.sh <backend-checkout>
#
# Reads <backend-checkout>/*/assets/package.json and the FE_PACKAGE_PREFIXES of
# <backend-checkout>/.github/.frontend-upmerge-env, the file the nightly
# upmerge bumps the same pins from.
#
# Env:
#   PACKAGES             JSON array of the packages the PR published; excluded
#   FE_BASE              the backend line: master, main or release/X.Y
#   GITHUB_OUTPUT        receives drift, the number of packages behind
#   GITHUB_STEP_SUMMARY  receives the table
#
# The FE base's latest version is the one the nightly upmerge would bump to:
# the `snapshot` dist-tag for master/main, the highest X.Y.* for release/X.Y.

set -euo pipefail

# version_spec <backend-line>: the npm spec of the FE base's latest version,
# the mapping of version_spec_for in cplace-gh-workflows'
# upmerge_and_bump_releases.sh. Fails for any other line.
version_spec() {
  case "$1" in
    master | main) echo snapshot ;;
    release/[0-9]*.[0-9]*)
      local line="${1#release/}"
      [[ "${line}" =~ ^[0-9]+\.[0-9]+$ ]] || return 1
      echo "${line}"
      ;;
    *) return 1 ;;
  esac
}

# latest_version <pkg> <spec>: the highest version of <pkg> matching <spec>
latest_version() {
  npm view "$1@$2" version --json 2>/dev/null | jq -er 'if type == "array" then last else . end'
}

main() {
  if (($# != 1)); then
    echo "Usage: $(basename "$0") <backend-checkout>" >&2
    exit 2
  fi
  local var
  for var in GITHUB_OUTPUT GITHUB_STEP_SUMMARY; do
    if [[ -z "${!var:-}" ]]; then
      echo "${var} is not set" >&2
      exit 1
    fi
  done
  local backend="$1" packages="${PACKAGES:-}"
  [[ -n "${packages// /}" ]] || packages='[]'

  local env_file="${backend}/.github/.frontend-upmerge-env" prefixes=''
  if [[ -f "${env_file}" ]]; then
    prefixes="$(sed -n 's/^FE_PACKAGE_PREFIXES=//p' "${env_file}" | tr -d '\r"' | tail -n 1)"
  fi
  if [[ -z "${prefixes}" ]]; then
    echo "::notice::No FE_PACKAGE_PREFIXES in ${env_file}, so no FE version drift is reported"
    echo "drift=0" >>"${GITHUB_OUTPUT}"
    return
  fi
  local spec
  if ! spec="$(version_spec "${FE_BASE:-}")"; then
    echo "::notice::'${FE_BASE:-}' is not a backend line with an FE base, so no FE version drift is reported"
    echo "drift=0" >>"${GITHUB_OUTPUT}"
    return
  fi

  local -a manifests
  shopt -s nullglob
  manifests=("${backend}"/*/assets/package.json)
  shopt -u nullglob

  local pins=''
  if ((${#manifests[@]} > 0)); then
    # "<package> <pin>" for each FE dependency the PR did not publish.
    pins="$(jq -r --arg re "^(${prefixes})/" --argjson published "${packages}" \
      '.dependencies // {} | to_entries[] | select((.key | test($re)) and (.key as $k | $published | index($k) | not)) | "\(.key) \(.value)"' \
      "${manifests[@]}" | sort -u)"
  fi

  local drift=0 name pin latest state
  local -a rows=()
  while read -r name pin; do
    [[ -n "${name}" ]] || continue
    if ! latest="$(latest_version "${name}" "${spec}")"; then
      echo "::warning::Could not look up the latest ${name}@${spec}; its drift is not reported"
      rows+=("| \`${name}\` | \`${pin}\` | ? | unknown |")
      continue
    fi
    if [[ "${pin}" == "${latest}" ]]; then
      state=current
    else
      state=behind
      drift=$((drift + 1))
    fi
    rows+=("| \`${name}\` | \`${pin}\` | \`${latest}\` | ${state} |")
  done <<<"${pins}"

  {
    echo "### FE version drift (\`${FE_BASE}\`, npm \`${spec}\`)"
    echo
    if ((${#rows[@]} == 0)); then
      echo 'The backend pins no FE package other than the published ones.'
    else
      echo "${drift} of ${#rows[@]} FE packages the PR did not publish are behind the FE base."
      echo
      echo '| Package | Backend pin | FE base latest | |'
      echo '|---|---|---|---|'
      printf '%s\n' "${rows[@]}"
    fi
  } >>"${GITHUB_STEP_SUMMARY}"
  echo "drift=${drift}" >>"${GITHUB_OUTPUT}"
}

main "$@"
