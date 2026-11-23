# Real-Backend E2E on Frontend PRs Implementation Plan

## Overview

Add a reusable workflow `.github/workflows/fe-backend-e2e.yml` to `github-actions`. It is called from the PR pipelines of cplace-fe and
cplace-paw-fe, and does the following:

- builds the matching backend (`cplace` or `cplace-paw`) once, with the npm snapshot versions the PR published pinned into its `*/assets`;
- boots the backend in docker on a small matrix of nodes;
- runs Cypress specs from a cloned `cplace-e2e` (plus specs from the FE repo's `e2e-tests/` folder);
- fails the PR on any failing test.

The snapshot publishing that feeds it moves into the PR pipeline and exposes its result as outputs. See [Design](./design.md).

## Current State Analysis

- **No snapshot outputs.** The PR snapshot publish (`.github/workflows/fe-pr-snapshot.yml`) is label-gated at line 21. It runs in a
  separate caller workflow and exposes no outputs. The artifacts step (lines 65-73) has no `id:`. `Utils.writeOutput` is called only on the
  release path (`tools/scripts/artifacts/artifacts-handler.ts`, `tagAndPublishRelease`).
- **Backend E2E building blocks exist only in `cplace-gh-workflows@release/2.0`, as composite actions.** Each action resolves its scripts
  from its own checkout (`$GITHUB_ACTION_PATH/../../../src/scripts`), so other repos can call them. They need the following:
  - `env.REPO_NAME` naming a checkout directory under `$GITHUB_WORKSPACE`.
  - `load-env-variables` to read `${REPO_NAME}/.github/.build-env`. Once we check out the backend repo ourselves, that is the backend's
    own env file.
  - `CB_*` variables from that file. The `CB_E2E_*` values, `CB_INCLUDE_PARENT_REPOS` and `CB_E2E_REPO_NAME=cplace-e2e` all come from
    there.
- **Per-node layout expected by `create_and_run_cplace_docker.sh` (release/2.0):** `$REPO_NAME/build/distributions/software.zip`,
  `$GITHUB_WORKSPACE/main/docker/e2e/` (compose path when `docker-compose.yml` exists), and
  `$GITHUB_WORKSPACE/main/e2eConfigurations/config1/properties/`. The backend engine rebuilds `distZip` on every node
  (`reuseable-e2e-cypress.yml`, "Build distribution file").
- **`clone-e2e-repo` fails when given an explicit `e2e_branch` that does not exist.** Without one, it derives the branch from
  `./gradlew properties`.
- **`prepare-git-environment` takes either a pre-minted `github_token`, or `app_id`/`app_key`.** With the App, it reads
  `parent-repos.json` and `REAL_REPO_NAME`.
- **Both FE `pr-checks` aggregators fail on any `needs` result other than `success`, including `skipped`**
  (`cplace-fe: .github/workflows/pull_request.yaml:118-134`, `cplace-paw-fe: .github/workflows/fe-pr.yml:49-65`).
- **Secrets.** cplace-paw-fe passes no App secrets and no `ENV_CPLACE_ARTIFACTORY_*`. cplace-fe has `ENV_CPLACE_ARTIFACTORY_*` (used by
  the devkit test template) but not the product read App.
- **github-actions self-CI** (`.github/workflows/pr-checks.yml`) runs shellcheck and bats on `tools/scripts/lockfile/` only. It does not
  run jest, and it forbids adding npm devDependencies.
- **Neither FE repo has an `e2e-tests/` folder.**

## Desired End State

- Every PR in cplace-fe and cplace-paw-fe runs a `snapshot` job, which publishes affected packages and outputs `version` and
  `packages`. It also runs a `backend-e2e` job that needs the snapshot job and is part of `pr-checks`.
- `backend-e2e` either skips with success, or does the following:
  - builds the backend once, with the published packages it consumes pinned;
  - runs the default spec filter on N nodes against the docker stack;
  - publishes a "Test Results Backend E2E" check;
  - posts a marker comment with the resolved branches, the pins and the failing specs;
  - fails when any test fails.
- The label-based snapshot callers in both FE repos are deleted.

Verify end to end with a cplace-fe PR that changes a published app:

- the check runs;
- the job summary lists the backend branch, the `cplace-e2e` branch and the pinned versions;
- the build log shows those versions in `cf.cplace.platform/assets/package-lock.json`;
- the comment appears.

Also verify that a PR touching only docs finishes `backend-e2e` green without a build job.

### Key Discoveries:

- `artifacts-handler.ts` `handle()` builds and publishes in its final `else` branch (`initProjects(); await this.buildAndPublishProjects();`).
  A failed publish ends the process with `process.exit(1)`, so every `isPublishable` project that is still there afterwards was
  published.
- `NxProject` exposes the public fields `name`, `scope` and `isPublishable` (`tools/scripts/artifacts/nx-project.ts:39-50`).
- Test pattern for outputs: `jest.spyOn(Utils, 'writeOutput').mockReturnValue()` with
  `expect(output).toHaveBeenCalledWith('tag', …)`, in `tools/scripts/artifacts/artifacts-handler-release-flow.test.ts`.
- Bats pattern: `tools/scripts/lockfile/*.bats` with `tools/scripts/lockfile/test-helper.bash`. They run in the `scripts` job of
  `.github/workflows/pr-checks.yml`.
- release/2.0 per-node order: clone `cplace-e2e` → `calculate-e2e-specs-for-node` (`has_specs`, `specs` outputs) → docker → wait → run.
  We keep this order and insert the SDK bump and the spec copy after the clone.
- `run-e2e-test-suite-with-cypress` takes `specs_to_run`. Results land in `<e2e>/test-results/junit`, and `copy-e2e-cypress-results`
  copies them to `/tmp/test-results`.
- JUnit publish action: `EnricoMi/publish-unit-test-result-action/linux@c950f6fb443cb5af20a377fd0dfaa78838901040 # v2.23.0`.
- App token action: `actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0` (`cplace-fe:
  .github/workflows/devkit-test-template.yaml:91`).
- The `cplace-e2e` support has the global commands `cy.loginAsAdminViaTestSetupHandler()` and `cy.waitForCplacePageToLoad()`. The SDK
  constant `CF_PLATFORM_LIB_FOOTER` is published (`cplace-e2e: cypress/e2e/cplace/specs/commonFunctionalities/footer/footer-dialog.spec.ts`).

## What We're NOT Doing

- Prebuilt-image mode or FE overlay.
- Changes to `cplace-gh-workflows`, the `/run-e2e-tests` orchestrator, IAP or backend repos.
- Reusing or fixing `move_own_e2e_tests.sh`.
- Wiring the project-planning, resource-management or forms-wizard FE repos.
- Paw-level testing of cplace-fe changes.
- Affected-spec selection.
- Feature-toggle and Jira suites.
- Changes to the Storybook E2E jobs.
- A separate `FULL_SUITE` input. The full suite is `E2E_SPECS: 'cypress/e2e/**/*.spec.ts'`.
- Sharing the build through the Ubicloud/GitHub cache (`persist-build-workspace`). The build is shared as an artifact instead, so no
  Ubicloud secrets are needed.
- Adding jest to github-actions self-CI. Phase 1 jest tests run locally.

## Implementation Approach

The planning-time choices below settle the "Deferred to planning" list in design.md.

- **Sharing the build across nodes: artifact.**
  - The build job runs `distZip` once, strips analytics, and uploads one artifact, `backend-e2e-bundle`. It contains
    `<REPO_NAME>/build/distributions/software.zip`, `<REPO_NAME>/.github/.build-env`, `main/docker/e2e/` and
    `main/e2eConfigurations/config1/`.
  - Nodes download it into `$GITHUB_WORKSPACE`. The layout is then exactly what `load-env-variables` and the docker script expect, with no
    gradle, no cache provider and no backend checkout.
  - `REPO_NAME` is `main` for cplace, so the two trees coincide there.
- **Default scope.**
  - cplace-fe: `cypress/e2e/cplace/specs/commonFunctionalities/**/*.spec.ts,cypress/e2e/cplace/specs/collaborativeExperience/**/*.spec.ts,cypress/e2e/cplace/specs/ai/**/*.spec.ts`
    with `NODES: '3'`.
  - cplace-paw-fe: `cypress/e2e/cplace-paw/**/*.spec.ts` with `NODES: '2'`.
  - These are starting values. Phase 2 measures them, and Phase 6 sets the final ones.
- **Tokens.**
  - **Product read App** (`SVA_ACTIONS_READ_PRODUCT_ID`/`_KEY`), provisioned as secrets to both FE repos. It is minted per job with
    `create-github-app-token` and handed to `prepare-git-environment` as `github_token`.
  - **The build job** also uses `prepare-git-environment` with `app_id`/`app_key` for parent repos. There, `REAL_REPO_NAME` is set to the
    backend repo name, so no token is requested for the FE repo.
  - **PR comment and checks:** the caller's `GITHUB_TOKEN` (`pull-requests: write`, `checks: write`), as `fe-pr-snapshot.yml` already does.
- **Label callers:** deleted in both FE repos. In `fe-pr-snapshot.yml` the gate becomes the input `REQUIRE_SNAPSHOT_LABEL` (default `true`),
  so other FE repos keep today's behavior.
- **Reuse vs local code.**
  - All backend steps reuse `cplace-gh-workflows/.github/actions/*@release/2.0`, pinned to the branch like every backend consumer. Their
    inner `uses:` are `@release/2.0` anyway.
    Amended 2026-11-23 (Phase 9 §3): the top-level refs are pinned to a release/2.0 commit SHA; only the nested refs stay mutable.
  - New logic lives in bash under `tools/scripts/backend-e2e/`, with bats tests run by `pr-checks.yml`. It covers repo mapping, branch
    resolution, consumed-package detection and pin application.
  - Two composite actions wrap the scripts: `backend-e2e-resolve` and `backend-e2e-pin`. Copying the in-repo specs is a short inline step.
- **Interface.**
  - Workflow inputs: `GHA_REF`, `GHA_BASE`, `SNAPSHOT_VERSION`, `SNAPSHOT_PACKAGES` (JSON array of `@scope/name`), `E2E_SPECS`,
    `NODES` (default `'2'`).
    Amended 2026-11-23 (Phase 9): `SNAPSHOT_INTEGRITIES` (JSON object, default `'{}'`) and `SPEC_MAP` (JSON object, default `'{}'`).
    Amended 2026-11-23 (Phase 11): `ADVISORY` (boolean, default `false`). When it is `true`, the e2e nodes get `continue-on-error`, the
    JUnit check uses `fail_on: nothing`, and the final fail step is skipped; a backend build failure still fails the run, and the report
    still shows the outcome. The trial caller runs with `ADVISORY: true` and `NODES: '2'` (two nodes keep the run under the 60-minute job
    timeout). The Phase 6 rollout callers start with `ADVISORY: true` and switch to `false` once Phase 10's exit criteria are met.
  - Secrets: `ENV_CPLACE_ARTIFACTORY_ACTOR`, `ENV_CPLACE_ARTIFACTORY_TOKEN`, `SVA_ACTIONS_READ_PRODUCT_ID`, `SVA_ACTIONS_READ_PRODUCT_KEY`.
  - Snapshot outputs: `version` (string) and `packages` (JSON array, `[]` when nothing was published).
- **Staging.**
  - Work happens on github-actions branch `feature/fe-backend-e2e`. During Phases 2-5, the internal `collaborationFactory/github-actions/...`
    refs touched by this plan point at that branch. Each such line carries `# FIXME remove before merging` (EDIT-GEN-06). Phase 6 resets
    them to `@master`.
  - A draft PR in cplace-fe (branch `feature/fe-backend-e2e-trial`) calls the workflows `@feature/fe-backend-e2e` and serves as the trial
    consumer.
- **Rules applied** (from `cplace-best-practices`, read via the `repos/` copy because the repos7 symlinks are broken):
  - `details/backend/shell-scripts.md`: `#!/usr/bin/env bash`, `set -euo pipefail`, `shell: bash`, a `case` for choices, tokens only via
    env, bats tests (SH-07).
  - `details/backend/editing-general.md`.
  - `details/e2e/e2e-general.md`, `e2e-structure.md`, `e2e-selectors.md`, `e2e-stability.md` for the sample spec.

## Phase 1: Snapshot outputs and optional label gate

### Overview

The artifacts action reports what a PR snapshot published. `fe-pr-snapshot.yml` exposes it, and its label gate becomes optional. This is
additive: existing callers keep identical behavior.

### Changes Required:

#### 1. Artifacts handler

**File**: `tools/scripts/artifacts/artifacts-handler.ts`
**Changes**: after `buildAndPublishProjects()` in the final `else` branch of `handle()`, write both outputs for PR snapshots.

```ts
console.log(`About to build and release projects`);
this.initProjects();
await this.buildAndPublishProjects();
if (this.task === TASK.PR_SNAPSHOT) {
  this.writePrSnapshotOutputs();
}
```

```ts
private writePrSnapshotOutputs() {
  const packages = this.projects.filter((project) => project.isPublishable).map((project) => `${project.scope}/${project.name}`);
  Utils.writeOutput('version', this.currentVersion.toString());
  Utils.writeOutput('packages', JSON.stringify(packages));
}
```

#### 2. Jest tests

**File**: `tools/scripts/artifacts/artifacts-handler-pr-snapshot-outputs.test.ts` (new)
**Changes**: follow `artifacts-handler-release-flow.test.ts` (env setup, `jest.spyOn(Utils, 'writeOutput')`, a mocked publish). Write the
first test, run it, and confirm it fails before the handler change. Then add the others.

- An affected app plus a publishable lib produce `version` = `0.0.0-<slug>-<pr>` and `packages` = `["@scope/app","@scope/lib"]`.
- A non-publishable lib is not listed.
- Nothing affected produces `packages` = `[]`, and `version` is still set.
- A main snapshot (no `PR_NUMBER`) writes neither output.
- PR close (`ONLY_DELETE_ARTIFACTS` with `PR_NUMBER`, `fe-pr-close.yml`) writes neither output. Added during implementation: that path
  runs through the same `else` branch, so the handler guards with `!this.onlyDeleteArtifacts`.

#### 3. Composite action outputs

**File**: `.github/actions/artifacts/action.yml`
**Changes**: add the outputs `version` and `packages`, each with `value: ${{ steps.handler.outputs.<name> }}` and a description "(PR
snapshot only)".

