---
date: 2026-10-12T15:38:13+02:00
git_commit: faa477146b7039659f88a128b9b364f64b1eddae
branch: master
topic: "Consolidate the FE 2.0 release flow (fe-tag + fe-release) into a single workflow"
tags: [research, github-actions, fe-release, fe-tag, artifacts, versioning, jfrog, github-release, immutable-releases, fe-repos]
status: complete
last_updated: 2026-10-13
last_updated_note: "Recorded decisions on open questions (Q2 single reusable workflow, Q4 re-run publishes next version, rollout release/25.4+); earlier: force input follow-up, corrected tag-triggered workflow reasoning"
---

# Research: Consolidate the FE 2.0 release flow into a single workflow

**Date**: 2026-10-12T15:38:13+02:00
**Git Commit**: faa477146b7039659f88a128b9b364f64b1eddae (collaborationFactory/github-actions)
**Branch**: master

## Research Question
PFM-ISSUE-34283: how does the FE 2.0 release flow work today across `collaborationFactory/github-actions` (the reusable FE workflows/actions) and all FE repos that consume it, and what needs to change to turn it into a single, deadlock-free workflow (build + test → push version tag → publish to JFrog → finalize immutable GitHub release)?

## PFM Ticket Context
- **Ticket**: [PFM-ISSUE-34283](https://base.cplace.io/pages/3oujt03zx1awhafambsry1q90/PFM-ISSUE-34283-Consolidate-the-FE-2.0-release-flow-into-a-single-workflow)
- **Title**: Consolidate the FE 2.0 release flow into a single workflow
- **Type**: PFM-ISSUE (30.groundwork), priority 30.medium, topic GitHub, squad 01 - Build & Connect / Stratum
- **Status**: 50.working (started 2026-10-12)
- **Target Release**: not set (planned date 2026-07-27)
- **Assignee**: Vladimir Arsov
- **Epic**: [EPIC-1963 Modernize FE 2.0 Frontend Workflow Authentication](https://base.cplace.io/pages/bzqjct9gt505sq7dm2hgu11m0/EPIC-1963-Modernize-FE-2.0-Frontend-Workflow-Authentication)
- **Relations**: relates to [PFM-ISSUE-33676](https://base.cplace.io/pages/w64364g0a1qsl6z6vb11ngevs/PFM-ISSUE-33676-Replace-shared-GitHub-user-account-in-frontend-workflows); blocks PFM-ISSUE-34282 (GITHUB_TOKEN for in-repo tag and release), PFM-ISSUE-34284 (enable GitHub release immutability on FE 2.0 repos), PFM-ISSUE-34286 (retire shared GitHub user), PFM-ISSUE-34287 (pilot on cplace-remote-filesystem-fe)
- **Suggested Branch**: `improvement/PFM-ISSUE-34283-Consolidate-the-FE-2-0-release-flow-into-a`
- **Description**:

  > **Description** — Restructure the FE 2.0 release into a **single workflow** with a deadlock-free order. This can be done **first**, under the current authentication setup, ahead of the `GITHUB_TOKEN` switch.
  >
  > **Requirements**
  > - One workflow, triggered by a push event and/or a manual `workflow_dispatch` with a user-selectable input (e.g. release type); **manual tag creation is disabled**.
  > - Order within the run: **build + test → push the version tag → publish artifacts to JFrog → finalize the (immutable) GitHub release**.
  > - Keep tag-before-publish: the version is derived from the last git tag, so a failed tag step retries with the **same** version and a failed publish advances the next run to the **next** version — avoiding publish collisions.
  > - Finalize the immutable GitHub release only **after** a successful publish, so a failed publish leaves at most a skippable dangling tag.
  >
  > **Acceptance Criteria**
  > - The release runs as a single workflow with the specified ordering.
  > - Manual tag creation no longer triggers a release.
  > - Retries are deadlock-free; a failed publish never leaves an immutable release without an artifact.
  >
  > **Dependencies** — Can land first (works with the current authentication setup); precedes the `GITHUB_TOKEN` switch. Relates to PFM-ISSUE-33676.

### Epic / related ticket context (summarised)
- **EPIC-1963** modernises FE 2.0 workflow auth: (a) JFrog npm read/publish via separate secrets instead of a stored `.npmrc` (`DOT_NPMRC`), (b) replace the shared GitHub user (`GIT_USER*`, actor `squad-fe`) used for tag creation, PR decoration and cross-repo checkout with `GITHUB_TOKEN`/GitHub App. Out of scope for the epic: broader workflow restructuring — 34283 is the one sanctioned restructuring, as a prerequisite.
- **PFM-ISSUE-33676** maps each shared-user usage to `GITHUB_TOKEN` (likely tag creation, PR decoration) or a GitHub App (cross-repo e2e checkout).
- Epic attachment `PRD-FE2.0-Build-Integration.md` could not be read via MCP (no content returned).

## Summary
- **Today the release is two chained workflow runs in every FE repo.**
  1. A caller workflow on `push: branches: ['release/*']` runs `fe-install-deps` → (`fe-build` ∥ `fe-e2e`) → `fe-tag`. `fe-tag` computes the next `version/X.Y.Z` and pushes a lightweight tag using the PAT `GIT_USER_TOKEN` (actor `squad-fe`).
  2. That tag push triggers a second caller workflow on `push: tags: ['*/*']`, which calls the reusable `fe-release.yml` with `TAG=github.ref_name` to build all publishable projects and `npm publish` them to JFrog.
  - The PAT is required *only* because a tag pushed with `GITHUB_TOKEN` does not trigger other workflows. An earlier attempt to drop the token (d6542fe, 2023-11-03) was reverted three days later (a416ad2).
- **The two runs are not ordered or guarded together.**
  - Any `*/*` tag (manual, UI-created release, stray tags) starts a full publish.
  - A failed publish leaves a tag with no or partial artifacts.
  - On a re-run, a partial publish fails on the first already-published package (E403 "cannot publish over previously published versions"). This was observed live, e.g. `version/26.4.1` and `version/26.3.1` on branch-off day, and `version/26.1.55`.
- **No GitHub Release is created anywhere.**
  - There is no `gh release`/octokit code, and immutable releases are disabled (`cplace-fe`: `{"enabled":false}`).
  - No tag rulesets protect `version/*`.
  - Five repos have hand-made GitHub releases whose tag creation also triggered publishes.
  - The "finalize immutable release" step is entirely new.
- **Version derivation already matches the ticket's tag-before-publish model.**
  - The next version is computed from remote tags (`git ls-remote --tags`): the highest `version/<maj>.<min>.*` for the `release/<maj>.<min>` branch, + 1 patch, or `X.Y.1` if none exists.
  - So a failed tag step recomputes the same version, and a pushed-but-unpublished tag makes the next run use the next patch.
  - There is no notion of release type: major/minor come from the branch name, and only the patch increments.
- **The consolidation's main technical gaps are:**
  - Passing the computed version between jobs. In one run `github.ref_name` is the branch, not the tag, and the artifacts tool writes no `$GITHUB_OUTPUT`.
  - Handling "no new version needed" (no tag → nothing downstream).
  - Making publish safe to re-run.
  - Adding a non-cancelling concurrency group.
  - Creating and finalizing the GitHub release.
  - Avoiding a double publish on each branch that gets migrated. A tag push runs the `on: push: tags` workflows found in the tagged commit. When a branch moves to the new workflow, its migration commit must therefore replace both old files (branch-push and tag-push). If the old tag workflow stays in that tree, the new workflow's PAT tag push would still fire it and publish twice. Branches that are not migrated keep the old two-run flow unchanged and need no edits.
  - Enforcing "manual tag creation no longer triggers a release". Removing workflow files can't fully do this, because a manually created tag on an older commit still finds the old workflow there. A `version/*` tag ruleset that restricts creation to the release actor enforces it on every branch. No tag rulesets exist today.
- **The rollout is broad.**
  - 23 caller repos have several file-name variants.
  - Every live `release/YY.N` branch in both `github-actions` and the consumers pins `@release/YY.N`. cf-devkit branch-off rewrites `@master` → `@release/X.Y`.

## Detailed Findings

### 1. Reusable workflows in github-actions involved in the release
- **`.github/workflows/fe-tag.yml`** (workflow_call)
  - Inputs: `GHA_REF`, `GHA_BASE`.
  - Required secrets: `JFROG_BASE64_TOKEN`, `JFROG_URL`, `JFROG_USER`, `GIT_USER_TOKEN`, `GIT_USER_EMAIL`, `GIT_USER` (lines 12-24).
  - Job `tag`:
    - Checkout with `token: secrets.GIT_USER_TOKEN`, `fetch-depth: 0` (30-34). The persisted PAT is what authenticates the later `git push`.
    - setup-node 24.20.0, plus the node_modules cache only. There is no `npm ci` and no `use-npmrc`.
    - `git config user.name/email` from `GIT_USER`/`GIT_USER_EMAIL` (45-48).
    - `artifacts@master` with `ONLY_BUMP_VERSION: true`, `BASE: inputs.GHA_BASE`, `DEFAULT_BRANCH` (50-58).
- **`.github/workflows/fe-release.yml`** (workflow_call, no inputs)
  - Secrets: JFrog ×3 and `DOT_NPMRC`.
  - Workflow env: `NX_BRANCH`, `NX_RUN_GROUP` (15-17).
  - Job `release-version`:
    - Checkout `ref: ''`, which resolves to the tag in a tag-push context (23-26).
    - setup-node, cache, `use-npmrc@master`, then `npm ci || yarn` on a cache miss (43-46).
    - `artifacts@master` with `TAG: ${{ github.ref_name }}` (48-54).
- **Build/test building blocks**, usable from push or dispatch contexts:
  - `fe-install-deps.yml`: input `GHA_REF`, secret `DOT_NPMRC`.
    - Job-level `concurrency: fe-install-deps-${{github.ref}}`, `cancel-in-progress: true` (16-18). This would cancel an in-flight release on the same branch.
  - `fe-build.yml`: `GHA_REF`, `GHA_BASE`; matrix build/storybook × 2 shards via `run-many`.
  - `fe-e2e.yml`: `GHA_REF`, `GHA_BASE`, optional `PERCY_TOKEN`; Cypress container, 4 shards.
- **Not reusable for a push/dispatch release as-is:**
  - `fe-code-quality.yml` and `fe-licenses.yml` read `github.event.pull_request.*` and are PR-bound.
  - `fe-sonar.yml` is push-capable but not sharded.
- **Outputs and permissions:** no reusable workflow declares `on.workflow_call.outputs`. The only job output is `check-sonar.outputs.has_token` in `fe-code-quality.yml:95-96`. No reusable workflow sets `permissions:` except `fe-sonar.yml:36-37` (read) and `pr-checks.yml:16-17`.
- **Concurrency:** none on tag, release or publish.

### 2. Caller templates in github-actions
- `.github/workflow-templates/fe/fe-release.yml` (branch-triggered) runs install-deps → e2e-tests ∥ build → `tag` (`needs: [build, e2e-tests]`, lines 41-53).
  - It passes `GHA_REF: ''`, `GHA_BASE: ${{ github.event.before }}` and the `GIT_USER*` secrets.
  - Name clash: this template's `fe-release.yml` is the tagging workflow, while the reusable `workflows/fe-release.yml` is the publishing workflow.
- `.github/workflow-templates/fe/fe-tag-pushed.yml` triggers on `push: tags: ['*/*']` (3-5) and calls `fe-release.yml`.
- Templates declare `permissions: contents: write, pull-requests: write, actions: read, checks: write` (e.g. `fe-tag-pushed.yml:7-11`).
- Templates are only copied into repos manually, so editing them doesn't update existing callers.
- `README.md` documents only "Node 24 Compatibility". There is no doc of the release flow, wiring or secrets.

### 3. The `artifacts` action and versioning logic (`tools/scripts/artifacts/`)
- `.github/actions/artifacts/action.yml:6-10` runs `printenv`, then `npm ci` (in the actions repo), then `ts-node tools/scripts/artifacts/main.ts`. `main.ts:3` is `new ArtifactsHandler().handle()` with no catch.
- **Mode selection** (`artifacts-handler.ts:38-98`)
  - **Env vars read:**
    - JSON-parsed: `ONLY_BUMP_VERSION`, `ONLY_DELETE_ARTIFACTS`, `SNAPSHOT`.
    - Plain: `TAG`, `PR_NUMBER`, `BASE` (`origin/` prefixed; all-zero SHA → `origin/<DEFAULT_BRANCH>`, lines 54-62), `DEFAULT_BRANCH`.
    - Runner context: `GITHUB_EVENT_NAME`, `GITHUB_HEAD_REF`, `GITHUB_REF_NAME` (`utils.ts:269-284`).
  - **TAG mode** (65-70): `TAG` starts with `version/`. Sets `onlyAffected=false` and `task=RELEASE`; the version is parsed from the tag.
  - **Release-branch mode** (72-78): the branch starts with `release/`. Sets `currentVersion = release/X.Y → X.Y.0` and `task=RELEASE`; `onlyAffected` stays true.
  - **Fallback:** snapshot or PR modes.
- **`handle()`** (100-127)
  - Branch-off guard: the tip commit subject starts with `[branch-off]` → return. It skips tag and publish (`utils.ts:247-255`; added f74ee0a / #180, PFM-ISSUE-34805).
  - `ONLY_BUMP_VERSION && branch startsWith 'release/'` → `bumpVersionForReleaseBranch()`.
  - Otherwise `initProjects()` + `buildAndPublishProjects()`.
  - Gotcha: `ONLY_BUMP_VERSION=true` on a non-release branch silently falls through to publishing.
- **Version derivation**
  - `Utils.getAllVersionTagsInAscendingOrder` (`utils.ts:210-230`) runs `git ls-remote --tags`, keeps `version/` tags and sorts them by major/minor/patch. It reads the remote, not local tags.
  - `getLatestTagForReleaseBranch` (`utils.ts:175-193`) returns the highest tag with the same major.minor.
  - `calculateNewVersion` (`utils.ts:195-208`) returns `X.Y.1` if there is no tag, otherwise latest patch + 1.
  - Pre-release suffixes are dropped on parse.
  - `VERSION_BUMP.MINOR` exists (`version.ts:23-25`) but is never used. No release-type concept exists.
- **Tag creation** (`artifacts-handler.ts:187-207`)
  - It is created only if `affectedProjects.length > 0 || patch === 1`. Otherwise it logs "no new Minor/Patch version is needed" and creates no tag.
  - The commands are `git tag version/X.Y.Z` (lightweight, HEAD) and `git push origin <tag>` via `execSync`. A failure throws.
  - There is no existing-tag check, no retry and no lock.
  - Re-running after a successful push computes the *next* patch, so it is not idempotent.
  - Two concurrent runs can compute the same tag; the loser's push fails.
- **Publish** (`buildAndPublishProjects`, 129-154; `nx-project.ts`)
  - RELEASE publishes *all* projects (`Utils.getAllNxProjects`, `utils.ts:87-120`). Libs are published only if `publishable: true` (`nx-project.ts:49-57`); apps always (58-60).
  - Steps per project:
    1. `nx build --prod`.
    2. Write `dist/.../.npmrc` (`_auth` etc.; the token content is logged).
    3. Set the version in the dist `package.json` with `publishConfig.tag = release-X.Y`.
    4. `npm publish`.
  - There is no pre-check for an existing version on RELEASE. `deleteArtifact` (unpublish) is used only for PR snapshots (148-149).
  - `publish()` (108-126) calls `process.exit(1)` on effectively any error.
  - **Consequence:** a partial publish can't be resumed. A re-run hits a 403 on the first already-published package.
- **Outputs:** the computed version and the "tag created?" flag are only `console.log`ged. Nothing is written to `$GITHUB_OUTPUT`.
- **Tests (jest):**
  - `artifacts-handler-tag.test.ts` covers the bump on `release/5.18` → `version/5.18.121`, the first push → `.1`, and TAG mode → `onlyAffected=false`.
  - `artifacts-handler-branch-off.test.ts` covers the branch-off guard.
  - `utils.test.ts` covers tag ordering and the bump calculation.
  - `nx-project.test.ts` covers publishability and `deleteArtifact`.
  - Gaps: the exact `git tag`/`git push` commands, `publish()`, `build()`, and existing-tag or retry cases are not asserted.

### 4. Caller side across all FE repos (23 callers)
- **Universal pattern, default branch:**
  - A release-branch workflow (`push: branches: ['release/*']`) runs install-deps → build ∥ e2e-tests → `tag` (fe-tag).
  - A tag workflow (`push: tags: ['*/*']`) runs `release-version` (fe-release).
  - No `workflow_dispatch`, `workflow_run` or `concurrency` on any release/tag workflow. No caller creates GitHub releases.
- **Callers:**
  - 20 `*-fe` repos.
  - `cplace-legacy-fe-assets`.
  - `cplace-frontend-applications`, `cplace-frontend-consumer`, `cplace-frontend-documentation-test`.
  - `cplace-board-fe` has no workflows.
- **File-name variants:**
  - Template names `fe-release.yml` / `fe-tag-pushed.yml` (most repos).
  - `push_to_release.yaml` / `on_tag_pushed.yaml` (cplace-fe, legacy-fe-assets, frontend-applications).
  - `push_release.yml` / `tag_pushed.yml` (office-reports-fe, workflow-fe).
  - `release.yml` / `tag_pushed.yml` (loomeo-fe).
- **`squad-fe` guard:** `if: github.event.pusher.name != 'squad-fe'` on the tag job in cplace-fe (`push_to_release.yaml:43`), cplace-frontend-applications (`:36`) and cplace-legacy-fe-assets (`:29`). It prevents bot pushes (upmerge/version commits) from releasing.
- **No e2e before tag:** cplace-legacy-fe-assets, cplace-loomeo-fe, cplace-dataciders-portfolio-management-fe (`needs: build` only).
- **Broken or non-standard callers:**
  - **cplace-bayer-prompt-fe** calls a non-existent `fe-release.template.yml@release/25.4`. It uses `v1.80.x` / `release/sprint/NN` tags and person-named release branches.
  - **cplace-frontend-consumer** has a fe-tag job named `snapshot` that `needs` non-existent jobs.
- **Permissions:**
  - Most repos: `write-all`.
  - Granular: cplace-fe, cplace-paw-fe.
  - None: frontend-applications, frontend-consumer, frontend-documentation-test (dormant, last tags 23.1).
- **cplace-fe** excludes `!release/*-beta` in both filters. On the tag filter this has no effect.
- **Version lines:**
  - Typical: `release/YY.N` → `version/YY.N.P`.
  - Outliers:
    - cplace-qgate-fe: `release/3.20`, `release/3.20.1`, `release/25.1-3.18`.
    - cplace-dortmund-mps-fe: three-part branches like `release/26.10.2`, mixed zero padding.
    - cplace-pag-rm-fe: `release/25.2.1`.
- **Stray `*/*` tags that trigger publishes today:** `demo/26.1-enabled-export` (dataciders), `release/sprint/NN` (bayer), and UI-created releases `version/25.4`, `version/26.1` (office-reports, workflow-fe), which would run `fe-release` with a two-part version.
- **Hand-made GitHub releases** (not immutable):
  - bayer-prompt (43), dortmund-mps (15), office-reports (6), workflow-fe (8), pag-rm (6).
  - dataciders: 1 prerelease. project-planning: 1 draft.
  - Others: 0.

### 5. Ref pinning and rollout mechanics
- On default branches, callers and github-actions internals reference `@master`. On every release branch, both github-actions and consumer repos reference `@release/YY.N`. Verified examples:
  - `github-actions` `origin/release/26.3` and `origin/release/26.4` use `artifacts@release/26.x` and `fe-tag.yml@release/26.x`.
  - `cplace-fe` `origin/release/26.3` `push_to_release.yaml` / `on_tag_pushed.yaml` use `fe-tag.yml@release/26.3` and `fe-release.yml@release/26.3`.
- cf-devkit branch-off creates `release/X.Y`, rewrites workflow refs `@master` → `@release/X.Y`, publishes `X.Y.0` locally, then reverts refs on the default branch. The commit is marked `[branch-off]` (cplace-fe `specs/2026-06-15_branch-off-two-run-split/research.md:50-59,86,92`).
- github-actions release branches are upmerged in a chain (`release/25.2 → … → 26.4 → master`). Each change is applied per branch with per-branch composite refs (`specs/2026-06-05_node24-workflow-migration/design.md:21,53`).
- Some repos pin non-matching refs: 2lforge-scores-fe `release/26.1` (plus `fe-main` on a `fix/…` branch), toolbar-fe `release/26.3`, bayer, dortmund and pag-rm `release/25.4`, qgate `release/25.2`, loomeo `release/26.2`, resource-management `release/26.2`.
- A tag-push workflow runs the YAML at the tagged commit. A push to `release/*` runs that branch's YAML. So the consolidation takes effect per release branch. An unmigrated branch keeps working with the old two-run flow. On a migrated branch, the old tag-push workflow must be gone from the same tree, or the new workflow's PAT tag push triggers it.

### 6. Runtime evidence (cplace-fe Actions)
- **Release cycle:**
  - Branch push run 37911177252 (2026-10-09 09:25), then tag run 37917734582 at 10:27 for `version/26.1.67` (publish 10:28-10:54). The cycle takes about 1 h, mostly e2e.
  - All tag runs have actor `squad-fe`.
- **Stage-1 failures:** mostly flaky e2e, which blocks the tag. For example 37334564468 (`release/25.4`) needed 6 attempts. Others: 37008207766, 37001985003, 36987129383, 36883349635.
- **Stage-2 failures**, all in "Build and Push to Jfrog NPM Registry":
  - 35917324069 `version/26.4.1` and 28507554262 `version/26.3.1`: "You cannot publish over the previously published versions". These collided with the branch-off local publish on branch-off day.
  - 30539012683 `version/26.1.55` (re-run): E403 on `@cplace-next/cf-frontend-customization`.
  - 29495780323 `version/26.1.50`, and 28936356996 `version/26.3.2` (3 attempts).
- **2026-06-08 incident** (`specs/2026-06-05_node24-workflow-migration/validation-log.md:33-41`): test commits pushed to `release/25.2` ran the release pipeline. The "no new Minor/Patch version is needed" guard prevented a tag. Rule adopted: never test on `release/*`; use `test/*` branches and `cplace-remote-filesystem-fe`.
- **GitHub state for cplace-fe:**
  - Releases: none.
  - Immutable releases: `{"enabled":false,"enforced_by_owner":false}`.
  - Rulesets: four, all targeting branches (`prevent-release-deletion`, `prevent-release-version-creation`, `product-fe`, `experimental bypass sva-actions-upmerge`). No tag ruleset.

## Code References
- `.github/workflows/fe-tag.yml:12-24` – required secrets incl. `GIT_USER_TOKEN`, `GIT_USER`, `GIT_USER_EMAIL`
- `.github/workflows/fe-tag.yml:30-34` – checkout with the PAT (the tag push credential)
- `.github/workflows/fe-tag.yml:45-48` – git identity from secrets
- `.github/workflows/fe-tag.yml:50-58` – artifacts action, `ONLY_BUMP_VERSION: true`
- `.github/workflows/fe-release.yml:15-17` – `NX_BRANCH` / `NX_RUN_GROUP` env
- `.github/workflows/fe-release.yml:23-26` – checkout `ref: ''` (the tag)
- `.github/workflows/fe-release.yml:48-54` – artifacts action, `TAG: ${{ github.ref_name }}`
- `.github/workflows/fe-install-deps.yml:16-18` – cancelling concurrency keyed on `github.ref`
- `.github/workflows/fe-code-quality.yml:92-112` – only existing job-output + `needs` pattern
- `.github/workflow-templates/fe/fe-release.yml:18-53` – caller-side build → e2e → tag sequence
- `.github/workflow-templates/fe/fe-tag-pushed.yml:3-15` – `tags: ['*/*']` trigger, calls fe-release
- `.github/actions/artifacts/action.yml:6-10` – printenv / npm ci / ts-node main
- `tools/scripts/artifacts/artifacts-handler.ts:21` – `VERSION_PREFIX = 'version/'`
- `tools/scripts/artifacts/artifacts-handler.ts:38-98` – env-driven mode selection
- `tools/scripts/artifacts/artifacts-handler.ts:100-127` – `handle()`: branch-off guard, bump vs publish
- `tools/scripts/artifacts/artifacts-handler.ts:129-154` – build and publish loop
- `tools/scripts/artifacts/artifacts-handler.ts:187-207` – `bumpVersionForReleaseBranch()`: guard, `git tag`, `git push`
- `tools/scripts/artifacts/utils.ts:175-230` – latest tag per release line, new-version calculation, `ls-remote` tag listing
- `tools/scripts/artifacts/utils.ts:247-255` – `isBranchOffCommit()`
- `tools/scripts/artifacts/version.ts:10-56` – Version parsing, `getGitTag()`, `getNpmTag()` (`release-X.Y`)
- `tools/scripts/artifacts/nx-project.ts:49-60,108-139,183-215` – publishability, `publish()` exit-on-error, build flags, `packageExists`
- `tools/scripts/artifacts/artifacts-handler-tag.test.ts:25-101` – tag/bump tests
- `cplace-fe/.github/workflows/push_to_release.yaml:6,43-44` – branch filter incl. `!release/*-beta`, `squad-fe` guard, fe-tag call
- `cplace-fe/.github/workflows/on_tag_pushed.yaml:6,20` – tag trigger, fe-release call

## Architecture Insights
- **What the PAT is actually for.** The two-workflow split exists because a tag pushed with `GITHUB_TOKEN` doesn't trigger workflows. A single workflow removes that coupling, which is why 34283 must land before the `GITHUB_TOKEN` switch (34282). Under the current PAT, the new workflow's own tag push still triggers `on: push: tags` workflows present in the tagged commit's tree. Migrating a branch therefore means replacing the old pair of caller workflows with the new one in a single change. That replacement is part of the migration, not a separate clean-up, and unmigrated branches are left alone.
- **Disabling manual tag releases is a repository setting, not only a workflow change.** A tag ruleset on `version/*` that restricts creation, with a bypass for the release actor (`squad-fe` today, the Actions token after PFM-ISSUE-34282), enforces "manual tag creation no longer triggers a release" regardless of which workflow files exist on a commit. It would also let an intentional tag-triggered recovery path remain, if one is wanted. Pushing the tag with `GITHUB_TOKEN` would avoid the trigger entirely, but that overlaps with PFM-ISSUE-34282 and the ticket's "current auth" constraint.
- **Version derivation is stateless and remote-based** (`ls-remote`), which matches the ticket's retry semantics:
  - A failed tag push → the next run recomputes the same version.
  - A pushed tag whose publish failed → the next run uses the next patch, leaving a dangling tag.
  - The consolidated workflow must therefore carry the *computed* version from the tag job to the publish and release jobs as an output. It can't be recomputed, and can't use `github.ref_name`.
  - GitHub's "Re-run failed jobs" keeps outputs of successful jobs, so re-running only the publish job keeps the same version. But today's publish code can't resume a partial publish.
- **The artifacts tool is a mode-switching monolith driven by env vars.** Adding a "tag and emit version" mode or a `$GITHUB_OUTPUT` write is the natural extension point. TAG mode already supports publishing a given `version/X.Y.Z` independent of `github.ref`.
- **The "no new version needed" guard is a deliberate safety net.** It held during the 2026-06-08 incident. Downstream jobs in the single workflow must be conditional on "tag created".
- **Two guards skip releasing:** the `[branch-off]` commit guard (tool-side) and the `squad-fe` pusher guard (caller-side, 3 repos). Both need equivalents.
- **Composition patterns available:** caller-level `needs:` chains (templates), the aggregate `pr-checks` job pattern (`fe-pr.yml:25-50`), and job outputs (`fe-code-quality`). Nothing yet exposes `on.workflow_call.outputs`.
- **Every change is replicated per release branch** (github-actions upmerge chain plus branch-off ref rewriting), and callers vary by file name. A new opt-in reusable workflow, rather than changing `fe-tag.yml`/`fe-release.yml` in place, would avoid breaking callers that still use the old contract during the rollout. That is an inference to evaluate in design.
- **Immutable releases** lock a release's tag and assets once published. The ticket's "finalize after publish" maps naturally to draft → (publish succeeded) → publish release. Enabling immutability per repo is PFM-ISSUE-34284. Existing hand-made releases in five repos and stray `*/*` tags must be considered.

## Historical Context (from specs/)
- `github-actions/specs/2026-06-05_node24-workflow-migration/` (research, design, plan, sha-pins, validation-log):
  - Covers the rollout across the release-branch upmerge chain and the per-branch composite refs.
  - Replaced `dawidd6/action-get-tag` with `github.ref_name` in fe-release.
  - Sets the SHA-pin baseline: checkout v6.0.3, setup-node v6.4.0, cache v5.0.5, upload-artifact v7.0.1, download-artifact v8.0.1, github-script v9.0.0.
  - The validation approach used `cplace-remote-filesystem-fe` plus a test branch. **fe-release was never validated live** (`validation-log.md:71`).
- `cplace-fe/specs/2026-06-06_branch-off-publish-artifacts-dummy-change/`: the `publishArtifacts` touch forces libs into `nx affected` so release-branch pushes republish. It explains why branch-off pushes would trigger tag and publish.
- `cplace-fe/specs/2026-06-15_branch-off-two-run-split/`: branch-off phases, the local release publish of `X.Y.0` in MasterSync, and `@master` ↔ `@release/X.Y` rewriting. This is the source of the branch-off-day `.1` collisions.
- `cplace-fe/specs/2026-06-11_branch-off-publishartifacts-apps-support/`, `2026-06-11_branch-off-publishartifacts-package-json/`, `2026-06-12_branch-off-local-publish/`: related branch-off publish mechanics (not analysed in depth).
- `cplace-fe/specs/2026-09-09_PFM-TASK-8335_node-24-upgrade/`: lists the reusable workflows consumed by cplace-fe.
- `cplace-project-planning-fe/specs/2026-07-24_cf-gantt-core-publishable-necessity/research.md:63,102`: tag-triggered release pipeline per repo, and "publish all publishable" semantics.
- `cplace-project-planning-fe/specs/2026-02-26_application-test-infrastructure/research.md:450`: lists the `GIT_USER*` secrets.

No spec yet covers PFM-ISSUE-33676, PFM-ISSUE-34283, the GITHUB_TOKEN switch, or immutable releases.

## Related Research
- `specs/2026-06-05_node24-workflow-migration/research.md` (this repo)
- `cplace-fe/specs/2026-06-15_branch-off-two-run-split/research.md`
- `cplace-fe/specs/2026-06-06_branch-off-publish-artifacts-dummy-change/research.md`

## Open Questions
Status as of 2026-10-13. Decisions are detailed in "Follow-up 2026-10-13 — Decisions on open questions".

1. **Trigger semantics.** *Decided:* the push trigger stays `push: branches: ['release/*']`. `workflow_dispatch` gets a **force** input (see the 2026-10-12 follow-up).
2. **Shape of the solution.** *Decided:* one reusable workflow contains all jobs (variant A1). Each caller calls just that one reusable workflow.
3. **Version hand-off.** *Decided:* the version is written as a step/job output.
4. **Publish re-run safety.** *Decided:* no skip-if-exists. A re-run calculates and publishes the next version. A broken version stays broken, and its artifacts stay partly published.
5. **Dangling tags.** *Decided:* nothing is done; the tag remains.
6. **GitHub release finalization.** *Decided:* the release is created only after a successful publish, with GitHub's auto-generated title and notes, using `GITHUB_TOKEN`. No special handling for repos with existing hand-made releases.
7. **Concurrency.** *Decided:* use a non-cancelling concurrency group per branch for the whole release run.
8. **Guards.** *Decided:* keep the "no new version needed", `[branch-off]` and `squad-fe` guards for now.
9. **Branch-off day collision.** *Deferred.*
10. **Manual tag protection** (tag ruleset, recovery path). *Deferred.*
11. **Rollout scope.** *Decided:* all FE repos on `release/25.4` and later (25.4, 26.1, 26.2, 26.3, 26.4) plus the default branch. Older release branches are not supported. Repos without e2e are handled by a workflow input (see Q2 in the 2026-10-13 follow-up).
12. **Live validation.** *Decided:* a live test setup will be prepared.
13. **Epic PRD.** *Deferred.*
14. **Force input details.** *Deferred.*

## Follow-up Research 2026-10-12T17:13 — Force input for manual releases

### Proposed direction (from discussion)
The `workflow_dispatch` input from the ticket becomes a **force** flag. It is allowed only on the default branch and on `release/*` branches.
- **On `release/*`:** force skips the "no new Minor/Patch version is needed" check. The run then tags, publishes and finalizes the release even when no project is affected.
- **On the default branch (`master`/`main`):** force publishes a snapshot as usual. No git tag or GitHub release is created.

This gives people a supported alternative to creating tags by hand, which complements a `version/*` tag ruleset.

### Release branches
- The only thing blocking a tag today is the condition `projects.length > 0 || calculatedNewVersion.patch === 1` (`tools/scripts/artifacts/artifacts-handler.ts:193`). A force flag only needs to bypass it.
- Version derivation is unchanged: latest remote `version/X.Y.*` + 1 patch. The ticket's retry semantics therefore still hold.
- The publish step already publishes all publishable projects in TAG mode (`onlyAffected = false`, `artifacts-handler.ts:65-70`). A forced release with nothing affected still produces a complete set of packages.
- `[branch-off]` guard (`artifacts-handler.ts:109-114`): force should probably not override it, because it prevents re-releasing what branch-off already published.

### Default branch: snapshot behaviour today
- **Version.** Main snapshots are versioned `0.0.0-SNAPSHOT-<base36 ms timestamp>-<yyyymmdd>` (`Utils.getUniqueSnapshotIdentifier` / `getHashedTimestamp`, `tools/scripts/artifacts/utils.ts:296-315`; set in `artifacts-handler.ts:80-86`). Every run gets a new, unique version, so no existing version is ever overwritten.
- **npm dist-tag.** Main snapshots are published under the dist-tag `snapshot` (`nx-project.ts:356`). A newer snapshot "overrides" the previous one by moving that dist-tag. Consumers installing `@scope/pkg@snapshot` get the latest.
- **Delete-then-publish is PR-only.** `deleteArtifact` is called before publishing only for `TASK.PR_SNAPSHOT` (`artifacts-handler.ts:148-149`), whose version is deterministic (`0.0.0-<branch>-<pr>`, `utils.ts:300-304`). The JFrog existence check (`packageExists`, `nx-project.ts:183-215`, #178 / 5bcad87) runs as part of that.
- **Cleanup.** Old main snapshots are removed separately by `fe-cleanup-snapshots.yml` via `NxProject.deleteSnapshots` (`nx-project.ts:161-171`).
- **Republishing the same snapshot version is not recommended.** Unpublishing and republishing a version with different content breaks consumers whose lockfiles pinned the old integrity hash (`EINTEGRITY`). The default-branch `snapshot` is consumed widely, so a forced run should keep the existing "new version per run" behaviour.

### Gap: affected calculation on a manual run
- **Main snapshots are affected-only.** `onlyAffected` defaults to `true` (`artifacts-handler.ts:28`). Only TAG mode sets it to `false`.
- **The base comes from the push event.** The affected base is `BASE = github.event.before` (callers pass `GHA_BASE: ${{ github.event.before }}`). On `workflow_dispatch` there is no `before`, so `BASE` arrives empty.
- **An empty base is invalid.** The constructor turns it into `origin/` (`artifacts-handler.ts:52-56`), which is invalid. The all-zero-SHA fallback to `origin/<DEFAULT_BRANCH>` (57-61) does not catch an empty string.
- **What a forced run needs.** A forced default-branch run must publish all projects (as TAG mode does) or be given an explicit base. Otherwise it either errors or publishes nothing.
- **The same gap affects forced release-branch runs** if the tag step still computes affected projects. With force bypassing the check, the affected list for tagging is irrelevant, but `nx show projects --affected --base=origin/` would still run unless skipped.

### Enforcing the branch restriction
- `workflow_dispatch` lets the user pick any branch, so the restriction must be enforced in the workflow. For example, use a job-level `if:` that allows `github.ref_name == github.event.repository.default_branch` or `startsWith(github.ref, 'refs/heads/release/')`.
- Compare against `github.event.repository.default_branch` rather than a hard-coded `master`, because `cplace-fe`'s default branch is `main`.
- Forced runs should go through build + test like push runs (the ticket's ordering). They should also share the same non-cancelling concurrency group, so a forced run and a push run on the same branch can't compute the same tag.

## Follow-up 2026-10-13 — Decisions on open questions

### Decided
- **Trigger (Q1).** `push: branches: ['release/*']` stays as is. `workflow_dispatch` adds the force input described in the 2026-10-12 follow-up.
- **Shape (Q2).** A new single workflow runs every job: install-deps, build, e2e, tag, publish, release. The existing `fe-tag.yml` / `fe-release.yml` stay untouched for unmigrated callers. *Decided 2026-10-13 (second round):* all jobs live in one reusable workflow, and each caller calls only that workflow (variant A1 below).
- **Version hand-off (Q3).**
  - The tag step writes the computed version as an output. Downstream jobs read it via `needs.<tag-job>.outputs.*` and pass it to publish as `TAG=version/X.Y.Z`; TAG mode already supports this (`artifacts-handler.ts:65-70`).
  - The output must also tell whether a tag was created, so publish and release are skipped when "no new version is needed".
  - The artifacts tool does not write to `$GITHUB_OUTPUT` today; this needs to be added.
- **Dangling tags (Q5).** No action. A tag whose publish failed remains, and the next run moves on to the next patch.
- **GitHub release (Q6).**
  - The release is created only after a successful publish, for the tag created in the same run.
  - It uses GitHub's auto-generated title and notes, e.g. `gh release create <tag> --generate-notes --verify-tag`, or the REST equivalent with `generate_release_notes: true`.
  - It is created with `GITHUB_TOKEN`, not the PAT. The job needs `contents: write`. Most callers already grant it via `write-all` or granular permissions. Repos without a `permissions:` block fall back to the org/repo default token permissions.
  - Under the current auth the tag itself is still pushed with the PAT (ticket constraint). The release step is the first part that already uses `GITHUB_TOKEN`.
  - Repos with existing hand-made releases get no special handling; notes are generated the same way and can be edited later by hand.
- **Concurrency (Q7).**
  - The whole release run gets a non-cancelling concurrency group per branch, e.g. `group: fe-release-${{ github.ref }}` with `cancel-in-progress: false`.
  - Inside the run, the job-level group in `fe-install-deps.yml:16-18` (`fe-install-deps-${{github.ref}}`, `cancel-in-progress: true`) must not cancel a release run. Either the new workflow doesn't reuse it as is, or the group is made distinct.
- **Guards (Q8).** Keep the "no new Minor/Patch version is needed" check, the `[branch-off]` commit guard, and the `squad-fe` pusher guard for now.
- **Rollout (Q11).**
  - Target: all FE repos on `release/25.4` and newer release branches, plus the default branch. Older release branches are not supported and keep the old two-run flow.
  - Each migrated branch replaces the old branch-push and tag-push caller pair with the new workflow in one change.
  - github-actions itself needs the new workflow on `master` and on `release/25.4` … `release/26.4` with per-branch refs, following the upmerge chain.
  - Repos without e2e on the release path are handled according to the Q2 outcome.
- **Live validation (Q12).** A dedicated live test setup will be prepared.

### Deferred
Q9 (branch-off day collision), Q10 (tag ruleset / recovery path), Q13 (epic PRD), Q14 (force input details).

### Q2 — where the jobs live (decided: variant A1)
**Variant A1: one reusable workflow containing all jobs** (e.g. `fe-release-flow.yml`). Inside it, jobs call the existing reusable workflows (`fe-install-deps`, `fe-build`, `fe-e2e`) plus new tag, publish and release jobs. The caller has a single `uses:`.
- The job order, guards, concurrency, version outputs and release step are written once in github-actions and rolled out per release branch there. Callers stay small and identical.
- Today's callers show drift: five file-name variants, two broken callers, and the `squad-fe` guard present in only three repos.
- Version outputs pass between jobs inside the same workflow via `needs`, so no `on.workflow_call.outputs` is required.
- The caller must pass all secrets: JFrog ×3, `DOT_NPMRC`, `GIT_USER*`, and optional `PERCY_TOKEN`; `secrets: inherit` is the simpler alternative. It must also grant `contents: write`, since nested workflows can only narrow permissions.
- Nesting reusable workflows inside a reusable workflow is subject to GitHub's nesting-depth limits. One extra level (caller → release flow → existing reusables) should be within them; check the current documented limit.
- E2e control has to be expressed as an input. See "E2e handling" below.

**Variant A2: the caller lists the individual jobs.** Each caller defines install-deps → build ∥ e2e → tag → publish → release, referencing individual reusable workflows. This needs new reusable workflows for tag (with `workflow_call` outputs), publish (with a version input) and release.
- Per-repo flexibility is natural: a repo without e2e simply omits the job.
- The ordering, `needs`/`if` wiring, version plumbing, guards and concurrency are repeated in every caller. That means about 20 repos × 6 branches (master + 25.4 … 26.4), and every later change, such as the `GITHUB_TOKEN` switch in PFM-ISSUE-34282, touches all of them again.
- It requires `workflow_call` outputs on the tag workflow, which has no precedent in this repo.

**E2e handling.**
- `fe-e2e.yml` already tolerates repos with no affected e2e projects. `run-many.ts:86-90` logs "No affected projects :)" and exits successfully, but the Cypress container shards still start.
- In A1, the choice is between an explicit boolean input such as `RUN_E2E`, default `true` (callers in cplace-legacy-fe-assets, cplace-loomeo-fe and cplace-dataciders-portfolio-management-fe set `false`), or relying on that existing no-op behaviour.
- The input is explicit and also avoids e2e for repos that do have e2e projects but deliberately skip them on release. Why those three repos skip e2e is not known.

### Explanation: Q4 publish re-run safety
- **The situation.** The single workflow's publish job fails part-way: packages A and B are published as `X.Y.Z`, package C fails, e.g. with a transient E403 or a network error.
- **"Re-run failed jobs".** GitHub keeps the outputs of the successful tag job, so the re-run publishes the same version `X.Y.Z`.
- **Today's code** publishes every package unconditionally. On re-run, A fails with "cannot publish over the previously published version" and `publish()` exits (`nx-project.ts:108-126`), so C can never be completed in that run.
- **Without a change**, the only way forward is a new run, e.g. a new push or a forced dispatch. It computes `X.Y.Z+1` and publishes everything again. This matches the ticket's semantics ("a failed publish advances the next run to the next version"), leaving `X.Y.Z` as a dangling, partially published version.
- **With skip-if-exists**, before each `npm publish` the tool checks whether `name@X.Y.Z` already exists in JFrog. `NxProject.packageExists` (`nx-project.ts:183-215`) does exactly this and is already used for PR snapshots. If it exists, the package is skipped. The re-run then publishes only C and the release step can follow, completing `X.Y.Z` instead of abandoning it.
- **Trade-offs:**
  - Skipping assumes the existing package came from the same commit's build, which holds for a re-run of the same run.
  - It would also silently skip a genuine collision, e.g. a version published locally by branch-off. Today that case fails loudly, as in `version/26.4.1`.
  - Restricting skip-if-exists to re-runs (`github.run_attempt > 1`) keeps the loud failure on first attempts.
- **Decision (2026-10-13):** no skip-if-exists. A re-run must calculate and publish the **next** version. The broken version stays broken, and its artifacts stay partly published.
- **Consequence for the job layout:**
  - GitHub's "Re-run failed jobs" keeps the outputs of jobs that succeeded. If tag and publish were separate jobs, re-running a failed publish job would reuse the old tag job's output and try `X.Y.Z` again, which conflicts with the decision.
  - Version calculation, tag push and publish should therefore run **in the same job** (tag step, then publish step). Re-running that job recalculates from the remote tags: `X.Y.Z` now exists, so it computes `X.Y.Z+1`, pushes the new tag and publishes.
  - The GitHub release job then depends on that job and reads the version from its output. A re-run of only the release job, after a successful publish, reuses the correct version.
  - "Re-run all jobs" also gives the next version, because the tag is recalculated, but it repeats build and e2e.
  - The "no new version needed" check must not suppress the re-run. On the re-run, the affected set relative to `BASE` (`github.event.before`) is the same as in the first attempt, so tagging is still triggered.
