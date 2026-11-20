#!/usr/bin/env bash
#
# Shared bats fixtures for tools/scripts/backend-e2e/. External tools the
# scripts call (npm, git) are replaced by stubs on PATH that record their argv.
#
# shellcheck disable=SC2034  # SCRIPTS/WORK are consumed by the .bats files that load this

SCRIPTS="${BATS_TEST_DIRNAME}"
WORK="${BATS_TEST_TMPDIR}/work"
NPM_LOG="${BATS_TEST_TMPDIR}/npm.log"

# Puts an `npm` stub first on PATH. Each call appends "<cwd>|<argv>" to NPM_LOG,
# prints a progress line to stdout like real npm, and exits with NPM_EXIT
# (default 0).
stub_npm() {
  mkdir -p "${BATS_TEST_TMPDIR}/bin"
  cat >"${BATS_TEST_TMPDIR}/bin/npm" <<'STUB'
#!/usr/bin/env bash
echo "${PWD}|$*" >>"${NPM_LOG}"
echo "added 1 package, and audited 2 packages in 1s"
exit "${NPM_EXIT:-0}"
STUB
  chmod +x "${BATS_TEST_TMPDIR}/bin/npm"
  export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}" NPM_LOG
  : >"${NPM_LOG}"
}

# make_assets_dir <plugin> <package.json content>
make_assets_dir() {
  mkdir -p "${WORK}/$1/assets"
  printf '%s\n' "$2" >"${WORK}/$1/assets/package.json"
}

# assert_npm_called_in <dir> <argv>
assert_npm_called_in() {
  if ! grep -qxF "$1|$2" "${NPM_LOG}"; then
    echo "expected npm call: $1|$2" >&2
    echo "recorded npm calls:" >&2
    cat "${NPM_LOG}" >&2
    return 1
  fi
}

npm_call_count() {
  wc -l <"${NPM_LOG}" | tr -d ' '
}

# Puts a `git` stub first on PATH. Each call appends its argv to GIT_LOG.
#
# It answers `git ... ls-remote --heads <url> refs/heads/<branch>` from fixture
# files under REMOTES. It prints a head line for every listed branch that merely
# contains <branch>, which is looser than real git, so exact matching stays the
# job of the script under test.
#
# Any other subcommand, such as clone, sparse-checkout or checkout, exits 0
# without touching the filesystem, or exits 128 with a `fatal:` line on stderr
# when its argv holds the URL of a repo marked unreachable.
stub_git() {
  REMOTES="${BATS_TEST_TMPDIR}/remotes"
  GIT_LOG="${BATS_TEST_TMPDIR}/git.log"
  mkdir -p "${BATS_TEST_TMPDIR}/bin" "${REMOTES}"
  cat >"${BATS_TEST_TMPDIR}/bin/git" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"${GIT_LOG}"
if [[ " $* " != *" ls-remote "* ]]; then
  for arg in "$@"; do
    repo="${arg##*/}"
    if [[ "${arg}" == https://*.git && -f "${REMOTES}/${repo%.git}.unreachable" ]]; then
      echo "fatal: unable to access '${arg}': Could not resolve host: github.com" >&2
      exit 128
    fi
  done
  exit 0
fi
url="${*: -2:1}"
pattern="${*: -1}"
pattern="${pattern#refs/heads/}"
repo="${url##*/}"
repo="${repo%.git}"
if [[ -f "${REMOTES}/${repo}.unreachable" ]]; then
  echo "fatal: unable to access '${url}': Could not resolve host: github.com" >&2
  exit 128
fi
[[ -f "${REMOTES}/${repo}" ]] || exit 0
while read -r branch; do
  if [[ "${branch}" == *"${pattern}"* ]]; then
    printf '0123abcd\trefs/heads/%s\n' "${branch}"
  fi
done <"${REMOTES}/${repo}"
STUB
  chmod +x "${BATS_TEST_TMPDIR}/bin/git"
  export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}" REMOTES GIT_LOG
  : >"${GIT_LOG}"
}

# remote_has <repo> <branch>...: the stubbed remote <repo> has these branches
remote_has() {
  local repo="$1"
  shift
  printf '%s\n' "$@" >>"${REMOTES}/${repo}"
}

# remote_unreachable <repo>: every ls-remote or clone against <repo> fails
remote_unreachable() {
  : >"${REMOTES}/$1.unreachable"
}

git_call_count() {
  wc -l <"${GIT_LOG}" | tr -d ' '
}
