#!/usr/bin/env bats
#
# Behavioral tests for fetch-manifests.sh.
#
# Run with: bats tools/scripts/backend-e2e/

setup() {
  load 'test-helper'
  stub_git
  DEST="${BATS_TEST_TMPDIR}/dest"
  BACKEND_SHA=1111111111111111111111111111111111111111
  E2E_SHA=2222222222222222222222222222222222222222
  export BACKEND_REPO=cplace BACKEND_SHA E2E_SHA GH_TOKEN=ghs_secret_token
}

# assert_git_called <argv-substring>
assert_git_called() {
  if ! grep -qF -- "$1" "${GIT_LOG}"; then
    echo "expected git call containing: $1" >&2
    echo "recorded git calls:" >&2
    cat "${GIT_LOG}" >&2
    return 1
  fi
}

@test "checks out the backend's manifests and upmerge env at the backend commit" {
  run "$SCRIPTS/fetch-manifests.sh" "${DEST}"

  [ "$status" -eq 0 ]
  assert_git_called "-C ${DEST}/backend remote add origin https://github.com/collaborationFactory/cplace.git"
  assert_git_called "-C ${DEST}/backend sparse-checkout set --no-cone /*/assets/package.json /.github/.frontend-upmerge-env"
  assert_git_called "-C ${DEST}/backend fetch --quiet --depth 1 --filter=blob:none origin ${BACKEND_SHA}"
  assert_git_called "-C ${DEST}/backend checkout --quiet --detach ${BACKEND_SHA}"
}

@test "checks out cplace-e2e's root manifest at the e2e commit" {
  run "$SCRIPTS/fetch-manifests.sh" "${DEST}"

  [ "$status" -eq 0 ]
  assert_git_called "-C ${DEST}/cplace-e2e sparse-checkout set --no-cone /package.json"
  assert_git_called "-C ${DEST}/cplace-e2e fetch --quiet --depth 1 --filter=blob:none origin ${E2E_SHA}"
  assert_git_called "-C ${DEST}/cplace-e2e checkout --quiet --detach ${E2E_SHA}"
}

@test "no branch tip is fetched" {
  run "$SCRIPTS/fetch-manifests.sh" "${DEST}"

  [ "$status" -eq 0 ]
  ! grep -q -- '--branch' "${GIT_LOG}"
}

@test "the token never appears in git's argv" {
  run "$SCRIPTS/fetch-manifests.sh" "${DEST}"

  [ "$status" -eq 0 ]
  ! grep -q ghs_secret_token "${GIT_LOG}"
}

@test "each missing env var fails and is named" {
  local var
  for var in BACKEND_REPO BACKEND_SHA E2E_SHA GH_TOKEN; do
    run env -u "${var}" "$SCRIPTS/fetch-manifests.sh" "${DEST}"

    [ "$status" -eq 1 ]
    [[ "$output" == *"${var} is not set"* ]]
  done
  [ "$(git_call_count)" -eq 0 ]
}

@test "an unreachable repo fails the script" {
  remote_unreachable cplace-e2e

  run "$SCRIPTS/fetch-manifests.sh" "${DEST}"

  [ "$status" -ne 0 ]
  [[ "$output" == *"fatal: unable to access 'https://github.com/collaborationFactory/cplace-e2e.git'"* ]]
}

@test "a missing dest-root fails with the usage" {
  run "$SCRIPTS/fetch-manifests.sh"

  [ "$status" -eq 2 ]
  [[ "$output" == *'Usage:'* ]]
}