#### 4. Reusable snapshot workflow

**File**: `.github/workflows/fe-pr-snapshot.yml`
**Changes**:
- Add the input `REQUIRE_SNAPSHOT_LABEL` (`type: boolean`, `default: true`).
- Change the job `if:` to `${{ !inputs.REQUIRE_SNAPSHOT_LABEL || contains(github.event.pull_request.labels.*.name, 'snapshot') }}`.
- Give the artifacts step `id: artifacts`.
- Add job `outputs: version, packages` from `steps.artifacts.outputs.*`.
- Add `on.workflow_call.outputs` `version` and `packages` from `jobs.publish-pr-snapshot.outputs.*`.
- Add `timeout-minutes: 60` to the job.
- Point the artifacts step at `@feature/fe-backend-e2e # FIXME remove before merging` (staging, see Implementation Approach), since the
  new outputs exist only on that branch until merge. Phase 6 resets it.

### Success Criteria:

#### Automated Verification:

- [x] Jest passes: `npx jest --config=./jest.config.js tools/scripts/artifacts`
      (new suite 5/5 green. `utils.test.ts`, `nx-project.test.ts` and `artifacts-handler-tag.test.ts` fail 8 tests identically on
      unchanged `master` on Windows; not touched by this change)
- [x] Prettier passes: `npx prettier --check tools/scripts/artifacts .github` (all changed files pass with `--end-of-line auto`; the
      remaining warnings are CRLF working copies and untouched files)
- [x] Workflow syntax valid: `npx --yes actionlint@1.7.7 .github/workflows/fe-pr-snapshot.yml` (or `docker run --rm -v "$PWD":/repo
      -w /repo rhysd/actionlint:1.7.7`) (docker variant; quoting `"$GITHUB_ENV"` in the base-branch step cleared two SC2086 infos)
