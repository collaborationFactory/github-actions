---
date: 2026-11-19T19:18:05+01:00
git_commit: 3e8a45b364d0e9f6aae577fe230a0f85be09791c
branch: master
topic: "Reusable workflow to run real-backend Cypress E2E on frontend PRs (cplace-fe, cplace-paw-fe) using the PR's npm snapshots"
tags: [research, ci, github-actions, e2e, cypress, docker, npm-snapshot, cplace-gh-workflows, cplace-integration-all-products, cplace-e2e]
status: complete
last_updated: 2026-11-19
---

# Research: Reusable workflow to run real-backend Cypress E2E on frontend PRs

**Date**: 2026-11-19T19:18:05+01:00
**Git Commit**: 3e8a45b364d0e9f6aae577fe230a0f85be09791c (github-actions)
**Branch**: master

Repos inspected (all under `C:\Users\SenthanalSirpiManoha\cplace-dev\repos7\`): `github-actions`, `cplace-gh-workflows` (local `master`; consumers pin `@release/2.0`, read via `git show origin/release/2.0:<path>`), `cplace-integration-all-products` (IAP), `cplace-e2e`, `main` (= backend repo `cplace`), `cplace-paw`, `cplace-fe`, `cplace-paw-fe`, `cplace-project-planning-fe`, `cplace-staging-builds`, `cplace-resource-management`, `cplace-forms-wizard`.

Ref legend: **RB** = `cplace-gh-workflows@origin/release/2.0`; **FB** = `cplace-gh-workflows@origin/feature/PFM-ISSUE-33733-Automate-Integration-E2E-Tests-on-PRs`; **IAP** = `cplace-integration-all-products@master`.

## Research Question

Today, verifying a frontend change against a real cplace means writing Cypress specs in `cplace-e2e` in a separate PR that is not part of the frontend PR pipeline. Goal: a reusable GitHub workflow in `github-actions` (called from FE `pull_request.yaml` like `code-quality`) that

1. finds the backend repo for the FE repo by naming pattern (`cplace-fe` → `cplace`, `cplace-paw-fe` → `cplace-paw`),
2. updates the relevant `@cplace-*` npm dependencies in the backend repo to the PR's snapshot versions (e.g. the `published-artifacts` comment on cplace-fe#3058),
3. builds/deploys the backend in docker and serves a cplace instance,
4. runs Cypress specs from `cplace-e2e` or from a folder in the FE repo against it,
5. collects results and fails the PR on any failing test.

Prior art to analyze: the `/run-e2e-tests` solution used on cplace-integration-all-products#536.

### User decisions captured during research

| Topic | Decision |
|---|---|
| Relation to existing `/run-e2e-tests` orchestrator | Research both (standalone in github-actions vs. extending orchestrator); decide in design |
| Backend production | Both, per input: default prebuilt image + FE overlay; build from source when matching backend branch exists |
| Trigger | Every PR, required check |
| Spec source | cplace-e2e (matching branch), in-repo folder, explicit spec filter, full suite — all supported |
| Research location | `github-actions/specs/` (no PFM ticket) |

## Summary

- **No existing mechanism tests a frontend PR against a real backend.** FE PR E2E (`github-actions/.github/workflows/fe-e2e.yml`) is Storybook + mocks only. The `/run-e2e-tests` orchestrator only swaps *git branches* in `parent-repos.json`; FE repos are not entries there, so a FE PR run is `matched=false` and silently tests the base. No step in cplace-gh-workflows or IAP overrides `@cplace-*` npm versions.
- **Every building block except the npm override exists**, mostly in RB: backend build (`build.yml`), docker compose with cplace + Elasticsearch (`main/docker/e2e`, `create_and_run_cplace_docker*.sh`), readiness wait, cplace-e2e clone with branch resolution, spec glob sharding, `cypress-repeat` runner, JUnit publish, report comment + marker pattern, GitHub App tokens.
- **The npm override has a proven recipe**: nightly `frontend-upmerge` `bump_plugin` runs `npm i <pkg>@<ver> --save-exact --legacy-peer-deps` in each `<plugin>/assets` (updates package.json + lock). Insert this between clone and build with the PR snapshot version.
- **Snapshot version is deterministic** (`0.0.0-<head_ref[0:50] sanitized>-<pr#>`), but **publishing is opt-in via the `snapshot` label, runs in a separate workflow, only publishes affected projects, and exposes no outputs**. "Every PR, required check" therefore needs a change to how/when snapshots are published.
- **Prebuilt-image mode exists only on FB (PR #306) and is incompatible with current master images** (they require external Elasticsearch). No prebuilt E2E image is consumed by any test run today; images from `cplace-staging-builds` are product images.
- **FE in-repo `apps/*-e2e` specs cannot target a real backend** (all Storybook, `*.cy.ts`, mocks). "Specs in the FE repo" needs a new folder convention executed inside the cplace-e2e harness.
- **Cost**: one IAP E2E run ≈ 30 min build + 8 nodes × 22–32 min ≈ 4.5 vCPU-h, ~66 min wall-clock. Running on every FE PR requires a much smaller default footprint (fewer nodes, build once, targeted specs).

## Detailed Findings

### 1. Current frontend PR pipeline (github-actions)

- Consumers call `collaborationFactory/github-actions/.github/workflows/<x>.yml@master`; inputs UPPER_CASE strings, secrets passed explicitly.
- cplace-fe `pull_request.yaml`: `install-deps` → `build`, `code-quality`, `e2e` → `pr-checks` (jq aggregator; a new job must be added to `needs:` to gate merges). Identical shape in cplace-paw-fe (`fe-pr.yml`) and cplace-project-planning-fe (`fe-pr.yml`). No repo sets `concurrency` (template `workflow-templates/fe/fe-pr.yml:13-16` does).
- Caching: `actions/cache` on `**/node_modules`, key `${{ runner.os }}-modules-${{ hashFiles('**/package-lock.json') }}` (`fe-install-deps.yml:25-30`). Downstream jobs restore it.
- `GHA_REF` = `pull_request.head.ref` (branch name, not SHA); `GHA_BASE` = base ref. `run-many` (`tools/scripts/run-many/run-many.ts`) computes nx affected and round-robin shards.
- `fe-e2e.yml`: `cypress/browsers:24.22.1` container, 4 shards, `nx run-many --targets=e2e -c ci`; every e2e project uses `@nx/cypress:cypress` with a Storybook `devServerTarget` (e.g. `cplace-fe/apps/cf-frontend-sdk-e2e/project.json:20-38`, baseUrl `localhost:4409`). **No real backend.**
- Secrets in use: `DOT_NPMRC`, `JFROG_*`, `SONAR_CLOUD_TOKEN`, `PERCY_TOKEN`, `GIT_USER*`, `SVA_ACTIONS_READ_PRODUCT_FE_CLIENT_ID/_KEY` (read App), `SVA_ACTIONS_WRITE_PRODUCT_FE_*`, `ENV_CPLACE_ARTIFACTORY_ACTOR/TOKEN` (cplace-fe devkit only). Unverified whether paw-fe/pp-fe have the App/artifactory secrets.
- Closest cross-repo precedent: `cplace-fe/.github/workflows/devkit-test-template.yaml:88-115` — mints `actions/create-github-app-token@v3.3.0` (client-id, `repositories:`, `permission-contents: read`), checks out `collaborationFactory/cplace`.

### 2. PR snapshot publishing

- Caller: `cplace-fe/.github/workflows/pull_request_snapshot.yaml` (paw/pp: `fe-pr-snapshot.yml`) → `github-actions/.github/workflows/fe-pr-snapshot.yml@master`. Triggers `pull_request: [labeled, synchronize, reopened]` (not `opened`); job gated by `contains(labels, 'snapshot')` (`fe-pr-snapshot.yml:21`). Runs in parallel to `pull_request.yaml`, own checkout + `npm ci` + build.
- Version: `github-actions/tools/scripts/artifacts/utils.ts:315-319`
  ```ts
  return `-${branch.substring(0, 50).replace(/[^0-9A-Za-z-.@]/g, '-')}-${prNumber}`;
  ```
  → `0.0.0-<slug>-<pr#>`, `currentBranch = GITHUB_HEAD_REF` on PR events (`utils.ts:284-299`). Dist-tag `latest-pr-snapshot` (`nx-project.ts:~357`). Main snapshots: `0.0.0-SNAPSHOT-<hash>-<date>`, tag `snapshot` (`utils.ts:311-312`).
- Packages: affected only (`artifacts-handler.ts:31,187-204`); `*-e2e` apps dropped unless they have `src/public_api.ts`; `api-*` dropped; libs only if `"publishable": true` (`nx-project.ts:52-63`). Scope = root package.json name: `@cplace-next` (cplace-fe), `@cplace-paw-fe`, `@cplace-project-planning-fe`.
- Re-publish: unpublish same version then publish (`artifacts-handler.ts:164-168`) → brief window where the version does not exist; consumers must poll.
- Comment: `githubCommentsForPR.txt` → github-script upserts a comment with marker `<!-- published-artifacts -->` (`fe-pr-snapshot.yml:75-89`), one `@scope/name@version` per line; default text "No snapshots of projects have been published (probably no project is affected)".
- **Downstream knowledge**: version recomputable from `github.head_ref` + `github.event.number`; package list **not** exposed as output. Options: parse comment, re-run affected query, add `$GITHUB_OUTPUT` in `artifacts-handler.ts` + `outputs:` on `fe-pr-snapshot.yml` (cleanest), or `npm view` against JFrog.
- **Ordering**: separate workflow → no `needs:`. Options: call `fe-pr-snapshot.yml` as a job inside `pull_request.yaml`; `workflow_run` trigger; or poll registry/comment.

### 3. Backend consumption of FE packages

| FE repo (default) | npm scope | Backend repo | Pinning file(s) |
|---|---|---|---|
| cplace-fe (`main`) | `@cplace-next` | cplace (`main/`) | `cf.cplace.platform/assets/package.json:20-22` (`cf-frontend-customization`, `cf-platform`, `cf-shell`) |
| cplace-paw-fe (`master`) | `@cplace-paw-fe` | cplace-paw | `cf.cplace.landingPage`, `cf.cplace.lowCodeWidgets`, `cf.cplace.training.extended`, `cf.cplace.userpilot` `/assets/package.json` |
| cplace-project-planning-fe (`master`) | `@cplace-project-planning-fe` | cplace-project-planning (not checked out) | `cf.cplace.gantt/assets/package.json` |
| cplace-resource-management-fe | `@cplace-resource-management-fe` | cplace-resource-management | `cf.cplace.resourceManagement/assets/package.json` |
| cplace-forms-wizard-fe | `@cplace-forms-wizard-fe` | cplace-forms-wizard | `cf.cplace.formsWizard/assets/package.json` |

- Naming pattern `<x>-fe` → `<x>` holds except `cplace-fe` → `cplace` (local dir `main`). Each FE package is consumed at runtime by exactly one backend repo. `@cplace-next/*` also appears in other FE repos' root package.json (build-time FE→FE), not in their backends.
- Pins are exact; `package-lock.json` next to each with `resolved` + `integrity` (`main/cf.cplace.platform/assets/package-lock.json:173-177`); `.npmrc` `save-exact=true`. Editing package.json alone is insufficient — regenerate lock.
- Registry auth in CI: `cplace-gh-workflows/src/scripts/setup_npmrc.sh:9-29` (`cplace-npm` virtual repo, `ENV_CPLACE_ARTIFACTORY_*`). Note FE snapshots are published to `cplace-npm-local` (`github-actions/tools/scripts/artifacts/configuration.ts`); the backend reads via the virtual `cplace-npm` (to verify it aggregates local).
- Install happens inside gradle/cplace-asc (`build_distribution.sh:42`, `-PgeneratePackageJson=true`; `build_cplace_asc.sh:19-36`). Whether it uses `npm ci` or `npm install` is unverified (no plugin source locally); assume lock is honoured.
- **Bump recipe** (RB `src/scripts/upmerge_and_bump_releases.sh`): `discover_matching_deps` (`:173-185`, jq on `.dependencies` matching `^(FE_PACKAGE_PREFIXES)/`), `bump_plugin` (`:224-251`, `npm i pkg@spec --save-exact --legacy-peer-deps` in `<plugin>/assets`), loop `*/assets/package.json` (`:287-320`), allowlist `^([^/]+/assets/)?(package|package-lock)\.json$` (`:93-96`). Prefixes in `<repo>/.github/.frontend-upmerge-env` (`FE_PACKAGE_PREFIXES=@cplace-next` in main, `@cplace-paw-fe` in cplace-paw; resource-management/forms-wizard have none). `version_spec_for` (`:158-171`) maps `master|main` → `snapshot`, `release/X.Y` → `X.Y`.
- Alternative tooling: `cplace-fe/libs/cf-devkit/src/lib/commands/integrate/` (`integrate.service.ts:271-281`, `utils/package-installer.ts:168`) — dev-oriented, opens PRs; `--skipPullRequest` exists.
- **Only bump packages the PR actually published** (affected-only publishing); blanket bump → `notarget`.
- Parent repos: `cplace-paw/parent-repos.json` = `main@master` only; resource-management/forms-wizard list more. Parents are cloned (`cplace-cli repos --clone --depth 1`) and their assets built (`buildParentReposResources`). Hence a cplace-fe override when building cplace-paw would mean bumping `../main/cf.cplace.platform/assets`.
- Branch mapping: FE `main`/`master` → BE `master`; `release/X.Y` → `release/X.Y`; `release/X.Y-beta` (cplace-fe only) → no BE counterpart.

### 4. Existing `/run-e2e-tests` solution (cplace-gh-workflows RB + IAP)

Flow: PR comment → consumer `slash-commands.yml` (IAP: gated by `vars.CB_SLASH_COMMANDS_ENABLED`, OWNER/MEMBER/COLLABORATOR, `:19-27`) → RB `slash-command-router.yml:95-105` → `run-e2e-tests-command.yml` (parses ```` ```yaml ```` params via `parse_slash_command_parameters.sh`; mints `SVA_CONTAINER_BUILD_BOT` token; `command_run_integration_e2e_dispatch.sh:93-111` dispatches with retry) → IAP `integration-e2e-orchestrator.yml` (concurrency `integration-e2e-<repo>-<pr>`) → RB `integration-e2e-orchestrator.yml`:

1. validate inputs (`:82-111`); 2. derive test branch `e2e/<repo>/pr-<n>` (`functions.sh:276-282`); 3. cancel previous runs; 4. sparse-checkout source `parent-repos.json` (`:132-150`); 5. reset test branch to `integration_branch || base_branch` (`integration_e2e_prepare_branch.sh`); 6. `merge_parent_repos.sh` — source entries replace target, source's own entry (matched by url basename) gets PR head branch, outputs `source_matched`; 7. commit + force-push; 8. dispatch `commit.yml`, `e2e-cypress.yml`, `e2e-cypress-feature-toggle.yml` (`integration_e2e_dispatch_workflows.sh:79-93`, run IDs parsed from `gh workflow run` output); 9. upsert draft test PR authored by `SVA_CONTAINER_BUILD_BOT` with marker `<!-- cplace:integration-e2e source=… pr=… sha=… matched=… build=<id> e2e=<id> e2e-toggle=<id> -->`; 10. status comment via `SVA_ACTIONS_PR_WRITER`. `cleanup` action on PR close.

Reporting: trailing `report` job in each IAP run (`if startsWith(ref_name,'e2e/')`, serialized per branch) → `integration-e2e-reporter.yml` → `integration_e2e_report.sh` reads marker, renders run table, minimizes older comments (`minimizeComment`).

**FE support: none.** FE repos aren't IAP `parent-repos.json` entries → `matched=false` warning (`integration_e2e_report.sh:214-216`); no npm input.

PR #536 evidence: three triggers; test PR #551 (`e2e/cplace-integration-all-products/pr-536`); 2026-11-10 runs all failed in `build` (~12–24 min) before Cypress: `npm error notarget No matching version found for @cplace-assets/cplace@27.1.999` — the `X.Y.999` feature-branch version rewrite (`rewrite_versions_for_customer_and_feature_branches.sh`) is not propagated to inter-repo npm deps. **Lesson: a FE PR flow must own npm pinning and must not rely on the 999 rewrite.**

### 5. E2E engine (RB)

- `e2e-cypress.yml`: `build` (→ `build.yml`, `do_upload: true`, `:52-59`) → `setup-matrix` (`CB_E2E_NUMBER_OF_NODES`, IAP = 8) → `e2e-cypress` matrix (`fail-fast: false`) → `collect-and-publish-e2e-test-results` (merged HTML to gh-pages) → Slack (cron only) → `delete_build_cache`.
- `build.yml:62-186`: load env (`.github/.build-env` + `.github/.<workflow>-env`, `<<secrets.X>>` placeholders) → JDK 21 + `setup_npmrc.sh` → `prepare-parent-repos` → optional `rewrite-package-lock-json-files` → optional 999 rewrite → `build-parent-repos` → `build-distribution` → persist workspace (Ubicloud/GH cache). **Insertion point for npm override: after `prepare-parent-repos`, before `build-parent-repos`/`build-distribution`.**
- `reuseable-e2e-cypress.yml` per node (`:68-232`): runner `vars.E2E_MEDIUM_RUNNER || vars.MEDIUM_RUNNER || inputs.runner`; Chrome pinned 157.0.8103.78; attach cache; `prepare-git-environment` (read App + `cplace-e2e`); `clone-e2e-repo`; `calculate_e2e_specs_for_node.sh` (`:116-123`); per-node `./gradlew distZip -x copyResources -x gzAssets` (`:125-134`); strip `cf.cplace.analytics` (`:136-140`); `create_and_run_cplace_docker.sh` (`:142-150`); `wait_for_cplace_startup.sh` (`:152-158`); optional self-provided tests (`:166-170`); Cypress (`:172-182`); upload `test_results-N`, `cplace-logs-e2e-N`, JUnit check "Test Results E2E" via `EnricoMi/publish-unit-test-result-action` (`:196-232`). No `timeout-minutes` anywhere.
- Docker (`create_and_run_cplace_docker.sh:32-44`): if `../main/docker/e2e/docker-compose.yml` exists → `create_and_run_cplace_docker_compose.sh` (cplace container `main` + single-node ES `${CB_E2E_ES_VERSION:-8.19.x}`, health-gated); else `docker build` + `docker run -d --name main -p 8083:8083 -e E2ETOKEN=hIF9Z97RZiYm …`. Image: `azul/zulu-openjdk-alpine:21`, unpacks `software.zip`, embedded HSQLDB, fixed license env, `ACTIVATED_PLUGINS`, context `/intern/tricia/`; `startup.sh` aborts without `ES_HTTP_ADDRESSES`. Image is local only, never pushed.
- Contract to keep (from `main/specs/2026-09-28_PFM-ISSUE-28989_adapt-e2e-docker-setup/design.md`): container name `main`, host port = container port 8083, token `hIF9Z97RZiYm`, logs `/app/data/log`, properties at `/app/properties` from `main/e2eConfigurations/config1/properties`; logs via `docker compose -p cplace-e2e logs`.
- Readiness: poll `/intern/tricia/applicationStatus.txt` → 200, then `administrationDashboard/listPlugins?testSetupHandlerE2EToken=…` → JSON; 5 s interval, `CB_E2E_WORKFLOW_WAIT_TIMEOUT=300`.
- Cypress (`run_e2e_cypress_test_suite.sh:37-41` RB): `npm install --legacy-peer-deps; npx cypress-repeat run -n 3 --rerun-failed-only --spec "<list>" --browser chrome` (master: `-n 2`). The `BASE_URL` input is passed but unused; `cypress.config.ts` baseUrl `localhost:8083` applies.
- Runtime measured (IAP run 44547870980, release/26.2, success): build ~30 min on `ubicloud-standard-4`; 8 nodes × 22–32 min on `ubicloud-standard-8` (each node rebuilds distZip + image + boots ES/cplace); ~66 min wall-clock, ≈4.5 vCPU-h. Runners: Ubicloud managed.
- **Pull-image mode (FB only, PR #306)**: `docker_image` input skips `build` and per-node distZip; `docker/login-action` to `cplace.jfrog.io` (`ENV_[TEST_]CPLACE_ARTIFACTORY_DOCKER_*`); `pull_docker_image()`; `derive_e2e_branch_from_image.sh` maps `/e2e/<X.Y>/` → `release/X.Y`. Image format `cplace.jfrog.io/cplace-product-registry/e2e/<X.Y>/<repo>:<tag>`, produced by `cplace-staging-builds` (`/container-build`). Predates compose/ES → runs single container; incompatible with current master images. Related open PRs #274 (PFM-ISSUE-33733 "Automate Integration E2E tests on PRs") and #206 (`/e2e-run`) touch the same scripts.
- Required secrets for E2E path: `ENV_CPLACE_ARTIFACTORY_ACTOR/TOKEN`, `SVA_ACTIONS_READ_PRODUCT_ID/KEY`, (pull mode) `ENV_CPLACE_ARTIFACTORY_DOCKER_*`, `UBICLOUD_*`, plus suite secrets referenced in env files (Jira, SharePoint, Userpilot).

### 6. cplace-e2e

- Single root `cypress.config.ts`: `baseUrl: 'http://localhost:8083/'` (`:61`), `specPattern: 'cypress/**/*.spec.ts'` (`:62`), `testIsolation: false`, multi-reporter junit (`test-results/junit/…`) + mochawesome (`:65-84`), flaky-attempt handling in `after:spec` (`:35-50`). No `retries` (runner provides). Cypress `^13` (cplace-fe uses 15.8.0). Node 24.22.1.
- Layout: `cypress/e2e/<product>/specs/**` (cplace 137, project-planning 486, resource-management 86, board 31, paw 18 …), `cypress/e2e_toggle/<product>` (cplace 353, paw 17, pp 10), `cypress/e2e_jira/cplace-jira` (63). Support in `cypress/support/` (TestSetupHandler login `setup.ts:6-10,46-48`, `config.ts:8-13` derives URLs from `Cypress.config('baseUrl')` + `/intern/tricia/`).
- Selection is path-glob only; no tags (`@cypress/grep` absent). Spec filter contract (`calculate_e2e_specs_for_node.sh:27-73,97-103`): comma-separated globs, leading `*` added, `find -wholename`, round-robin by `i % NODES_TOTAL`; empty or `**` = all `*.spec.ts`. IAP defaults: `cypress/e2e/**/*.spec.ts` (`.e2e-cypress-env:25`), `cypress/e2e_toggle/**/*.spec.ts` (`.e2e-cypress-feature-toggle-env:29`), jira subset.
- Own CI: lint + `tsc` only (`continuous-integration.yml`); nightly `frontend-upmerge.yml` bumps FE pins.
- Branches: `master`, `release/NN.M`; features `improvement/`, `fix/`, `feature/`, `e2e/`. Branch resolution (`determine_e2e_branch.sh:10-37`): explicit input (missing → **fail**) else `release/<gradle major.minor>` else `master` (warning). Uses `./gradlew properties` → needs a gradle project; FE repos have none. "Matching branch with fallback" requires an own `git ls-remote --heads` pre-check (exact `refs/heads/<b>` match; retry; see PFM-ISSUE-34932 rules).
- FE package dependence: exact pins of `@cplace-next/cf-e2e-testing-sdk` (imported by 199 files / 75 specs; registers commands in `cypress/support/e2e.ts:13`), `cf-ai-companion-e2e`, `cf-ai-usage-e2e`, `cf-cleanup-page-e2e`, `cf-comments-widget-e2e`, `cf-data-model-types-e2e` (18 specs), `cf-system-groups-e2e` (exports full test bodies, `allRegisteredUsers.spec.ts:23-26`), plus paw-fe/pp-fe/rm-fe/workflow-fe SDKs. **A FE PR that changes these packages needs them bumped in the cloned cplace-e2e too**; otherwise base pins suffice.
- Self-provided tests hook: `CB_E2E_RUN_SELF_PROVIDED_TESTS` / `CB_E2E_SELF_PROVIDED_TESTS_PATH=e2e-tests` → `move_own_e2e_tests.sh:116-118` (`mv <path> cplace-e2e/cypress/e2e`). Broken for reuse: specs are calculated (`:116`) before the move (`:166`), and `mv` nests to `cypress/e2e/e2e-tests/`. Disabled everywhere.

### 7. FE in-repo E2E

- cplace-fe: 23 `apps/*-e2e` projects, all Storybook (ports 4400/4402/4409/4415/4432), `*.cy.ts`, `getE2EConfig()` from `@cplace-next/cf-e2e-testing-sdk/config`; only `/intern/tricia` URL is a mock (`apps/cf-ai-companion-1-e2e/src/integration/ai-sidebar.advanced-search.cy.ts:39`). Published via `@nx/js:tsc` on `src/public_api.ts` as `@cplace-next/<app>`.
- cplace-paw-fe: `cf-landing-page-lib-e2e` (4401), `cf-training-extended-lib-e2e` (4400) — Storybook only.
- **Implication**: "specs in the FE repo" needs a new folder (e.g. `e2e-tests/` with `*.spec.ts` targeting `localhost:8083/intern/tricia` and TestSetupHandler) copied into `cplace-e2e/cypress/e2e/<name>/` *before* spec calculation, run with cplace-e2e's support/reporters.

### 8. Affected-spec mapping (feasibility)

Possible only partially: nx-affected published `*-e2e`/SDK packages → grep cplace-e2e imports (+ transitive `cypress/support/**`); SDK change hits ≥75 specs. No ownership metadata linking FE apps to cplace-e2e product folders. Recommendation from analysis: ship explicit filter + full suite; "affected" later as a suggestion helper.

## Code References

- `github-actions/.github/workflows/fe-pr-snapshot.yml:21,65-89` — label gate, artifacts action, PR comment upsert
- `github-actions/tools/scripts/artifacts/utils.ts:311-319` — snapshot version strings
- `github-actions/tools/scripts/artifacts/artifacts-handler.ts:31,99-107,148-204,317-319` — PR snapshot flow, affected projects, outputs (release only)
- `github-actions/tools/scripts/artifacts/nx-project.ts:52-63,111-140,~357` — publishable rules, publish, dist-tags
- `github-actions/.github/workflows/fe-e2e.yml:19-87` — current Storybook E2E
- `github-actions/.github/actions/use-npmrc/action.yml:15,31` — npmrc handling
- `cplace-fe/.github/workflows/pull_request.yaml:109-134` — e2e job + pr-checks aggregator
- `cplace-fe/.github/workflows/devkit-test-template.yaml:88-115` — App token + cross-repo checkout precedent
- `main/cf.cplace.platform/assets/package.json:20-22` — `@cplace-next` pins in backend
- `cplace-paw/cf.cplace.*/assets/package.json:5-6` — `@cplace-paw-fe` pins
- RB `src/scripts/upmerge_and_bump_releases.sh:93-96,158-185,224-251,287-320` — npm bump recipe
- RB `src/scripts/setup_npmrc.sh:9-29` — backend registry auth
- RB `.github/workflows/build.yml:62-186` — backend build stages
- RB `.github/workflows/e2e-cypress.yml:52-108` — build + matrix
- RB `.github/workflows/reuseable-e2e-cypress.yml:68-232` — per-node E2E
- RB `src/scripts/create_and_run_cplace_docker.sh:32-87`, `create_and_run_cplace_docker_compose.sh` — docker/compose
- RB `src/scripts/wait_for_cplace_startup.sh:18-29` — readiness
- RB `src/scripts/calculate_e2e_specs_for_node.sh:27-103` — spec filter + sharding
- RB `src/scripts/run_e2e_cypress_test_suite.sh:37-41` — cypress-repeat
- RB `src/scripts/determine_e2e_branch.sh:10-37` — e2e branch resolution
- RB `src/scripts/move_own_e2e_tests.sh:116-118` — self-provided tests hook
- RB `.github/workflows/integration-e2e-orchestrator.yml:72-318` — orchestrator
- RB `src/scripts/merge_parent_repos.sh:26-78` — parent-repos merge / `source_matched`
- RB `src/scripts/integration_e2e_report.sh:13,214-216,276` — report + matched warning
- RB `src/scripts/parse_slash_command_parameters.sh:19-58` — slash params
- FB `.github/workflows/e2e-cypress.yml:46-90`, `reuseable-e2e-cypress.yml:175-181`, `create_and_run_cplace_docker.sh:12-29` — pull-image mode
- `main/docker/e2e/{Dockerfile,docker-compose.yml,startup.sh,README.md}` — E2E image
- `cplace-e2e/cypress.config.ts:7-84` — Cypress config
- `cplace-e2e/package.json:36` and `.npmrc` — FE SDK pins
- IAP `.github/workflows/{slash-commands,integration-e2e-orchestrator,e2e-cypress,e2e-cypress-feature-toggle,commit}.yml`, `.github/.build-env:128-141`, `.github/.e2e-cypress-env:25`

## Architecture Insights

- **Thin caller / fat reusable split** everywhere: consumer repos hold tiny `workflow_dispatch`/`pull_request` wrappers; logic lives in `github-actions@master` (FE) or `cplace-gh-workflows@release/2.0` (BE). A merge to those refs is live for all consumers immediately; staging uses branch-pinned test consumers (`replace_workflow_action_branch.sh`, `pin_consumer_workflows_to_branch.sh`).
- **Two CI ecosystems**: FE (github-actions; nx, npm, JFrog `cplace-npm-local`, `ubuntu-latest`, TS scripts) vs BE (cplace-gh-workflows; gradle, cplace-cli, dotenv config in `.github/.*-env` with `<<secrets.X>>`, bash scripts with BATS/shellcheck rules, Ubicloud runners). The new workflow bridges both — placing it in github-actions means calling or duplicating BE composite actions from cplace-gh-workflows.
- **Override-by-pin, not by branch**: BE composition is git-branch driven (`parent-repos.json`); FE integration is version-pin driven (`assets/package.json` + lock). The FE PR workflow is a new "pin override" axis that neither orchestrator nor staging-builds (`dependency_overrides` = repo→branch) supports.
- **Marker-comment state**: both snapshot publishing (`<!-- published-artifacts -->`) and integration E2E (`<!-- cplace:integration-e2e … -->`) persist cross-run state in PR comments/bodies.
- **GitHub App per purpose**: read-product (clone), container-build-bot (cross-repo dispatch, PR author), pr-writer (comments). FE side has its own `sva-actions-read-product-fe` App (not installed on `cplace-e2e`; a non-installed repo in `repositories:` fails the mint with 422).
- **Every action SHA-pinned** (Sonar flags unpinned third-party actions).

## Historical Context (from specs/)

- `cplace-e2e/specs/2026-11-19_e2e-tests-in-owning-repos/research.md` — closest prior work: move specs into owning repos (pilot cplace-paw + cplace-paw-fe), cplace-e2e as foundation. Explicitly names FE PR snapshot injection into a container build as the core open gap (Open Q5); lists candidate options (snapshot label, assets override before build, staging-builds npm override, Storybook-only FE). Notes no package boundary between foundation and specs (login/TSH/page objects live only in `cplace-e2e/cypress/support`).
- `main/specs/2026-09-28_PFM-ISSUE-28989_adapt-e2e-docker-setup/` — compose + ES topology, image/workflow contract, `DOCKER_ENV` handling, staging procedure, runner facts (`ubicloud-standard-4`, Compose v2.38.2); out of scope: moving docker setup out of main; deliberately does not anticipate pull mode.
- `cplace-gh-workflows/specs/2026-09-28_PFM-ISSUE-34932_e2e-branch-remote-unreachable/` — authoritative branch-resolution rules (exact ref match, retry with backoff, explicit missing → error, derived missing → warning + master, don't use `ls-remote --exit-code`); token propagation race.
- `cplace-fe/specs/2026-10-15_PFM-ISSUE-34281_github-app-cross-repo-clone/` — FE read App design, mint step config, `required-repos` gating pattern in a reusable template, SHA pinning.
- `cplace-gh-workflows/specs/2026-07-02_jfrog-snapshot-version-duplication/` — backend `RAW_VERSION` parsing pitfalls; irrelevant to npm snapshots but warns against parsing multi-line gradle output.
- `cplace-integration-all-products/specs/2026-09-02_PFM-ISSUE-34615_remove-e2e-cypress-concurrency/` — `concurrency` group `workflow+ref` silently cancelled dispatches.
- FB `specs/2026-06-25_e2e-prebuilt-image-mode/design.md` — pull-image mode design (image format, branch derivation).

## Related Research

- `cplace-e2e/specs/2026-11-19_e2e-tests-in-owning-repos/research.md`
- `main/specs/2026-09-28_PFM-ISSUE-28989_adapt-e2e-docker-setup/`
- `github-actions/specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/`
- `github-actions/specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/`

## Open Questions

1. **Snapshot availability for "every PR, required check"**: make snapshot publishing unconditional (drop label gate) and run it as a job inside `pull_request.yaml` so E2E can `needs:` it? Or `workflow_run`/poll? Expose `version` + `packages` outputs from `fe-pr-snapshot.yml`/`artifacts` action?
2. **PRs that publish nothing** (no affected app consumed by backend, e.g. docs/storybook-only): skip E2E (pass) or run against base pins?
3. **Home of the workflow**: standalone in github-actions (calling BE composite actions cross-repo via `uses: collaborationFactory/cplace-gh-workflows/.github/actions/...@release/2.0`) vs. new FE mode in the cplace-gh-workflows orchestrator (`npm_overrides` input + IAP test branch). Secrets (`ENV_CPLACE_ARTIFACTORY_*`, read App installed on backend + cplace-e2e, Ubicloud) must be available to FE repos for the standalone option.
4. **Prebuilt-image mode**: no consumable prebuilt E2E image today; FB pull mode is single-container and lacks ES. Options: (a) reconcile pull mode with compose and have staging-builds publish `e2e/<X.Y>/cplace:head` nightly; then overlay FE assets into the running image (requires knowing where plugin assets live inside `software.zip` and whether the overlay needs `cplace-asc` compile — unverified); (b) build-from-source only, but build once and share `software.zip` across nodes.
5. **Overlay feasibility**: can FE bundles be swapped inside an already-built `software.zip`/image without re-running gradle/cplace-asc (are `node_modules/@cplace-next/*` copied verbatim into the plugin's static resources)? Needs a spike.
6. **Backend branch selection**: same-named backend branch (paired BE+FE change) else mapped base (`main|master` → `master`, `release/X.Y` → same, `-beta` → ?). Is a feature-branch backend acceptable given the X.Y.999 rewrite breakage seen on IAP#536?
7. **cplace-e2e pins**: bump `@cplace-next/*-e2e` and `cf-e2e-testing-sdk` in the cloned cplace-e2e when the PR published them? Cypress major mismatch (13 vs 15) for any in-repo specs.
8. **In-repo spec folder convention**: name/location (`e2e-tests/`?), copy target in cplace-e2e, fix of `move_own_e2e_tests.sh` ordering and `mv` nesting — or a separate copy step in the new workflow.
9. **Default spec scope and cost budget** for every PR: node count, toggle suite on/off, Jira excluded, `timeout-minutes`, `concurrency` per PR with cancel-in-progress, runner labels available to FE repos (Ubicloud vars).
10. **Multi-backend reach**: cplace-fe packages are built into cplace only; do cplace-fe PRs ever need paw-level specs (cplace-paw build pulls `../main` assets — would need bumping parent assets)?
11. **Reporting**: JUnit check + PR comment (reuse marker/minimize pattern) — which App posts comments from FE repos (`SVA_ACTIONS_WRITE_PRODUCT_FE`)?
12. **Unverified items**: whether cplace-gradle-plugin uses `npm ci` vs `npm install` for assets; whether JFrog virtual `cplace-npm` serves `cplace-npm-local` PR snapshots immediately; master vs release/2.0 script drift; `integration-e2e-reporter` internals.
