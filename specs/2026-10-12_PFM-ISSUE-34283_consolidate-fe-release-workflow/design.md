---
date: 2026-10-19
git_commit: faa477146b7039659f88a128b9b364f64b1eddae
branch: master
topic: "Consolidate the FE 2.0 release flow (fe-tag + fe-release) into a single workflow"
tags: [design, github-actions, fe-release, fe-tag, artifacts, versioning, jfrog, github-release, concurrency, workflow-dispatch]
status: draft
---

# Consolidate the FE 2.0 Release Flow into a Single Workflow - Design Approach

## Overview

Replace today's two chained runs per FE repo (branch push → `fe-tag`, then tag push → `fe-release`) with one reusable workflow, `fe-release-flow.yml`. Each caller invokes it with a single `uses:`. Within one run it does build + test → push the version tag → publish to JFrog → create the GitHub release. It also adds a `workflow_dispatch` path with a `force` input as the supported alternative to tagging by hand. This ticket delivers the github-actions side (workflow, tool changes, template, docs) on `master` and `release/25.4` … `release/26.4`. Consumer migration starts with the pilot PFM-ISSUE-34287.

## Problem Statement

The release is currently two workflow runs connected only by a PAT-pushed tag:
- Any `*/*` tag (manual, UI-created, stray) starts a full publish.
- A failed publish leaves a tag with no or partial artifacts, and a re-run fails with E403 on the first already-published package.
- No GitHub release is created anywhere.

The split exists only because a tag pushed with `GITHUB_TOKEN` doesn't trigger workflows. A single run removes that coupling, which is the prerequisite for the `GITHUB_TOKEN` switch (PFM-ISSUE-34282).

### Requirements
- One workflow, triggered by `push: branches: ['release/*']` and by `workflow_dispatch` with a user-selectable `force` input. Manual tag creation does not trigger a release, as far as workflow files can enforce it (a tag ruleset is deferred).
- Order within the run: build + test → push version tag → publish to JFrog → create the GitHub release.
- Tag-before-publish semantics: a failed tag push retries the same version, and a failed publish moves the next run to the next version.
- The GitHub release is created only after a successful publish.
- Retries are deadlock-free.

### Constraints
- Works under the current auth: the tag is still pushed with the PAT (`GIT_USER_TOKEN`, actor `squad-fe`). Only the GitHub release uses `GITHUB_TOKEN`.
- Because of the PAT push, a migrated branch's tree must not contain the old `on: push: tags` caller, or it publishes a second time.
- The existing `fe-tag.yml` / `fe-release.yml` stay untouched for unmigrated branches and repos.
- Every github-actions change is made per release branch (`master`, `release/25.4` … `26.4`) along the upmerge chain, with per-branch refs.
- Never test on `release/*`; validation uses the prepared live test setup (2026-06-08 incident rule).

## Design Decisions Summary

1. **One reusable workflow, `fe-release-flow.yml`, called from one caller file**: all release jobs live in github-actions; callers are small and identical.
   - Jobs: `guard` → `install-deps` → `build` ∥ `e2e` → `release` → `github-release`. The build blocks reuse the existing `fe-install-deps`, `fe-build` and `fe-e2e` as nested reusables.
   - E2e can be switched off with a `RUN_E2E` input (default `true`). The `release` job accepts a skipped e2e.
   - Callers on all migrated branches carry the same file, normalized to `fe-release.yml`. On `release/*` it fires on push to that branch and on dispatch. On the default branch only dispatch is live. That copy is the seed that cf-devkit branch-off copies into each new `release/X.Y`.
2. **Concurrency is caller-level run policy; reusable workflows have none**:
   - The caller template declares `concurrency: { group: fe-release-${{ github.ref }}, cancel-in-progress: false }`.
   - The cancelling job-level group in `fe-install-deps.yml:16-18` is removed entirely.
3. **Tag and publish happen in one tool process (new combined release mode)**: the artifacts tool computes the version from remote tags, applies the "anything affected?" check (skipped by `force`), tags and pushes, then publishes all publishable projects at exactly that version.
   - It writes `released`, `tag`, `previous_tag` and `is_latest` to `$GITHUB_OUTPUT`.
   - The existing `ONLY_BUMP_VERSION` and TAG modes are unchanged. The constructor-ordering bug (the release-branch block resets the TAG version to `X.Y.0`) is avoided by design in the new mode.
   - Version calculation, tag and publish sit in the same job, so "Re-run failed jobs" recomputes and moves on to the next patch.