- [x] `pr-checks.yml` stays green on the github-actions PR (github-actions#190: lockfile and shell-script checks pass)

#### Manual Verification:

- [x] In the trial cplace-fe PR, a job calling `fe-pr-snapshot.yml@feature/fe-backend-e2e` with `REQUIRE_SNAPSHOT_LABEL: false` publishes
      without the label. Its outputs (`version` and `packages`) are visible in a downstream `echo` job. (run 44682804442:
      `version=0.0.0-feature-fe-backend-e2e-trial-3075`, `packages=["@cplace-next/cf-platform"]`)
- [x] The existing label caller still skips without the label. (cplace-fe#3075 at `81b6bf1`, label caller pointed at the feature
      branch: "Frontend Pull Request Snapshot CI" concluded `skipped`)

---

## Phase 2: Walking skeleton — build with pins, one node, JUnit check

### Overview

Run an end-to-end path through every layer of the design, on the trial cplace-fe PR, with the following limits:

- mapped base branches only;
- no skip path;
- no SDK bump;
- no in-repo specs;
- check only, no comment.

This proves the composites work outside a backend repo. It also settles risks 2 (registry visibility), 3 (install semantics) and 5
(runners).

### Changes Required:

#### 1. Sample bats test first (test pattern)

**File**: `tools/scripts/backend-e2e/pin-snapshots.bats`, `tools/scripts/backend-e2e/test-helper.bash` (new)
**Changes**: write one test first, modeled on `tools/scripts/lockfile/*.bats`. It stubs `npm` on `PATH` and records its argv to a file.
Run it red, then green, before writing the remaining tests.

```bash
@test "pins only published packages that the assets dir depends on" {
  make_assets_dir plugin.a '{"dependencies":{"@cplace-next/cf-platform":"0.0.0-SNAPSHOT-x","lodash":"4.17.21"}}'

  run env PACKAGES='["@cplace-next/cf-platform","@cplace-next/cf-shell"]' \
    "$SCRIPTS/pin-snapshots.sh" 0.0.0-feat-1-42 "$WORK/plugin.a/assets"

  [ "$status" -eq 0 ]
  assert_npm_called_in "$WORK/plugin.a/assets" \
    "i @cplace-next/cf-platform@0.0.0-feat-1-42 --save-exact --legacy-peer-deps"
}
```

Remaining cases:
- No matching dependency: npm is not called, exit 0, nothing is printed.
- A dependency in `devDependencies` is pinned too.
- A missing `package.json` is skipped.
- npm fails: the script exits non-zero with the directory in the message.
- Several dirs give one npm call each.
- The output prints one `<dir> <pkg>@<version>` line per pin.

#### 2. Shared lib and pin script

**File**: `tools/scripts/backend-e2e/lib.sh` (new, sourced, no `set -e`)
**Changes**: `consumed_packages <package.json> <packages-json>` prints the published names found in that file's `dependencies` or
`devDependencies`, one per line:

```bash
consumed_packages() {
  local manifest="$1" packages="$2"
  jq -r --argjson published "${packages}" \
    '[(.dependencies // {}), (.devDependencies // {})] | add | keys[] | select(. as $name | $published | index($name))' \
    "${manifest}"
}
```

**File**: `tools/scripts/backend-e2e/pin-snapshots.sh` (new)
**Changes**: `pin-snapshots.sh <version> <dir>...`, with env `PACKAGES` (a JSON array).
- Shebang `#!/usr/bin/env bash` and `set -euo pipefail`.
- For each dir that has `package.json`, collect the consumed names into an array.
- When the array is non-empty, run `(cd "$dir" && npm i "${args[@]}" --save-exact --legacy-peer-deps)`, the nightly upmerge recipe.
- On npm failure, exit 1 with `"pinning failed in ${dir}"` on stderr.

**File**: `.github/actions/backend-e2e-pin/action.yml` (new)
**Changes**: a composite with inputs `version`, `packages` and `dirs` (newline-separated globs, expanded with `shopt -s nullglob`). It runs
`"$GITHUB_ACTION_PATH/../../../tools/scripts/backend-e2e/pin-snapshots.sh"`, appends its stdout to `$GITHUB_STEP_SUMMARY`, and uses
`shell: bash`.

#### 3. Resolve script, mapped-base version

**File**: `tools/scripts/backend-e2e/resolve-backend.sh` (new), `tools/scripts/backend-e2e/resolve-backend.bats` (new)
**Changes**: env `FE_REPO` and `BASE_REF`. It writes `backend_repo`, `repo_dir`, `backend_branch` and `e2e_branch` to `$GITHUB_OUTPUT`.
One `case` maps the repo:

```bash
case "${FE_REPO:-}" in
  cplace-fe) backend_repo=cplace; repo_dir=main ;;
  *-fe) backend_repo="${FE_REPO%-fe}"; repo_dir="${backend_repo}" ;;
  *) echo "No backend repo for '${FE_REPO:-}': expected cplace-fe or <name>-fe" >&2; exit 1 ;;
esac
```

A second `case` maps the base:
- `main` and `master` map to `master`.
- `release/[0-9]*.[0-9]*-beta` maps to `release/X.Y`.
- `release/*` maps to itself.
- Anything else maps to `master`, with a `::warning::`.

Phase 3 adds the existence checks. bats cases:
- cplace-fe maps to cplace/main.
- cplace-paw-fe maps to cplace-paw.
- An unknown repo fails.
- Each base mapping.

**File**: `.github/actions/backend-e2e-resolve/action.yml` (new)
**Changes**: a composite wrapping `resolve-backend.sh`. It has outputs `backend_repo`, `repo_dir`, `backend_branch`, `e2e_branch` and `run`
(always `true` in this phase). It also writes a step summary table: FE repo, backend repo and branch, `cplace-e2e` branch, snapshot version,
packages.

#### 4. Reusable workflow

**File**: `.github/workflows/fe-backend-e2e.yml` (new)
**Changes**: `on: workflow_call` with the inputs and secrets from Implementation Approach. Jobs:

- **resolve** (`ubuntu-latest`, `timeout-minutes: 10`): run the `backend-e2e-resolve` composite. Map its outputs to job outputs.
- **build** (`needs: resolve`, `if: needs.resolve.outputs.run == 'true'`, runner
  `${{ vars.E2E_MEDIUM_RUNNER || vars.MEDIUM_RUNNER || 'ubuntu-22.04' }}`, `timeout-minutes: 60`). Job env: `REPO_NAME` = resolve
  `repo_dir`, `REAL_REPO_NAME` = resolve `backend_repo`, `DO_UPLOAD: 'false'`, `CREATE_INITIAL_RELEASE: 'false'`,
  `ENV_CPLACE_ARTIFACTORY_*` from secrets. Steps, mirroring `cplace-gh-workflows@release/2.0 .github/workflows/build.yml`:
  1. `create-github-app-token` with `app-id`/`private-key` from the product read App and `repositories: <backend_repo>`.
  2. Check out `collaborationFactory/<backend_repo>` at `backend_branch`, with `path: ${{ env.REPO_NAME }}`, `persist-credentials: false`,
     `fetch-depth: 1` and the token.
  3. `load-env-variables@release/2.0`, with `secrets: ${{ toJson(secrets) }}` and `vars: ${{ toJson(vars) }}`.
  4. `prepare-build-environment@release/2.0`.
  5. `prepare-git-environment@release/2.0` with `app_id`/`app_key`, so parent repos come from the backend's `parent-repos.json`.
  6. `fetch-tags@release/2.0`.
  7. `prepare-parent-repos@release/2.0`, only `if: env.CB_INCLUDE_PARENT_REPOS == 'true'`.
  8. The npm auth step (below).
  9. `rewrite-package-lock-json-files@release/2.0`, under the same condition as in build.yml.
  10. `backend-e2e-pin` with `dirs: ${{ env.REPO_NAME }}/*/assets`.
  11. `patch-release-generate-version-env-file@release/2.0` with `create-initial-release: 'false'`, `trace-log: 'false'` and
      `build-current-version: ${{ env.CB_BUILD_CURRENT_VERSION }}`.
  12. `build-parent-repos@release/2.0` (if) and `build-distribution@release/2.0`.
  13. The inline `distZip` and analytics strip, copied from release/2.0 `reuseable-e2e-cypress.yml`.
  14. Upload artifact `backend-e2e-bundle` with `retention-days: 1` and these paths:
      - `${{ env.REPO_NAME }}/build/distributions/software.zip`
      - `${{ env.REPO_NAME }}/.github/.build-env`
      - `main/docker/e2e`
      - `main/e2eConfigurations/config1`
- **e2e** (`needs: [resolve, build]`, matrix `node_index: ${{ fromJSON(format('[{0}]', ...)) }}`).
  - The matrix is built by a tiny step in resolve that emits a `node_indexes` JSON array from `NODES`. `fail-fast: false`, same runner,
    `timeout-minutes: 60`. Job env: `REPO_NAME` and `ENV_CPLACE_ARTIFACTORY_*`.
  - Steps:
    1. `prepare-e2e-environment@release/2.0`.
    2. Download `backend-e2e-bundle` to `$GITHUB_WORKSPACE`.
    3. `load-env-variables@release/2.0`.
    4. `create-github-app-token` (`repositories: cplace-e2e`).
    5. `prepare-git-environment@release/2.0` with `github_actor: ${{ github.actor }}` and `github_token` = the minted token.
    6. `clone-e2e-repo@release/2.0` with `e2e_branch` = resolve `e2e_branch`.
    7. `actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0` with
       `node-version-file: ${{ env.REPO_NAME }}/${{ env.CB_E2E_REPO_NAME }}/package.json`.
    8. The npm auth step.
    9. `calculate-e2e-specs-for-node@release/2.0` with `e2e_specs: inputs.E2E_SPECS`.
    10. `create-and-run-cplace-docker@release/2.0`, `wait-for-cplace-startup@release/2.0` and `run-e2e-test-suite-with-cypress@release/2.0`,
        with the same inputs and `has_specs` guards as release/2.0 `reuseable-e2e-cypress.yml`.
    11. `copy-e2e-cypress-results` and `copy-cplace-logs` (`always()`).
    12. Upload `backend-e2e-results-${{ matrix.node_index }}` (`/tmp/test-results`) and `backend-e2e-cplace-logs-${{ matrix.node_index }}`,
        with `retention-days: 5`.
- **report** (`needs: [resolve, e2e]`, `if: always() && needs.resolve.outputs.run == 'true'`, `ubuntu-latest`, `timeout-minutes: 15`):
  1. Download the artifacts with `pattern: backend-e2e-results-*` and `merge-multiple: true`.
  2. Run the EnricoMi action with `check_name: 'Test Results Backend E2E'`, `files: test-results/junit/**/*.xml` and
     `json_file: backend-e2e-results.json`.
  3. A final step fails the job unless `needs.e2e.result == 'success'`.

Changed during implementation:
- The bundle is one `backend-e2e-bundle.tgz` built with `tar`, uploaded as the `backend-e2e-bundle` artifact and unpacked on
  the nodes. `upload-artifact` with several paths strips their common prefix, which is `main/` for cplace and nothing for
  other backends, so the layout would differ per backend.
- The bundle holds all of `main/docker` (~375 KB), not only `main/docker/e2e`: the e2e compose file `extends`
  `../elasticsearch/elasticsearch-base.yml`, and trial run 44774066471 failed on the node without it.
- `main/e2eConfigurations/config1` is bundled only when it exists. It is not in the cplace repository; the docker scripts
  only bind-mount it as cplace properties.
- After the bundle upload, an `always()` step uploads `~/.npm/_logs` as `backend-e2e-npm-logs-build`, so a failed pin
  step's `npm i` can be diagnosed from its debug log.

npm auth step (inline, `shell: bash`). The token stays in env, the file is `chmod 600`, and the token never appears in argv:

```bash
umask 077
{
  echo "registry=https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/"
  echo "//cplace.jfrog.io/artifactory/api/npm/cplace-npm/:_authToken=${ENV_CPLACE_ARTIFACTORY_TOKEN}"
} >> "${HOME}/.npmrc"
```

Top-level `permissions:` is `contents: read`, because `build` and `e2e` run lifecycle scripts of PR-built packages; only `report` adds
`checks: write` and `pull-requests: write`, which callers already grant. Every external action is SHA-pinned in
the `owner/repo@<sha> # vX.Y.Z` form.

#### 5. Self-CI for the new scripts

**File**: `.github/workflows/pr-checks.yml`
**Changes**: the `shellcheck` step also checks `tools/scripts/backend-e2e/*.sh tools/scripts/backend-e2e/test-helper.bash`. The `bats` step
runs `bats tools/scripts/lockfile/ tools/scripts/backend-e2e/`.

#### 6. Trial consumer

**File**: `cplace-fe: .github/workflows/pull_request.yaml` (only on trial branch `feature/fe-backend-e2e-trial`, draft PR, never merged)
**Changes**:
- Add a `snapshot` job calling `fe-pr-snapshot.yml@feature/fe-backend-e2e` with `REQUIRE_SNAPSHOT_LABEL: false` and the JFrog and npmrc
  secrets.
- Add a `backend-e2e` job (`needs: snapshot`) calling `fe-backend-e2e.yml@feature/fe-backend-e2e`. Pass the snapshot outputs, the cplace
  default filter and `NODES: '1'`.
- Make a trivial change in `apps/cf-platform` so a package consumed by `cf.cplace.platform` is published.

### Success Criteria:

#### Automated Verification:

- [x] bats passes locally: `bats tools/scripts/lockfile/ tools/scripts/backend-e2e/`
      (93/93 in `bats/bats:1.11.1` with jq and git added, on an LF copy of the tree; the first pin test ran red before
      `pin-snapshots.sh` existed)
- [x] shellcheck passes: `shellcheck tools/scripts/backend-e2e/*.sh tools/scripts/backend-e2e/test-helper.bash`
- [x] Workflow syntax valid: `actionlint .github/workflows/fe-backend-e2e.yml .github/workflows/pr-checks.yml` (docker
      `rhysd/actionlint:1.7.7`; also the trial `cplace-fe: .github/workflows/pull_request.yaml`)
- [x] `pr-checks.yml` on the github-actions PR runs the new bats files and is green (github-actions#190, 93/93 bats)
- [x] On the trial PR, `backend-e2e / report` publishes the "Test Results Backend E2E" check with at least one executed spec
      (run 44777680475, after the secrets were provisioned: "9 fail, 542 pass in 33m 19s". The 9 failures are in 6 specs that fail
      on all three Cypress attempts; not yet triaged against cplace master)

#### Manual Verification:

- [x] The build log shows the pinned `@cplace-next/cf-platform@0.0.0-<slug>-<pr>` in `cf.cplace.platform/assets/package-lock.json` after the
      pin step, and the build succeeds with it (risks 2 and 3). (run 44774066471: pin step logged
      `main/cf.cplace.platform/assets @cplace-next/cf-platform@0.0.0-feature-fe-backend-e2e-trial-3075`; build green)
- [x] The bundle download plus compose boot reaches `applicationStatus.txt` 200 on the node without gradle running there. (run
      44777680475: docker step 67s, "Wait for cplace startup" green after 10s)
- [x] The runner labels resolve for an FE repo (risk 5). Note the wall-clock of build and node. (build job 3m37s, of which
      `build-distribution` ~4 min in the earlier run; node job 59m29s, nearly all Cypress)
- [ ] Spec counts and the node time for the cplace default filter are recorded in the PR description, to set the Phase 6 `NODES` values.
      (measured, not yet in the PR description: 99 specs, 602 tests, 38m34s for the first Cypress pass on one node, plus ~10 min of
      retries for the 6 failing specs; the node job ended 31s before its 60-min timeout. `NODES: '3'` gives ~13 min per node)

---

## Phase 3: Branch resolution, skip path, SDK bump, cost controls

### Overview

Complete the decisions on the resolve side and the harness side:
- same-named branches;
- skip with success when nothing consumed was published;
- `cplace-e2e` SDK pins;
- concurrency and timeouts.

### Changes Required:

#### 1. Branch existence and same-named resolution

**File**: `tools/scripts/backend-e2e/lib.sh`, `tools/scripts/backend-e2e/resolve-backend.sh`, `tools/scripts/backend-e2e/resolve-backend.bats`
**Changes**:
- `lib.sh` gains `remote_branch_exists <repo> <branch>`. It runs
  `git ls-remote --heads "https://github.com/collaborationFactory/${repo}.git" "refs/heads/${branch}"` with a credential helper that
  reads `GH_TOKEN` from env, so the token never appears in argv. It retries 3 times with backoff 5/10/20s and compares the output for an
  exact `refs/heads/${branch}` line, never `--exit-code` (PFM-ISSUE-34932).
  - A network failure after the retries exits 2 and fails the job.
  - "Not found" returns 1.
- `resolve-backend.sh` reads `HEAD_REF` as well, and applies the following to the backend repo and to `cplace-e2e` independently:
  - Use `HEAD_REF` if it exists in the target.
  - Otherwise use the mapped base.
  - A mapped `release/X.Y` that is missing in the target falls back to `master` with a `::warning::`.
- bats cases stub `git`:
  - same-named branch present;
  - absent, falling back to the base;
  - `-beta` with and without `release/X.Y`;
  - an unreachable remote fails;
  - prefix-only matches such as `refs/heads/feature/x-2` for `feature/x` are not treated as a match.

#### 2. Consumed-package detection and skip

**File**: `tools/scripts/backend-e2e/resolve-consumers.sh` (new), `tools/scripts/backend-e2e/resolve-consumers.bats` (new)
**Changes**: env `PACKAGES`, args `<backend-checkout> <e2e-checkout>`. It uses `consumed_packages` on every `<backend>/*/assets/package.json`
and on `<e2e>/package.json`, and writes `backend_packages`, `e2e_packages` and `run` (`true` iff either list is non-empty) to `$GITHUB_OUTPUT`.
An empty or missing `PACKAGES` (for example after a branch-off early return) counts as `[]`. bats cases:
- consumed only by the backend;
- consumed only by `cplace-e2e`;
- consumed by neither, giving `run=false`;
- `[]`.

**File**: `.github/actions/backend-e2e-resolve/action.yml`
**Changes**:
- Before calling the scripts, mint a token for `<backend_repo>,cplace-e2e`. The script already knows `backend_repo`, so split it: the
  composite runs `resolve-backend.sh` for the repo, then mints, then resolves the branches.
- Make blob-less sparse clones (`git clone --depth 1 --filter=blob:none --no-checkout`, then `git sparse-checkout set --no-cone '/*/assets/package.json'`
  for the backend and `'/package.json'` for `cplace-e2e`). Credentials come from `GH_TOKEN` via the same helper.
- Run `resolve-consumers.sh`.
- When `run=false`, the summary states "Skipped: no package consumed by `<backend_repo>` or `cplace-e2e` was published".

**File**: `.github/workflows/fe-backend-e2e.yml`
**Changes**: the e2e matrix and the report are gated on `run == 'true'`, as build already is, so a skip leaves only `resolve` green.

#### 3. SDK bump in cloned cplace-e2e

**File**: `.github/workflows/fe-backend-e2e.yml`
**Changes**: in the e2e job, after `clone-e2e-repo`, run `backend-e2e-pin` with `dirs: ${{ env.REPO_NAME }}/${{ env.CB_E2E_REPO_NAME }}`
when `needs.resolve.outputs.e2e_packages != '[]'`.

#### 4. Cost controls

**File**: `.github/workflows/fe-backend-e2e.yml`
**Changes**: add workflow-level `concurrency: { group: fe-backend-e2e-${{ github.repository }}-${{ github.event.pull_request.number }},
cancel-in-progress: true }`. Confirm that every job has `timeout-minutes`.

Changed during implementation:
- `resolve-backend.sh` takes a step argument: `repo` writes `backend_repo` and `repo_dir`, `branches` (env `BACKEND_REPO`, `BASE_REF`,
  `HEAD_REF`, `GH_TOKEN`) writes `backend_branch` and `e2e_branch`. That is the split §2 asks for, since the token is minted between the two.
- `lib.sh` also gains `git_with_token`, used by `remote_branch_exists` and by the sparse clones. `RETRY_DELAYS` overrides the 5/10/20s
  backoff, so bats runs without sleeping.
- The resolve composite takes `head_ref`, `app_id` and `app_key` (composites cannot read `secrets`), and outputs `backend_packages` and
  `e2e_packages`; the summary lists both.
- `resolve-consumers.sh` warns when the backend checkout has no `*/assets/package.json`, since that skips the run.
- The `cplace-e2e` pin step sits after `setup-node` and the npm auth step, not directly after the clone, because `npm i` needs both.

### Success Criteria:

#### Automated Verification:

- [x] bats passes: `bats tools/scripts/backend-e2e/` (115/115 with `tools/scripts/lockfile/`, in `bats/bats:1.11.1` with jq and git, on
      an LF copy of the tree)
- [x] shellcheck passes: `shellcheck tools/scripts/backend-e2e/*.sh tools/scripts/backend-e2e/test-helper.bash` (docker
      `koalaman/shellcheck:stable`; also the inline sparse-clone step of `backend-e2e-resolve`)
- [x] `actionlint .github/workflows/fe-backend-e2e.yml` (docker `rhysd/actionlint:1.7.7`)
- [x] github-actions `pr-checks.yml` green (github-actions#190: lockfile and shell-script checks pass with the new bats files)

#### Manual Verification:

- [ ] On the trial PR, a push touching only a Markdown file ends with `backend-e2e` = `success`. Only `resolve` ran, its summary says
      "Skipped". The caller's `needs.backend-e2e.result` is `success`, not `skipped`.
- [ ] With a same-named `cplace-e2e` branch pushed, the summary shows it. Without one, it shows the mapped base.
- [ ] A trivial change to `libs/cf-e2e-testing-sdk` pins it in the cloned `cplace-e2e` (node log), and the specs still run.
- [ ] Two quick pushes: the first run's `backend-e2e` is cancelled.

---

## Phase 4: In-repo specs (`e2e-tests/`)

### Overview

Copy the FE repo's `e2e-tests/` into the cloned `cplace-e2e` and include it in the spec filter. Prove it with a sample spec in cplace-fe.

### Changes Required:

#### 1. Copy and filter

**File**: `.github/workflows/fe-backend-e2e.yml`
**Changes**:
- In the e2e job, sparse-check out the FE PR head (`actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3`,
  `ref: ${{ inputs.GHA_REF }}`, `path: fe-repo`, `sparse-checkout: e2e-tests`, `persist-credentials: false`).
- After the SDK bump, run this inline step:

```bash
target="${REPO_NAME}/${CB_E2E_REPO_NAME}/cypress/e2e/${FE_REPO}"
if [ -d fe-repo/e2e-tests ]; then
  mkdir -p "${target}"
  cp -R fe-repo/e2e-tests/. "${target}/"
  echo "specs=${E2E_SPECS},cypress/e2e/${FE_REPO}/**/*.spec.ts" >> "$GITHUB_OUTPUT"
else
  echo "specs=${E2E_SPECS}" >> "$GITHUB_OUTPUT"
fi
```

- `calculate-e2e-specs-for-node` then uses this step's `specs` output.
- `FE_REPO` is `${{ github.event.repository.name }}`.
- The resolve step also checks `e2e-tests/` existence the same way, sparse-checking out the FE head, and lists it in the summary.

#### 2. Sample in-repo spec

**File**: `cplace-fe: e2e-tests/platform/startPage.spec.ts` (new)
**Changes**: a minimal spec following `cplace-e2e`'s support. It uses only global commands and a published SDK constant, with no relative
support imports, so it works from `cypress/e2e/cplace-fe/`.

```ts
/*
 * Copyright 2026, collaboration Factory GmbH. All rights reserved.
 */

// Test document: <placeholder>

import { CF_PLATFORM_LIB_FOOTER } from '@cplace-next/cf-e2e-testing-sdk';

describe('cplace-fe in-repo specs run against the PR backend', () => {
  before(() => {
    cy.loginAsAdminViaTestSetupHandler();
    cy.waitForCplacePageToLoad();
  });

  it('TC01: renders the platform footer after login', () => {
    cy.getByQaName(CF_PLATFORM_LIB_FOOTER).should('be.visible');
  });
});
```

**File**: `cplace-fe: e2e-tests/README.md` (new)
**Changes**: three short sections:
- what runs here: real-backend specs executed inside `cplace-e2e` on every PR;
- the constraints: `cplace-e2e` support and its Cypress major, not linted or type-checked in this repo, `*.spec.ts` only;
- how to run locally: copy into a `cplace-e2e` checkout under `cypress/e2e/cplace-fe/`.

**File**: `cplace-fe: .eslintrc.json`, `cplace-fe: tsconfig.base.json`, and `nx.json` if needed
**Changes**: make sure the `e2e-tests/` folder is not picked up by root lint, tsc or prettier. Add it to the ignore patterns (`.eslintignore`
or `ignorePatterns`, plus `.prettierignore`) only if a check actually picks it up.

Changed during implementation:
- The resolve job checks out `e2e-tests` before the resolve composite and passes
  `in_repo_specs: ${{ hashFiles('fe-repo/e2e-tests/**') != '' }}`, a new composite input that adds an "In-repo specs" row to the summary.
- `run-e2e-test-suite-with-cypress` gets the same `specs` output as `calculate-e2e-specs-for-node` for `workflow_e2e_specs`.
- No ignore change in cplace-fe: `e2e-tests/` belongs to no Nx project, the root `.eslintrc.json` ignores `**/*`, and no tsconfig
  includes it. Prettier formats it, and the new files pass.

### Success Criteria:

#### Automated Verification:

- [x] `actionlint .github/workflows/fe-backend-e2e.yml` (docker `rhysd/actionlint:1.7.7`, with `pr-checks.yml`)
- [x] cplace-fe checks stay green with the new folder: `nx format:check` and `nx affected lint` (no `node_modules` in the local
      cplace-fe checkout: prettier 3.8.1 with the repo's options and `prettier-plugin-organize-imports` passes on `e2e-tests/`; lint
      cannot reach the folder, see above)
- [ ] On the trial PR, the "Test Results Backend E2E" check lists `TC01: renders the platform footer after login` as passed

#### Manual Verification:

- [ ] Temporarily break the sample assertion and confirm that the check and `backend-e2e` fail. Then revert.
- [ ] A PR without `e2e-tests/`, such as cplace-paw-fe in Phase 6, runs only the default filter.

---

## Phase 5: Reporting — marker comment

### Overview

Post one PR comment per run with the outcome, resolved branches, pins and failing specs, and minimize earlier comments from this workflow.

### Changes Required:

#### 1. Comment step

**File**: `.github/workflows/fe-backend-e2e.yml`
**Changes**:
- In `report`, add `actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0`. It reads `backend-e2e-results.json` from the
  EnricoMi step (`json_test_case_results: true`) and the resolve outputs, passed through env.
- It creates a comment beginning with `<!-- fe-backend-e2e -->` that contains:
  - ✅/❌, passed/failed/skipped counts;
  - the backend repo and branch, and the `cplace-e2e` branch;
  - snapshot version, and the pinned backend and e2e packages;
  - up to 20 failing test names with their spec files;
  - links to the run and to the check.
- It pages through the issue comments (`github.paginate`). Every older comment whose body starts with the marker and whose author is
  `github-actions[bot]` is minimized through the GraphQL `minimizeComment(input: {subjectId, classifier: OUTDATED})`.
- The skip path posts no comment. The resolve summary is enough there, and docs-only PRs stay quiet.
- The step runs `if: always()` before the final status step.

Changed during implementation:
- The new comment is created first and the older marker comments are minimized afterwards, so the PR always shows one.
- The spec file of a failing test is the JUnit `test_file`, else the result file name with the `cplace-e2e-results-` prefix and
  `.xml` stripped (`cplace-e2e` writes one `cplace-e2e-results-[suiteFilename].xml` per spec). Only the first failing attempt of a test
  is listed.

### Success Criteria:

#### Automated Verification:

- [x] `actionlint .github/workflows/fe-backend-e2e.yml` (docker `rhysd/actionlint:1.7.7`; the script ran locally against stubbed
      `github`/`context` and a sample results file: one comment, the older bot comment minimized, a foreign comment left alone)
- [ ] On the trial PR, a run produces exactly one non-minimized comment starting with `<!-- fe-backend-e2e -->`

#### Manual Verification:

- [ ] After a second run, the first comment is minimized as outdated.
- [ ] With the sample spec broken, the comment names `TC01` and `startPage.spec.ts` and shows ❌.
- [ ] The comment shows the same branches and versions as the job summary and the build log.

---

## Phase 6: Rollout to cplace-fe and cplace-paw-fe

### Overview

Settle final defaults, document, reset staging refs, provision secrets, wire both FE repos as required checks, and delete the label
callers. github-actions merges first. The FE PRs follow.

### Changes Required:

#### 1. github-actions finalization

**File**: `.github/workflows/fe-pr-snapshot.yml`, `.github/workflows/fe-backend-e2e.yml`
**Changes**: reset every `@feature/fe-backend-e2e` ref to `@master` and remove the `# FIXME remove before merging` markers.

**File**: `README.md`
**Changes**: add a section `## FE Backend E2E (fe-backend-e2e.yml)` covering:
- what it does, with the job graph from design.md;
- inputs, outputs and the required secrets (product read App, `ENV_CPLACE_ARTIFACTORY_*`);
- the branch-resolution and skip rules;
- the `e2e-tests/` convention;
- tool requirements for the scripts (bash ≥ 4.4, jq, git; SH-08);
- the full-suite example `E2E_SPECS: 'cypress/e2e/**/*.spec.ts'`.

Add `REQUIRE_SNAPSHOT_LABEL` to the snapshot description.

**File**: `.github/workflow-templates/fe/fe-pr.yml`
**Changes**: add the `snapshot` and `backend-e2e` jobs and the `pr-checks` need. Add `pull-requests: write` and `checks: write` to the
template's permissions if they are missing.

#### 2. Secrets (operational, before the FE PRs merge)

- [ ] `SVA_ACTIONS_READ_PRODUCT_ID` and `SVA_ACTIONS_READ_PRODUCT_KEY` are available to cplace-fe and cplace-paw-fe (org secret visibility
      or repo secrets). The App is installed on `cplace`, `cplace-paw` and `cplace-e2e`.
- [ ] `ENV_CPLACE_ARTIFACTORY_ACTOR` and `ENV_CPLACE_ARTIFACTORY_TOKEN` are available to cplace-paw-fe.
- [ ] `JFROG_*` and `DOT_NPMRC` are already present in both repos. The snapshot callers use them.

#### 3. cplace-fe wiring

**File**: `cplace-fe: .github/workflows/pull_request.yaml`
**Changes**:

```yaml
snapshot:
  uses: collaborationFactory/github-actions/.github/workflows/fe-pr-snapshot.yml@master
  with:
    GHA_BASE: ${{ github.event.pull_request.base.ref }}
    REQUIRE_SNAPSHOT_LABEL: false
  secrets:
    JFROG_BASE64_TOKEN: ${{ secrets.JFROG_BASE64_TOKEN }}
    JFROG_URL: ${{ secrets.JFROG_URL }}
    JFROG_USER: ${{ secrets.JFROG_USER }}
    DOT_NPMRC: ${{ secrets.DOT_NPMRC }}

backend-e2e:
  needs: snapshot
  uses: collaborationFactory/github-actions/.github/workflows/fe-backend-e2e.yml@master
  with:
    GHA_REF: ${{ github.event.pull_request.head.ref }}
    GHA_BASE: ${{ github.event.pull_request.base.ref }}
    SNAPSHOT_VERSION: ${{ needs.snapshot.outputs.version }}
    SNAPSHOT_PACKAGES: ${{ needs.snapshot.outputs.packages }}
    E2E_SPECS: 'cypress/e2e/cplace/specs/commonFunctionalities/**/*.spec.ts,cypress/e2e/cplace/specs/collaborativeExperience/**/*.spec.ts,cypress/e2e/cplace/specs/ai/**/*.spec.ts'
    NODES: '3'
  secrets:
    ENV_CPLACE_ARTIFACTORY_ACTOR: ${{ secrets.ENV_CPLACE_ARTIFACTORY_ACTOR }}
    ENV_CPLACE_ARTIFACTORY_TOKEN: ${{ secrets.ENV_CPLACE_ARTIFACTORY_TOKEN }}
    SVA_ACTIONS_READ_PRODUCT_ID: ${{ secrets.SVA_ACTIONS_READ_PRODUCT_ID }}
    SVA_ACTIONS_READ_PRODUCT_KEY: ${{ secrets.SVA_ACTIONS_READ_PRODUCT_KEY }}
```

- `pr-checks.needs` becomes `[build, code-quality, e2e, backend-e2e]`.
- Replace `NODES` and the filter with the values measured in Phase 2 if they differ. Keep the Phase 4 sample spec and its README.

**File**: `cplace-fe: .github/workflows/pull_request_snapshot.yaml`
**Changes**: delete.

#### 4. cplace-paw-fe wiring

**File**: `cplace-paw-fe: .github/workflows/fe-pr.yml`
**Changes**:
- The same two jobs, with `E2E_SPECS: 'cypress/e2e/cplace-paw/**/*.spec.ts'` and `NODES: '2'`.
- Add `pr-checks` needs.
- Permissions: add `pull-requests: write` and `checks: write` if they are not already granted. `actions: read` stays.

**File**: `cplace-paw-fe: .github/workflows/fe-pr-snapshot.yml`
**Changes**: delete.

### Success Criteria:

#### Automated Verification:

- [ ] `grep -rn "feature/fe-backend-e2e\|FIXME remove before merging" .github` in github-actions returns nothing
- [ ] `actionlint` passes on all changed workflows in github-actions, cplace-fe and cplace-paw-fe
- [ ] github-actions `pr-checks.yml` green, bats and shellcheck included
- [ ] On the cplace-fe rollout PR, `PR Checks` lists `backend-e2e: success`
- [ ] On the cplace-paw-fe rollout PR, `PR Checks` lists `backend-e2e: success` (run or skip)

#### Manual Verification:

- [ ] A cplace-fe PR that breaks a flow covered by the default filter fails `pr-checks`, and the comment links the failing specs (design
      success criterion 1).
- [ ] A cplace-paw-fe PR changing `cf-landing-page` pins `@cplace-paw-fe/cf-landing-page` in the `cplace-paw` build and runs the paw specs.
- [ ] A docs-only PR in either repo passes without a build job.
- [ ] A typical run stays within the timeouts. Wall-clock is noted in the README section.
- [ ] Labeling a PR `snapshot` no longer triggers a second publish.

---

## Phase 7: Move inline workflow shell into tested scripts

### Overview

Two pieces of logic still live as inline shell in YAML, where the `pr-checks.yml` shellcheck and bats steps never reach them: the `NODES`
validation in `fe-backend-e2e.yml` and the glob expansion with its no-match error in `backend-e2e-pin`. Move both into
`tools/scripts/backend-e2e/` and cover them with bats. This phase lands on `feature/fe-backend-e2e` before Phase 6 merges github-actions;
it changes where the logic lives, not how the workflow behaves.

### Changes Required:

#### 1. Glob expansion in `pin-snapshots.sh`

**File**: `tools/scripts/backend-e2e/pin-snapshots.sh`
**Changes**:
- Usage becomes `PACKAGES='[...]' pin-snapshots.sh <version> <glob>...`. Update the header comment and the usage message.
- Before the pin loop, expand every argument with `shopt -s nullglob`, skipping blank arguments. The expansion is unquoted on purpose and
  keeps its `# shellcheck disable=SC2206` with the reason.
- When the expansion yields no directory, print `No directory matches: <globs>` to stderr and exit 1.
- A literal path expands to itself, so existing callers and the existing bats cases are unaffected.

**File**: `tools/scripts/backend-e2e/pin-snapshots.bats`
**Changes**: add cases:
- a glob such as `"$WORK/*/assets"` matching two dirs pins in both (two npm calls);
- a glob that matches nothing exits 1, names the glob on stderr, and calls npm zero times;
- a blank argument next to a matching glob is ignored.

#### 2. Pin action delegates to the script

**File**: `.github/actions/backend-e2e-pin/action.yml`
**Changes**: remove the `dirs` array loop, the `nullglob` and the no-match check. Read the `DIRS` input lines with
`mapfile -t patterns <<<"${DIRS}"` and call `pin-snapshots.sh "${VERSION}" "${patterns[@]}"`. Keep the step-summary block unchanged. The
`dirs` input description stays as is.

#### 3. Node index script

**File**: `tools/scripts/backend-e2e/node-indexes.sh` (new)
**Changes**: `node-indexes.sh <n>`. It rejects `''`, any non-digit and a leading `0` with
`NODES must be a positive integer, got '<n>'` on stderr and exit 1, and otherwise prints `jq -cn --argjson n "<n>" '[range($n)]'`.
Same header and `set -euo pipefail` conventions as the sibling scripts.

**File**: `tools/scripts/backend-e2e/node-indexes.bats` (new)
**Changes**: `''`, `abc`, `0`, `05`, `-1` fail with exit 1 and the message; `1` prints `[0]`; `3` prints `[0,1,2]`.

#### 4. Wire node indexes through the resolve action

**File**: `.github/actions/backend-e2e-resolve/action.yml`
**Changes**: add input `nodes` (required, `Number of parallel E2E nodes`) and output `node_indexes` (`JSON array [0..nodes-1] for the node
matrix`). Add a step `id: nodes` that passes `NODES: ${{ inputs.nodes }}` through env and writes
`node_indexes=$("$GITHUB_ACTION_PATH/../../../tools/scripts/backend-e2e/node-indexes.sh" "${NODES}")` to `$GITHUB_OUTPUT`. It runs first,
so an invalid `NODES` fails the job before branch resolution.

**File**: `.github/workflows/fe-backend-e2e.yml`
**Changes**: pass `nodes: ${{ inputs.NODES }}` to the resolve action, delete the inline "Node matrix" step, and point the job output at
`${{ steps.resolve.outputs.node_indexes }}`. No extra checkout is needed, since the composite action already ships the scripts.

### Success Criteria:

#### Automated Verification:

- [x] `shellcheck tools/scripts/backend-e2e/*.sh tools/scripts/backend-e2e/test-helper.bash` (docker `koalaman/shellcheck:stable`)
- [x] `bats tools/scripts/backend-e2e/` passes, including the new glob and node-index cases (99/99 with `tools/scripts/lockfile/`, in
      `bats/bats:1.11.1` with jq and git, on an LF copy of the tree)
- [x] `actionlint .github/workflows/fe-backend-e2e.yml` (docker `rhysd/actionlint:1.7.7`, with `pr-checks.yml`)
- [x] `grep -n 'nullglob\|\[!0-9\]' .github/actions/backend-e2e-pin/action.yml .github/workflows/fe-backend-e2e.yml` returns nothing
- [x] Review findings [2.4] marked resolved in review.md. Ticking this item means editing review.md's `- [ ] Resolved` line for [2.4] to
      `- [x] Resolved — <one sentence saying how>`.

#### Manual Verification:

- [ ] On the trial PR, a run with the default `NODES` produces the same node matrix and the same pin summary as before.
- [ ] Temporarily set `NODES: '0'` on the trial caller and confirm that `resolve` fails with the positive-integer error. Then revert.

---

## Phase 8: Move the manifest fetch into a tested script

### Overview

The "Fetch the backend and cplace-e2e manifests" step in `backend-e2e-resolve` is the last inline shell with a function and branching of
its own, so the `pr-checks.yml` shellcheck and bats steps never reach it. Move it into `tools/scripts/backend-e2e/` and cover it with bats,
following Phase 7. It changes where the logic lives, not how the workflow behaves.

### Changes Required:

#### 1. Manifest fetch script

**File**: `tools/scripts/backend-e2e/fetch-manifests.sh` (new)
**Changes**: `fetch-manifests.sh <dest-root>`. It reads `BACKEND_REPO`, `BACKEND_BRANCH`, `E2E_BRANCH` and `GH_TOKEN` from env, and
exits 1 with `<VAR> is not set` on stderr when one is empty. It sources `lib.sh` and keeps the current `manifests <repo> <branch> <dir>
<pattern>` function as is: a `git_with_token clone --quiet --depth 1 --filter=blob:none --no-checkout --branch <branch>` of
`https://github.com/collaborationFactory/<repo>.git`, then `sparse-checkout set --no-cone <pattern>` and `checkout --quiet`. It fetches
`<dest-root>/backend` with `/*/assets/package.json` and `<dest-root>/cplace-e2e` with `/package.json`. Same header and
`set -euo pipefail` conventions as the sibling scripts, so a failing git call fails the script.

#### 2. git stub covers clone and checkout

**File**: `tools/scripts/backend-e2e/test-helper.bash`
**Changes**: the `git` stub keeps its `ls-remote` behaviour. For any other subcommand it logs argv to `GIT_LOG` and exits 0, or exits 128
with a `fatal:` line on stderr when `${REMOTES}/<repo>.unreachable` exists for the cloned repo. Update the stub's header comment.

**File**: `tools/scripts/backend-e2e/fetch-manifests.bats` (new)
**Changes**: cases:
- the backend and cplace-e2e clones use the right URL, `--branch` and sparse pattern, and their target dirs are under `<dest-root>`;
- `GH_TOKEN`'s value appears nowhere in `GIT_LOG`;
- each missing env var exits 1 and names it;
- an unreachable repo makes the script exit non-zero.

#### 3. Resolve action delegates to the script

**File**: `.github/actions/backend-e2e-resolve/action.yml`
**Changes**: the "Fetch the backend and cplace-e2e manifests" step keeps its env and runs
`'"$GITHUB_ACTION_PATH/../../../tools/scripts/backend-e2e/fetch-manifests.sh" "${RUNNER_TEMP}/backend-e2e"'`. The inline `manifests()`
function, the `source` of `lib.sh` and its `shellcheck source=/dev/null` directive go. Keep the comment above the step.

### Success Criteria:

#### Automated Verification:

- [x] `shellcheck tools/scripts/backend-e2e/*.sh tools/scripts/backend-e2e/test-helper.bash` (docker `koalaman/shellcheck:stable`)
- [x] `bats tools/scripts/lockfile/ tools/scripts/backend-e2e/` passes, including the new fetch-manifests cases (121/121 in
      `bats/bats:1.11.1` with jq and git, on an LF copy of the tree; 6 new cases, including a usage check for a missing `<dest-root>`)
- [x] `actionlint .github/workflows/fe-backend-e2e.yml .github/workflows/pr-checks.yml` (docker `rhysd/actionlint:1.7.7`)
- [x] `grep -n 'manifests()\|sparse-checkout' .github/actions/backend-e2e-resolve/action.yml` returns nothing
- [x] Review findings [5.3] marked resolved in review.md. Ticking this item means editing review.md's `- [ ] Resolved` line for [5.3] to
      `- [x] Resolved — <one sentence saying how>`.

#### Manual Verification:

- [ ] On the trial PR, `resolve` produces the same `backend_packages`, `e2e_packages` and `run` outputs as before.

---

## Phase 9: Review hardening

### Overview

Apply the decisions from the 2026-11-23 review of the branch:

- the run verifies that it installs the exact snapshot its snapshot job published;
- the backend and `cplace-e2e` are pinned to commits, not branch tips;
- upmerge and backport PRs resolve to the base line;
- a PR can choose the backend and `cplace-e2e` branch explicitly;
- PRs that only change `e2e-tests/` run;
- spec selection follows the consumed packages through a caller-provided map;
- FE version drift between the backend's pins and the FE base is reported;
- the report says whether a failure is a build, infrastructure or test failure.

Like Phases 7 and 8, this phase lands on `feature/fe-backend-e2e` before Phase 6 merges github-actions. §3 amends the Implementation
Approach line "pinned to the branch like every backend consumer". The nested `@release/2.0` refs inside the `cplace-gh-workflows`
composites stay mutable; this phase cannot change them, and the README says so.

**Research**: See [Additional Research: Review hardening (Phase 9)](./research.md#additional-research-review-hardening-phase-9)

### Changes Required:

#### 1. Snapshot integrity (review item 1)

**File**: `tools/scripts/artifacts/nx-project.ts`, `tools/scripts/artifacts/artifacts-handler.ts`, `.github/actions/artifacts/action.yml`,
`.github/workflows/fe-pr-snapshot.yml`, `tools/scripts/artifacts/artifacts-handler-pr-snapshot-outputs.test.ts`
**Changes**:
- `publish()` runs `npm publish --json`, keeps logging its stdout, and stores the `integrity` from the JSON in a public field
  `publishedIntegrity`.
- `writePrSnapshotOutputs()` also writes `integrities`, a JSON object mapping each published `@scope/name` to its integrity. The artifacts
  action and `fe-pr-snapshot.yml` expose it as an output (`{}` when nothing was published).
- jest: `integrities` lists exactly the published packages with their integrity; non-publishable projects are left out.

**File**: `tools/scripts/backend-e2e/pin-snapshots.sh`, `tools/scripts/backend-e2e/pin-snapshots.bats`,
`.github/actions/backend-e2e-pin/action.yml`, `.github/workflows/fe-backend-e2e.yml`
**Changes**:
- New workflow input `SNAPSHOT_INTEGRITIES` (JSON object, default `'{}'`), passed to the pin action as `integrities` and to the script as
  env `INTEGRITIES`.
- After each `npm i`, the script reads `.packages["node_modules/<name>"].integrity` from that dir's `package-lock.json`. A value that differs
  from the expected one fails with `::error::<name>@<version> changed since this run's snapshot job (republished by a newer push); re-run on
  the latest push`.
- A package without an expected integrity (an older caller) is pinned with a `::warning::` and not checked.
- bats: a match passes; a mismatch exits 1 and names the package; a missing entry warns; an empty `INTEGRITIES` warns once per package.

#### 2. Branch and commit resolution (review items 3, 4, 9)

**File**: `tools/scripts/backend-e2e/lib.sh`, `tools/scripts/backend-e2e/resolve-backend.sh`, `tools/scripts/backend-e2e/resolve-backend.bats`
**Changes**:
- `remote_branch_exists` becomes `remote_branch_sha <repo> <branch>`: it prints the commit of the exact `refs/heads/<branch>` line, with the
  same retries and exit codes (0 found, 1 not found, 2 unreachable).
- `resolve_branch` picks, in this order:
  1. An explicit branch from env `BACKEND_BRANCH_OVERRIDE` / `E2E_BRANCH_OVERRIDE`, validated with `git check-ref-format --branch`. A missing
     explicit branch fails with `::error::` (explicit missing is an error, PFM-ISSUE-34932).
  2. `HEAD_REF`, only when it is not `main`, `master` or `release/*`. An upmerge or backport head is never used as the backend line.
  3. The mapped base, with the existing release-to-master fallback.
- New outputs `backend_sha` and `e2e_sha`.
- bats: an upmerge head (`release/26.1` into `release/26.2`) resolves to `release/26.2`; a `main` head is ignored; an existing override wins
  over a same-named branch; a missing override fails; an invalid override name fails; both SHAs are written.

**File**: `tools/scripts/backend-e2e/pr-directives.sh` (new), `tools/scripts/backend-e2e/pr-directives.bats` (new)
**Changes**: reads env `PR_BODY` (passed through env, never interpolated into a script). It prints `BACKEND_BRANCH_OVERRIDE=<branch>` and
`E2E_BRANCH_OVERRIDE=<branch>` from lines matching `^backend-branch:[[:space:]]*(\S+)` and `^cplace-e2e-branch:[[:space:]]*(\S+)`; the
last match wins and the rest of the body is ignored. bats: no directive; both directives; a CRLF body; a directive inside other text is
ignored. Editing the PR body does not trigger a run; the README says to push or re-run.

**File**: `.github/actions/backend-e2e-resolve/action.yml`, `tools/scripts/backend-e2e/fetch-manifests.sh`,
`tools/scripts/backend-e2e/fetch-manifests.bats`, `.github/workflows/fe-backend-e2e.yml`
**Changes**:
- The resolve action gets input `pr_body` (`github.event.pull_request.body`) and runs `pr-directives.sh` before the `branches` step. It
  outputs `backend_sha` and `e2e_sha`. The summary shows `<branch> @ <sha>` and "(PR body)" when an override was used.
- `fetch-manifests.sh` takes `BACKEND_SHA` and `E2E_SHA` and fetches those commits (`git fetch --depth 1 origin <sha>`) instead of the
  branch tips.
- build: `actions/checkout` uses `ref: ${{ needs.resolve.outputs.backend_sha }}`.
- e2e: after `clone-e2e-repo`, `tools/scripts/backend-e2e/checkout-commit.sh <dir> <sha>` (new, with bats) runs
  `git fetch --depth 1 origin <sha>` and `git checkout --detach <sha>`, then fails unless `git rev-parse HEAD` equals `<sha>`.

#### 3. SHA-pin the cplace-gh-workflows actions (review item 5)

**File**: `.github/workflows/fe-backend-e2e.yml`, the `README.md` section from Phase 6
**Changes**:
- Every `collaborationFactory/cplace-gh-workflows/.github/actions/*@release/2.0` becomes `@<sha> # release/2.0`, at the release/2.0 commit
  current when this phase is implemented (`f621b75326b963a5c4ffda6ff66b8ceba86259f6` on 2026-11-23).
- The README documents how to bump that SHA, and that the actions' nested `uses:` stay at `@release/2.0`.

#### 4. FE version drift report (review item 6)

**File**: `tools/scripts/backend-e2e/report-drift.sh` (new), `tools/scripts/backend-e2e/report-drift.bats` (new),
`tools/scripts/backend-e2e/fetch-manifests.sh`, `.github/actions/backend-e2e-resolve/action.yml`, `.github/workflows/fe-backend-e2e.yml`
**Changes**:
- `fetch-manifests.sh` also checks out `/.github/.frontend-upmerge-env` from the backend.
- `report-drift.sh <backend-checkout>`, with env `PACKAGES` and `FE_BASE`:
  - For every dependency in `*/assets/package.json` that matches `FE_PACKAGE_PREFIXES` and is not in `PACKAGES`, it looks up the latest FE
    base version with `npm view <pkg>@<spec> version --json`. The spec is the `snapshot` dist-tag for `main`/`master` and `X.Y` for
    `release/X.Y`, the mapping of `version_spec_for` in `upmerge_and_bump_releases.sh`.
  - It writes a Markdown table (package, backend pin, FE base latest, `behind`/`current`) to the step summary and outputs `drift`, the
    number of packages behind.
  - Report only: a failed `npm view` gives a `::warning::` naming the package, and the script exits 0. Without a prefixes file it writes one
    notice and no table.
- The resolve action gets input `npm_token` (`ENV_CPLACE_ARTIFACTORY_TOKEN`) and writes a `chmod 600` `.npmrc` like the build job's auth
  step.
- bats: current and behind; the release spec; an npm failure warns and exits 0; no prefixes file; a published package is excluded.

#### 5. Run when `e2e-tests/` changed (review item 7)

**File**: `tools/scripts/backend-e2e/resolve-consumers.sh`, `tools/scripts/backend-e2e/resolve-consumers.bats`,
`.github/actions/backend-e2e-resolve/action.yml`, `.github/workflows/fe-backend-e2e.yml`
**Changes**:
- The resolve action lists the PR's changed files with `gh api --paginate repos/<repo>/pulls/<n>/files --jq '.[].filename'` and
  `GITHUB_TOKEN`; the resolve job gets `permissions: pull-requests: read`. A failure to list the files fails the job, so the run never
  skips silently.
- `resolve-consumers.sh` reads env `SPECS_CHANGED`; `true` (any path under `e2e-tests/`) sets `run=true` even when nothing consumed was
  published.
- The build job's pin step runs only `if: needs.resolve.outputs.backend_packages != '[]'`, so a specs-only run builds the base pins and the
  pin script never sees an empty version.
- bats: changed specs with nothing published give `run=true` with empty package arrays.

#### 6. Package-to-spec map (review item 10)

**File**: `tools/scripts/backend-e2e/resolve-specs.sh` (new), `tools/scripts/backend-e2e/resolve-specs.bats` (new),
`.github/actions/backend-e2e-resolve/action.yml`, `.github/workflows/fe-backend-e2e.yml`, `cplace-fe: .github/workflows/pull_request.yaml`
(trial branch only)
**Changes**:
- New workflow input `SPEC_MAP` (JSON object `{"@scope/pkg": "glob,glob"}`, default `'{}'`).
- `resolve-specs.sh` (env `E2E_SPECS`, `SPEC_MAP`, `CONSUMED` = backend and e2e packages) outputs `specs`: `E2E_SPECS` followed by the mapped
  globs of the consumed packages, comma-joined, duplicates removed in order. Invalid JSON fails.
- Every use of `inputs.E2E_SPECS` in the workflow switches to `needs.resolve.outputs.specs`. Phase 4's copy step appends its `e2e-tests`
  glob to that value. The summary lists the final filter.
- The trial caller passes a sample map. Phase 6 sets the real map per FE repo.
- bats: no map; a mapped package adds its globs; an unconsumed package is ignored; duplicate globs collapse; invalid JSON fails.

#### 7. Classify the outcome (review item 14)

**File**: `tools/scripts/backend-e2e/classify-outcome.sh` (new), `tools/scripts/backend-e2e/classify-outcome.bats` (new),
`.github/workflows/fe-backend-e2e.yml`
**Changes**:
- `report` gets `needs: [resolve, build, e2e]`.
- The script (env `BUILD_RESULT`, `E2E_RESULT`, `TESTS`, `FAILED`) writes `outcome` and a summary heading, one of:
  - `build-failure`: build is not `success`. The text says the backend build failed, there is no test result, and names the backend branch
    and SHA.
  - `infrastructure-failure`: e2e is not `success` and `TESTS` is 0 (docker, startup or harness).
  - `test-failure`: `FAILED` is above 0.
  - `cancelled`.
  - `passed`.
- The advisory warning and the final fail step use the category text. Phase 5's comment shows the same `outcome`.
- bats: one case per category; a build failure wins over a skipped e2e.

### Success Criteria:

#### Automated Verification:

- [x] `bats tools/scripts/lockfile/ tools/scripts/backend-e2e/` passes, including the new and extended files
- [x] `shellcheck tools/scripts/backend-e2e/*.sh tools/scripts/backend-e2e/test-helper.bash`
- [x] `npx jest --config=./jest.config.js tools/scripts/artifacts/artifacts-handler-pr-snapshot-outputs.test.ts`
- [x] `actionlint .github/workflows/fe-backend-e2e.yml .github/workflows/fe-pr-snapshot.yml .github/workflows/pr-checks.yml`
- [x] `grep -n 'cplace-gh-workflows/.*@release/2.0' .github/workflows/fe-backend-e2e.yml` returns nothing
- [x] `grep -n 'inputs.E2E_SPECS' .github/workflows/fe-backend-e2e.yml` matches only the resolve step's input

#### Manual Verification:

The trial-PR checks of this phase are listed under [After the Last Push](#after-the-last-push).

#### Implementation notes (2026-11-23)

- The lockfile bats suite fails on a Windows checkout with `core.autocrlf=true` (CRLF in `test-helper.bash`); it passes from an LF export
  and in CI.
- The e2e and report jobs do not check out github-actions, so the new scripts run through two composite actions next to
  `backend-e2e-pin`: `backend-e2e-checkout-commit` (§2) and `backend-e2e-report` (§7, extended in Phase 11 §1).
- `resolve-backend.sh` now fails when the mapped base branch itself is missing, instead of passing a branch that does not exist to the
  build. It also outputs `base_branch`, which `report-drift.sh` uses as `FE_BASE`.
- `report-drift.sh` reads `dependencies` only, like `discover_matching_deps` in `upmerge_and_bump_releases.sh`.
- §6's "Phase 4's copy step appends its `e2e-tests` glob" was implemented directly as Phase 11 §3: `resolve-specs.sh` adds the glob.
- §3: the README had no backend E2E section yet, so this phase adds "Backend E2E for FE PRs" with the PR-body directives and the SHA
  bump; Phase 6 extends it.
- A node without specs uploads a `no-specs` marker, so Phase 11 §2's node count does not take it for a crashed node.

---

## Phase 10: RCA of the advisory-mode failures

### Overview

Find the root cause of every spec that fails in the trial runs, so that `ADVISORY` is switched off on evidence. The output is a research
note, not code.

### Changes Required:

#### 1. RCA note

**File**: `specs/2026-11-19_fe-pr-e2e-reusable-workflow/rca-advisory-failures.md` (new)
**Changes**:
- Collect the failing tests of trial run 44777680475 and the later trial runs from their `backend-e2e-results-*` artifacts.
- For each failing spec, compare it with the backend's own nightly E2E on the same branch (the same spec on the nearest nightly runs) and
  classify it:
  - fails on the nightly too (pre-existing);
  - specific to this setup: a harness difference such as `config1`, the analytics strip, the node count, ordering under
    `testIsolation: false`, or the SDK pins;
  - caused by the PR;
  - flaky: passes on a retry, or differs between runs.
- Give each a root cause with evidence (log lines, screenshots, run links) and an owner or action.
- End with the exit criteria for `ADVISORY: false`, for example no unexplained failure over N consecutive runs plus a quarantine list for
  pre-existing failures, and the follow-up tasks.

### Success Criteria:

#### Manual Verification:

- [ ] Every failing spec of the analysed runs has a category, evidence and an action.
- [ ] The note states measurable exit criteria for advisory mode and links the follow-ups.

---

## Phase 11: Report script, crashed-node detection, advisory decisions

### Overview

Move the `report` job's comment logic into a tested script, detect nodes that crash before producing results, keep the in-repo specs
decision in one place, and record the advisory-mode and node-count decisions taken during the trial. This phase runs after Phase 9: it
extends `classify-outcome.sh` (Phase 9 §7) and `resolve-specs.sh` (Phase 9 §6). Like Phases 7–9, it lands on `feature/fe-backend-e2e`
before Phase 6 merges github-actions.

### Changes Required:

#### 1. Report builder script (review items [6.1], [6.3], [6.5])

**File**: `tools/scripts/backend-e2e/build-report.sh` (new), `tools/scripts/backend-e2e/build-report.bats` (new),
`tools/scripts/backend-e2e/fixtures/` (results JSON fixtures)
**Changes**:
- Input: path to the EnricoMi results JSON, env `OUTCOME` (from `classify-outcome.sh`), `ADVISORY`, and the output path for the comment
  body.
- With jq it produces the Markdown body that the inline github-script builds today: the heading with verdict and `(advisory)`, the counts,
  and the failure list (`states.failure` and `states.error`, the first message only, and the spec filename fallback when no spec is set),
  capped at 20 items with an "and N more" line.
- Each failure's spec and test name is written inside a code span. Backticks, CR and LF are removed, and the result is truncated to 200
  characters with `…`. PR-controlled test titles therefore cannot inject links, Markdown or `@mentions`.
- It writes `tests` and `failed` (`tests_fail + tests_error`) to `$GITHUB_OUTPUT`. A missing or unreadable JSON fails with `::error::`
  instead of falling back to zeros.
- bats, with fixtures: all passed; failures from both `failure` and `error`; the spec fallback; more than 20 failures; a title with
  backticks, a newline, `@someone` and `[x](y)` comes out inside one code span; an over-long title is truncated; missing JSON fails.

**File**: `.github/workflows/fe-backend-e2e.yml`
**Changes**:
- `report` runs `build-report.sh`. The github-script step only reads the body file and upserts the marker comment.
- The jq "advisory warning" step and its `2>/dev/null || echo "0 0"` fallback are deleted. `classify-outcome.sh` receives `TESTS` and
  `FAILED` from `build-report.sh`'s outputs, and the advisory warning uses the outcome text.

#### 2. Crashed-node detection (review item [6.2])

**File**: `tools/scripts/backend-e2e/classify-outcome.sh`, `tools/scripts/backend-e2e/classify-outcome.bats`,
`.github/workflows/fe-backend-e2e.yml`
**Changes**:
- `report` counts the downloaded `backend-e2e-results-*` artifacts and passes `NODES` (the length of `needs.resolve.outputs.node_indexes`)
  and `NODES_REPORTED` to the classifier.
- `NODES_REPORTED < NODES` gives `infrastructure-failure`, with text naming how many nodes produced no results, even when the other nodes
  passed. A test failure still wins when `FAILED > 0`, and both facts are shown.
- This applies in advisory mode too, so `continue-on-error` cannot hide a crashed node.
- bats: 2 of 2 reported and passing gives `passed`; 1 of 2 reported and passing gives `infrastructure-failure`; 1 of 2 reported with
  failures gives `test-failure` with the missing-node line.

#### 3. One in-repo specs decision (review item [6.4])

**File**: `.github/workflows/fe-backend-e2e.yml`, `tools/scripts/backend-e2e/resolve-specs.sh`,
`tools/scripts/backend-e2e/resolve-specs.bats`, `.github/actions/backend-e2e-resolve/action.yml`
**Changes**:
- The `resolve` job exposes `in_repo_specs` (the existing `hashFiles('fe-repo/e2e-tests/**') != ''`) as a job output.
- In `e2e`, the "Check out the FE repo's in-repo specs" and "Add the in-repo specs" steps run only
  `if: needs.resolve.outputs.in_repo_specs == 'true'`. The copy step only copies; its `[[ -d fe-repo/e2e-tests ]]` branch is removed.
- `resolve-specs.sh` reads env `IN_REPO_SPECS` and `FE_REPO`. When `IN_REPO_SPECS` is `true`, it appends
  `cypress/e2e/<FE_REPO>/**/*.spec.ts` to `specs`. This amends Phase 9 §6, where the copy step appended the glob.
- bats: `IN_REPO_SPECS=true` appends the glob once; `false` leaves the filter unchanged.

#### 4. Sample spec header (review item [6.8])

**File**: `cplace-fe: e2e-tests/platform/startPage.spec.ts`, `cplace-fe: e2e-tests/README.md` (trial branch)
**Changes**:
- Remove the `// Test document: <placeholder>` line.
- The README says to add `// Test document: <url>` under the copyright header when a cplace test document exists for the spec, following
  the `cplace-e2e` convention.

#### 5. Record advisory mode and the trial node count (review items [6.7], [6.9], [6.10])

**File**: `specs/2026-11-19_fe-pr-e2e-reusable-workflow/plan.md`, `specs/2026-11-19_fe-pr-e2e-reusable-workflow/design.md`
**Changes**:
- plan.md Implementation Approach, Interface: add `ADVISORY` (boolean, default `false`) to the workflow inputs with an
  "Amended 2026-11-23 (Phase 11)" line. When it is `true`, the e2e nodes get `continue-on-error`, the JUnit check uses `fail_on: nothing`,
  and the final fail step is skipped. The report still shows the outcome.
- The same amendment records that the trial caller runs with `ADVISORY: true` and `NODES: '2'` (two nodes keep the run under the
  60-minute job timeout), and that the Phase 6 rollout callers start with `ADVISORY: true` and switch to `false` when Phase 10's exit
  criteria are met.
- design.md decision 10: add an amendment line saying advisory mode suspends "the job fails on any failed test" until Phase 10's exit
  criteria are met.

### Success Criteria:

#### Automated Verification:

- [x] `bats tools/scripts/lockfile/ tools/scripts/backend-e2e/` passes, including `build-report.bats` and the extended
      `classify-outcome.bats` and `resolve-specs.bats`
- [x] `shellcheck tools/scripts/backend-e2e/*.sh tools/scripts/backend-e2e/test-helper.bash`
- [x] `actionlint .github/workflows/fe-backend-e2e.yml`
- [x] `grep -n 'jq -r .\.stats' .github/workflows/fe-backend-e2e.yml` returns nothing
- [x] `grep -n 'fe-repo/e2e-tests ]]' .github/workflows/fe-backend-e2e.yml` returns nothing
- [x] `grep -n 'placeholder' ../cplace-fe/e2e-tests/platform/startPage.spec.ts` returns nothing
- [x] Review findings [6.1], [6.2], [6.3], [6.4], [6.5], [6.7], [6.8], [6.9], [6.10] marked resolved in review.md. Ticking this item means
      editing each finding's `- [ ] Resolved` line in review.md to `- [x] Resolved — <one sentence saying how>`.

#### Manual Verification:

The trial-PR checks of this phase are listed under [After the Last Push](#after-the-last-push).

#### Implementation notes (2026-11-23)

- §1 and §2 as written form a cycle: `build-report.sh` takes `OUTCOME` from `classify-outcome.sh`, which takes `TESTS` and `FAILED` from
  `build-report.sh`. `build-report.sh` counts once and then runs `classify-outcome.sh` with those counts; both scripts keep their
  documented env and outputs, and the `backend-e2e-report` action runs only `build-report.sh`.
- §2 counts the `backend-e2e-results-*` subdirs that `download-artifact` writes without `merge-multiple`, and passes `inputs.NODES`
  (validated by `node-indexes.sh`) as `NODES`. The JUnit glob became `test-results/*/junit/**/*.xml`.
- The comment adds an `**<outcome>**: <message>` line and the resolved commits; table values go through the same code-span cleaning as
  test names, since a branch from the PR body may contain a backtick.

---

## Testing Strategy

### Unit Tests:

- **jest** (`tools/scripts/artifacts/artifacts-handler-pr-snapshot-outputs.test.ts`): output names and values for PR snapshots; empty list;
  non-publishable libs excluded; no outputs for main snapshots.
- **bats** (`tools/scripts/backend-e2e/*.bats`, with `npm` and `git` stubbed on `PATH`):
  - **Repo mapping:** every `case` arm, plus the unknown-repo error.
  - **Base mapping:** `main`, `master`, `release/X.Y`, `release/X.Y-beta` with and without a target, an unknown base.
  - **Branch existence:** exact match only, retries, unreachable fails, missing falls back with a warning.
  - **Consumed detection:** `dependencies` and `devDependencies`, missing manifest, empty or blank `PACKAGES`.
  - **Pinning:** only consumed packages, one npm call per dir, npm failure propagates, summary lines.
  - **Glob expansion:** multi-dir match, no match fails, blank patterns ignored.
  - **Node indexes:** empty, non-digit, zero, leading zero and negative rejected; `1` and `3` produce the expected arrays.

### Integration Tests:

On the trial cplace-fe PR:
- the skeleton run;
- the skip run;
- same-named vs base branches;
- the SDK bump;
- the in-repo sample spec, passing and failing;
- comment upsert and minimize;
- concurrency cancel.

### Manual Testing Steps:

1. Push a cf-platform change to the trial PR. Check the summary, the lock contents in the build log, the check and the comment.
2. Push a README-only change. `backend-e2e` should be green with only `resolve` run.
3. Push a same-named `cplace-e2e` branch and re-run. The summary should show it.
4. Break `TC01`. The check, the comment and `pr-checks` should fail. Revert.
5. Push twice quickly. The first `backend-e2e` should be cancelled.

## After the Last Push

These checks need pushes to the trial PR (cplace-fe `feature/fe-backend-e2e-trial`). Record each outcome in the trial PR's description.

- Phase 9: the resolve summary shows the backend and `cplace-e2e` `<branch> @ <sha>`, the drift table and the final spec filter, and the
  snapshot job's outputs include `integrities`.
- Phase 9: two quick pushes; a run that pins after the next push republished the snapshot fails with the integrity error instead of
  testing mixed content.
- Phase 9: a `backend-branch: <existing>` line in the PR body plus a re-run uses that branch; a missing branch fails `resolve`.
- Phase 9: a push that changes only `e2e-tests/` runs build and e2e without pins.
- Phase 9: a deliberately broken backend branch, chosen through the override, makes `report` show `build-failure`; a broken assertion
  shows `test-failure`.
- Phase 11: the marker comment matches the earlier format, and a failing test with Markdown in its title shows as plain code.
- Phase 11: cancelling one e2e node mid-run makes `report` show `infrastructure-failure` naming the missing node, with `ADVISORY: true`
  set.
- Phase 11: a push without `e2e-tests/` changes in a repo that has no `e2e-tests/` skips both in-repo steps in `e2e`.

## Performance Considerations

- One gradle build per run (~30 min measured in IAP on `ubicloud-standard-4`). Nodes skip gradle entirely, because the bundle replaces the
  per-node `distZip`.
- Default nodes: cplace-fe 3, cplace-paw-fe 2. Phase 2 measures this, and the final values are set in Phase 6.
- Every PR push publishes snapshots to `cplace-npm-local` (accepted in the design). `fe-cleanup-snapshots.yml` and `fe-pr-close.yml` stay
  responsible for cleanup.
- Per-PR `cancel-in-progress` keeps at most one run per PR.

## Migration Notes

- Additive for other `fe-pr-snapshot.yml` callers: `REQUIRE_SNAPSHOT_LABEL` defaults to `true`, and the new outputs are ignored.
- Merge order:
  1. github-actions (`master`).
  2. The secrets provisioned.
  3. The cplace-fe and cplace-paw-fe rollout PRs.
  4. Branch protection: `PR Checks` is already the required check, so no ruleset change is needed.
- Rollback: remove `backend-e2e` from `pr-checks.needs` in the FE repos. The workflow can stay in github-actions unused.
- Upstream drift (risk 4): the workflow pins `cplace-gh-workflows` actions to a release/2.0 commit SHA (Phase 9 §3). The actions' own
  nested `uses:` stay at `@release/2.0`, so a breaking change there can still show up as a `backend-e2e` failure in FE PRs. The README
  section names that dependency and how to bump the SHA.

## References

- Research: [Research Document](./research.md)
- Design: [Design Document](./design.md)
- Original ticket: none
- Backend per-node flow: `cplace-gh-workflows@release/2.0: .github/workflows/reuseable-e2e-cypress.yml`
- Backend build stages: `cplace-gh-workflows@release/2.0: .github/workflows/build.yml`
- Bump recipe: `cplace-gh-workflows@release/2.0: src/scripts/upmerge_and_bump_releases.sh` (`bump_plugin`)
- Output test pattern: `tools/scripts/artifacts/artifacts-handler-release-flow.test.ts`
- Bats pattern: `tools/scripts/lockfile/check-lockfile.bats`, `tools/scripts/lockfile/test-helper.bash`
- App token and cross-repo checkout: `cplace-fe: .github/workflows/devkit-test-template.yaml:88-136`
- Branch resolution rules: `cplace-gh-workflows/specs/2026-09-28_PFM-ISSUE-34932_e2e-branch-remote-unreachable/`
