#!/usr/bin/env bash
#
# Shared bats fixtures for tools/scripts/backend-e2e/. External tools the
# scripts call (npm) are replaced by stubs on PATH that record their argv.
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