4. **`workflow_dispatch` with `force` (default `false`), guarded to the default branch and `release/*`**:
   - A `guard` job fails a dispatch on any other ref and skips the run's later jobs for `squad-fe` pushes.
   - On dispatch, build, storybook and e2e cover **all** projects. This needs a `run-many` fix so its existing "all projects" branch can be reached.
   - `force` on `release/*` produces a forced release. `force` on the default branch publishes a snapshot of all projects (unique `0.0.0-SNAPSHOT-…` version, `snapshot` dist-tag, no tag or release). A non-forced dispatch is a dry run (build + test only).
5. **GitHub release via `gh release create` in its own job**: `gh release create "$TAG" --verify-tag --generate-notes --notes-start-tag "$PREV" --latest="$IS_LATEST"` with `GITHUB_TOKEN`.
   - It runs only if `released == 'true'` and skips if a release for the tag already exists. It publishes directly, not as a draft.
   - `previous_tag` (same release line) keeps the notes range correct, and `is_latest` keeps the "Latest" badge on the highest version across parallel lines.
6. **Caller contract: `secrets: inherit` + minimal permissions**: callers pass `secrets: inherit` and declare `permissions: contents: write`. Each job in the release flow narrows to what it needs (`contents: read` for guard, build and e2e; `contents: write` for `github-release`).
7. **Scope and rollout packaging**:
   - This ticket covers github-actions only:
     - the new workflow
     - the tool changes: release mode, force, outputs, snapshot-all
     - the `run-many` fix
     - removing the install-deps concurrency
     - the new caller template, replacing `fe-release.yml` and deleting `fe-tag-pushed.yml`
     - README docs for the flow, secrets and force
   - These changes land on `master` and on `release/25.4` … `26.4`.
   - The consumer rollout follows the pilot (PFM-ISSUE-34287) and excludes cplace-bayer-prompt-fe and the three dormant repos.

This means:
- A release is a single, ordered run. A failed publish leaves at most a dangling tag; it never leaves a GitHub release without artifacts.
- Recovery is simple: "Re-run failed jobs" on `release` publishes the next patch, a re-run of `github-release` alone reuses the same tag, and a forced dispatch releases even when nothing is affected.
- An accidental "Run workflow" click releases nothing (default `force: false` is a dry run), and dispatch on feature branches or tags is rejected.
- The EPIC-1963 follow-ups below become github-actions-only changes; callers don't change:
  - split JFrog secrets instead of `DOT_NPMRC`
  - the `GITHUB_TOKEN` tag push (34282)
  - retiring `GIT_USER*` (34286)
- Release notes and the "Latest" badge stay correct across parallel release lines (25.4 … 26.4).

Major trade-offs we're accepting:
1. No resume of a partial publish: a broken version stays partly published and the next run uses a new patch. We give up completing a version, and keep fail-loud behavior on real collisions plus a simple publish path.
2. Forced runs test everything: much slower than an affected run (well beyond the ~1 h cplace-fe cycle). In return, the test scope matches the shipped scope.
3. `secrets: inherit` exposes all caller secrets to the release flow: we give up least-privilege secret passing, and gain auth migrations that don't touch about 120 caller files each time.
4. Removing the install-deps concurrency: superseded PR and main runs are no longer cut short until those callers add run-level concurrency. It costs CI minutes, not correctness.
5. GitHub keeps at most one pending run per concurrency group. A third push while one release is running and one is queued replaces the queued one. The replacing run's affected base is narrower, so its "no new version needed" check may skip a tag that the replaced run would have created.
6. Normalizing caller filenames means the Actions run history starts fresh in repos that don't use template names (cplace-fe, office-reports, workflow-fe, loomeo, legacy-fe-assets, frontend-applications).

What we're NOT doing (out of scope):
- A `version/*` tag ruleset or a tag-triggered recovery path (Q10, deferred).
- Fixing the branch-off-day `.1` collision (Q9, deferred).
- Skip-if-exists / resumable publish (rejected in research Q4).
- Pushing the tag with `GITHUB_TOKEN` (PFM-ISSUE-34282) or enabling immutable releases (PFM-ISSUE-34284).
- Migrating consumer repos (pilot PFM-ISSUE-34287 and the following rollout). cplace-bayer-prompt-fe and the dormant frontend-applications/-consumer/-documentation-test are excluded from that rollout.
- Retiring `fe-tag.yml` / `fe-release.yml`, adding run-level concurrency to `fe-pr` / `fe-main` templates, and the release-type input (major/minor bump).
- Release branches older than `release/25.4`.

Success criteria:
- On the live test setup, one push to a `release/*` test branch produces exactly one run that tags, publishes all packages at that version, and creates a GitHub release with correct notes range and "Latest" flag. No second (tag-triggered) run starts.
- A deliberately failed publish leaves a tag without a GitHub release, and "Re-run failed jobs" publishes and releases the next patch.
- A non-forced dispatch tags and publishes nothing. A forced dispatch on a release branch with nothing affected releases. A dispatch on a feature branch fails in `guard`.
- Unit tests cover the new release mode, including tag/push commands, force bypass, `$GITHUB_OUTPUT` values (`released`, `tag`, `previous_tag`, `is_latest`) and the `[branch-off]` precedence over force.

## Design Decisions - Details

### Solution shape and job layout

**Chosen Approach:** One reusable workflow (`fe-release-flow.yml`, variant A1 from research) that nests the existing `fe-install-deps`, `fe-build` and `fe-e2e`, followed by new `release` and `github-release` jobs. A `guard` job comes first and every other job `needs:` it.

**Rationale:** The order, guards, version outputs and release step are written once in github-actions. Today's callers have drifted: five filename schemes, two broken callers, and the `squad-fe` guard in only three repos. Nesting the existing building blocks keeps one definition of install, build and e2e for later Node, SHA-pin and npmrc changes.

**Alternatives Considered:**
- **Caller lists individual jobs (A2)**: Rejected in research. It repeats wiring, guards and version plumbing in about 20 repos × 6 branches, and needs `workflow_call` outputs that have no precedent here.
- **Inline install-deps only**: Rejected because the install steps would exist twice and drift.
- **Inline everything**: Rejected because it duplicates about 150 lines of build and e2e matrix shared with fe-pr and fe-main.

**Implications:**
- The `release` job condition must treat a skipped e2e as success: `needs.build.result == 'success'` and `needs.e2e.result` in (`success`, `skipped`).
- The UI shows two levels of nesting (`release-flow / build / …`).
- One caller file on every migrated branch. On the default branch its `push: release/*` trigger is inert and only dispatch is live. It becomes live when branch-off copies it into a new `release/X.Y`.

---

### Concurrency

**Chosen Approach:** Concurrency is run-level policy owned by the caller: `group: fe-release-${{ github.ref }}`, `cancel-in-progress: false` in the caller template. The job-level `concurrency:` in `fe-install-deps.yml` is removed completely.

**Rationale:** A reusable workflow is a fragment of a bigger run, so a group on one nested job only cancels part of that run. In particular, `fe-install-deps-${{ github.ref }}` with `cancel-in-progress: true` would let an ordinary `fe-main` push run cancel a forced dispatch run on the default branch.

**Alternatives Considered:**
- **Additive opt-out input on `fe-install-deps` (`CANCEL_IN_PROGRESS`)**: Recommended, then overturned on user override. The assumption that turned out wrong: that callers rely on the job-level cancel and that shared-workflow behavior should be preserved. The principle adopted instead is that reusable workflows carry no concurrency.
- **Concurrency inside `fe-release-flow.yml`**: Proposed in the solution overview, then moved to the caller under the same principle.

**Implications:**
- Every caller must carry the concurrency block correctly. It is defined once in the new caller template.
- `fe-pr` and `fe-main` callers lose the partial cancel of superseded runs until they add their own run-level concurrency (follow-up, out of scope).
- The pending-run replacement behavior is accepted (trade-off 5).

---

### Artifacts tool interface for tag + publish

**Chosen Approach:** A new combined release mode in `ArtifactsHandler`, selected by a new env flag (plus `FORCE`). In one process it:
1. Computes `calculatedNewVersion` from `git ls-remote --tags`.
2. Applies the existing check `projects.length > 0 || patch === 1`, unless forced.
3. Respects the `[branch-off]` guard, which wins over force.
4. Runs `git tag` + `git push` (PAT from checkout).
5. Publishes all publishable projects at that version.
6. Writes `released`, `tag`, `previous_tag` and `is_latest` to `$GITHUB_OUTPUT`.

When nothing is tagged, it writes `released=false` and exits successfully.

**Rationale:** The version never leaves the process, so the tag and the published version can't drift. It matches the Q4 decision that a re-run computes the next version. The existing modes stay byte-for-byte unchanged for unmigrated branches running the same tool.

**Alternatives Considered:**
- **Two action calls in one job (bump with output, then TAG mode)**: Rejected. It needs a constructor priority fix that changes behavior for every caller of the tool, runs `npm ci`/setup twice, and moves the version through YAML wiring.

**Implications:**
- The tool also needs a "publish all" switch for forced default-branch snapshots, since today only TAG mode sets `onlyAffected=false`.
- When forced, the tool must skip `nx affected` entirely, because dispatch has no `github.event.before`.
- Logs and the step summary must make clear whether the tag phase or the publish phase failed.
- `previous_tag` = the highest existing tag in the same `X.Y` line (empty for `X.Y.1`). `is_latest` = whether the new tag is the highest `version/*` overall.

---

### Force / `workflow_dispatch` semantics

**Chosen Approach:**
- `workflow_dispatch` with `force: boolean`, default `false`.
- The `guard` job (first job of `fe-release-flow.yml`):
  - **fails** the run on dispatch when the ref is neither `github.event.repository.default_branch` nor `refs/heads/release/*`
  - **skips** later jobs when `github.event.pusher.name == 'squad-fe'`
- On dispatch, build, storybook and e2e run on **all** projects.

| Trigger | Branch | Behavior |
|---|---|---|
| push | `release/*` | affected build/e2e → release if affected → GitHub release |
| dispatch, `force: true` | `release/*` | all build/e2e → release (check bypassed) → GitHub release |
| dispatch, `force: true` | default | all build/e2e → snapshot of all projects, no tag/release |
| dispatch, `force: false` | either | all build/e2e only (dry run) |

**Rationale:**
- `workflow_dispatch` has no branch filter, and the dropdown offers every branch and tag that contains the caller file. Without the check, a dispatch on a feature branch would publish under the `snapshot` dist-tag, and a dispatch on a `version/*` tag would re-enter TAG mode.
- "Affected since base" describes a push, and a dispatch has none. Since a forced run publishes everything, it tests everything.
- Default `false` as a dry run makes an accidental click harmless, and needs no base anywhere.

**Alternatives Considered:**
- **Base = parent of the tip commit (tip replay)**: Rejected. It tests roughly nothing when force is used because nothing was affected, which leaves the forced path on less evidence than a normal release.
- **Base = latest version tag of the line**: Rejected. It duplicates the tag lookup in YAML, uses different rules per branch kind, and gives weaker guarantees after a dangling tag.
- **Non-forced dispatch = "release if unreleased" (base = last tag)**: Rejected. It has no meaningful definition on the default branch and needs the same tag-lookup logic.
- **`force` default `true`**: Rejected in favor of the safe default.

**Implications:**
- `run-many`'s existing "all projects" branch (`affected-projects.ts:27-28`, `ref === ''`) can't be reached today: the action passes `base` and `ref` as positional shell arguments (`run-many/action.yml`), so empty values shift or disappear.
  - Workflows keep passing `GHA_REF: ''` for "current ref". The scripts normalize the value: an empty or undefined ref becomes `''`.
  - Because of that, `ref === ''` can no longer select "all projects", or every push run would build everything. An explicit "all" input selects it instead.
- The release flow decides "all vs affected" per trigger and passes it to `fe-build` / `fe-e2e`. That means a new optional input on those reusables (additive, default = today's behavior).
- The `force` input description must say that unticked means build and test only.

---

### GitHub release

**Chosen Approach:** A separate `github-release` job: `needs: release`, `if: needs.release.outputs.released == 'true'`, job-level `permissions: contents: write`, `GH_TOKEN: ${{ github.token }}`. It skips if a release for the tag already exists. Otherwise it runs `gh release create "$TAG" --verify-tag --generate-notes --notes-start-tag "$PREV" --latest="$IS_LATEST"`, omitting `--notes-start-tag` when `previous_tag` is empty. The release is published directly, not as a draft.

**Rationale:** It has the smallest footprint: `gh` is preinstalled, so there is no new action or SHA pin. `--verify-tag` guarantees the release never creates a tag of its own. As its own job, a release failure never re-triggers publish or burns a version. A draft adds nothing, because the release is created only after a successful publish.

**Alternatives Considered:**
- **`actions/github-script` + `repos.createRelease`**: Rejected. It means more inline JS, and has no `--verify-tag` equivalent: the API would silently create a missing tag.
- **Create the release inside the artifacts tool**: Rejected. A cosmetic release failure would fail the publish job, and a re-run would publish the next version.
- **GitHub defaults for notes range and "Latest"**: Rejected. With parallel release lines they produce cross-line notes, and a hotfix on an older line would take the "Latest" badge.

**Implications:**
- Repos with hand-made releases get no special handling (research Q6). The existing-release check makes accidental overlap harmless.
- Once PFM-ISSUE-34284 enables immutability, releases are locked at creation, which is the intended final state.

---

### Secrets and permissions contract

**Chosen Approach:** Callers use `secrets: inherit` and declare `permissions: contents: write`. `fe-release-flow.yml` declares the secrets it uses:
- JFrog ×3
- `DOT_NPMRC`
- `GIT_USER_TOKEN`, `GIT_USER`, `GIT_USER_EMAIL`
- optional `PERCY_TOKEN`

It narrows permissions per job.

**Rationale:** The secret set changes three times in this epic (split JFrog secrets, 34282, 34286). GitHub rejects a caller that passes a secret the called workflow no longer declares, so explicit passing would force each change into about 20 repos × 6 branches in lockstep. Callers and github-actions share the `collaborationFactory` org, so `inherit` works.

**Alternatives Considered:**
- **Explicit secrets (current template pattern)**: Rejected. Every auth ticket would mean a coordinated rollout of breaking changes.

**Implications:**
- Deviates from the existing templates' explicit-secrets pattern. The README must document the required secrets, since the caller no longer shows them.
- The three repos without a `permissions:` block get the template's block when they migrate, so they don't rely on org defaults.

---

### Naming and rollout packaging

**Chosen Approach:**
- New reusable `fe-release-flow.yml`.
- Consumer caller normalized to `fe-release.yml`: the migration commit deletes both old caller files and adds it.
- The new caller template replaces `workflow-templates/fe/fe-release.yml`. `fe-tag-pushed.yml` is deleted from the templates.
- This ticket delivers github-actions only (all items in decision 7), on `master` and `release/25.4` … `26.4`.
- The consumer rollout follows the pilot PFM-ISSUE-34287 and excludes cplace-bayer-prompt-fe and the three dormant repos. The `RUN_E2E: false` repos (legacy-fe-assets, loomeo, dataciders) migrate with the input set.

**Rationale:**
- A new name avoids breaking unmigrated callers and ends the tag/publish naming clash.
- Normalized filenames make the following EPIC-1963 rollouts searchable and scriptable, and the migration commit touches these files anyway.
- The pilot is already a separate ticket blocked by this one.

**Alternatives Considered:**
- **Rework `fe-release.yml` in place**: Rejected. It breaks unmigrated callers on the same ref.
- **Keep per-repo caller filenames**: Rejected. It keeps four drifting naming schemes, in exchange for preserving run history.
- **Migrate all consumers in this ticket**: Rejected. It means about 120 files before the flow is proven, and conflicts with the pilot ticket.

**Implications:**
- The old reusables `fe-tag.yml` / `fe-release.yml` and their `@release/*` refs stay functional on all github-actions branches during the rollout.
- Run history starts fresh in repos with non-template caller names (trade-off 6).

---

## Overall Architecture

A thin caller per FE repo branch. It owns the triggers, concurrency, permissions and `secrets: inherit`, and calls `fe-release-flow.yml@<branch ref>`. The reusable workflow owns all release logic. The artifacts tool owns versioning, tagging and publishing in a single process. A final job turns a successful publish into a GitHub release.

### Key Components
1. **Caller `fe-release.yml` (consumer repos, from the new template)**: `on: push: branches: ['release/*']` and `workflow_dispatch: inputs: force`, run-level non-cancelling concurrency, `permissions: contents: write`, `secrets: inherit`, and inputs such as `RUN_E2E`.
2. **`fe-release-flow.yml` (github-actions, new)**: the jobs `guard`, `install-deps`, `build`, `e2e`, `release` and `github-release`, plus the all-vs-affected decision per trigger.
3. **`fe-install-deps.yml` / `fe-build.yml` / `fe-e2e.yml` (existing)**: reused as-is, except that the install-deps concurrency is removed and build/e2e get an additive "all projects" input.
4. **Artifacts tool (`tools/scripts/artifacts/`)**: a new combined release mode (version → tag → publish → `$GITHUB_OUTPUT`), `FORCE` handling, and snapshot "publish all".
5. **`run-many` (`tools/scripts/run-many/`, `.github/actions/run-many/`)**: robust argument passing and an explicit "all projects" mode.
6. **`github-release` job**: `gh release create --verify-tag` with notes range and the "Latest" flag from tool outputs.
7. **README**: documents the release flow, the required secrets, the caller template, and the semantics of `force` and dry run.

### Data Flow
1. A push to `release/X.Y` (or a dispatch) starts the caller. The concurrency group serializes runs per branch.
2. `guard` validates the ref and the pusher and decides affected vs all.
3. `install-deps` → `build` ∥ `e2e` run on the checked-out commit.
4. `release` checks out with the PAT. The tool reads remote tags, computes `version/X.Y.Z`, and decides whether to tag (check or force). It pushes the tag, publishes all packages at `X.Y.Z` to JFrog, and emits `released`, `tag`, `previous_tag` and `is_latest`. On the default branch with force, it publishes an all-projects snapshot instead and emits `released=false`.
5. `github-release` runs when `released == 'true'` and creates the release for `tag` using `GITHUB_TOKEN`.

### Integration Points
- **JFrog npm registry:** publishing via the existing `.npmrc` / `JFROG_*` secrets.
- **GitHub git remote:** tag push via the PAT persisted by `actions/checkout`.
- **GitHub Releases API:** via the `gh` CLI with `GITHUB_TOKEN`.
- **cf-devkit branch-off:** copies the default-branch caller into `release/X.Y` and rewrites `@master` → `@release/X.Y`. The `[branch-off]` guard in the tool still prevents re-releasing branch-off commits.
- **The github-actions upmerge chain:** each change lands on `release/25.4` … `26.4` and `master`, with per-branch refs.

## Known Risks

1. **Old tag-push caller left in a migrated tree causes a double publish**: the PAT tag push fires any `on: push: tags` workflow in the tagged commit. - Mitigation: the migration is one commit that deletes both old caller files. The new template's README and the pilot checklist call this out.
2. **Pending-run replacement in the concurrency group**: a replacing run's narrower affected base may skip a needed tag. - Mitigation: accepted; a forced dispatch releases explicitly.
3. **Forced-run duration**: e2e on all projects may exceed the 120-minute `fe-e2e` timeout in large repos. - Mitigation: measure in the live test setup and tune shards or timeout per trigger if needed.
4. **`secrets: inherit` widens secret exposure**: - Mitigation: the reusable workflow lives in our own repo, its refs are pinned to our branches, and changes are reviewed.
5. **`run-many` argument fix touches shared PR/main paths**: - Mitigation: keep today's default behavior and cover the empty-value cases with unit tests.
6. **fe-release was never validated live** (node24 validation log): the publish path has latent issues that appear only at runtime. - Mitigation: a dedicated live test setup before the pilot, with no tests on real `release/*` branches.

## Next Steps

1. Review this design document
2. Refine if needed based on feedback
3. Proceed to implementation planning: `/spec-driven-development:create_plan specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/design.md`

## References

- Original ticket: [PFM-ISSUE-34283](https://base.cplace.io/pages/3oujt03zx1awhafambsry1q90/PFM-ISSUE-34283-Consolidate-the-FE-2.0-release-flow-into-a-single-workflow)
- Related research: [Research](./research.md)
- Prior rollout pattern: [Node 24 workflow migration design](../2026-06-05_node24-workflow-migration/design.md)
- Existing code: `.github/workflows/fe-tag.yml`, `.github/workflows/fe-release.yml`, `.github/workflows/fe-install-deps.yml`, `.github/workflow-templates/fe/fe-release.yml`, `tools/scripts/artifacts/artifacts-handler.ts`, `tools/scripts/run-many/affected-projects.ts`, `.github/actions/run-many/action.yml`
