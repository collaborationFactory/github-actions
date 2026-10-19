# Consolidate the FE 2.0 Release Flow into a Single Workflow - Implementation Plan

## Overview

Build the github-actions side of PFM-ISSUE-34283 as designed in [design.md](./design.md). The work adds a new reusable workflow, `fe-release-flow.yml`, which runs guard → install-deps → build ∥ e2e → release (version → tag → publish) → GitHub release in one run. It also adds:
- a release-flow mode with `FORCE` and `$GITHUB_OUTPUT` values in the artifacts tool
- an explicit "all projects" mode in `run-many`
- removal of the cancelling install-deps concurrency
- a new caller template that replaces the two old ones
- README documentation

The work is implemented on `release/25.4` and upmerged through `26.1 → 26.2 → 26.3 → 26.4 → master`, with each step rewriting refs and Node versions for its branch.

## Current State Analysis

Verified on HEAD `faa4771` (= `origin/master`) and on `origin/release/25.4` (`e3b9cad`):

- The release is two runs. The `fe-release.yml` template calls `fe-tag.yml` on push to `release/*`, and the PAT tag push then fires `fe-tag-pushed.yml`, which calls `workflows/fe-release.yml`.
- `ArtifactsHandler` selects a mode from env flags (`artifacts-handler.ts:38-98`). `bumpVersionForReleaseBranch()` (`:187-207` on master, `:174-194` on 25.4) computes the version, applies the `projects.length > 0 || patch === 1` check, and runs `git tag` + `git push`. Nothing is written to `$GITHUB_OUTPUT`.
- Branch drift that matters to this plan:

  | Branch | Node in workflows | `[branch-off]` guard (`Utils.isBranchOffCommit`) | Internal refs |
  |---|---|---|---|
  | `release/25.4`, `26.1`, `26.2`, `26.3` | `22.15.0` | **absent** | `@release/<X.Y>` |
  | `release/26.4` | `24.20.0` | present (`artifacts-handler.ts:109-114`) | `@release/26.4` |
  | `master` | `24.20.0` | present | `@master` |

  The guard is deliberately **not** backported. Branch-off only happens from master, so older lines never receive `[branch-off]` commits. The release-flow mode inherits the guard when it upmerges into 26.4, because the guard runs at the top of `handle()` before any mode is selected.
- The upmerge chain is clean today: no commits are pending on any of `25.4→26.1→26.2→26.3→26.4→master`. Upmerges are local merge commits that the user pushes, with no PRs.
- Jest baseline on Windows: 5 tests fail on both `release/25.4` and `master` because of path separators. These failures are unrelated to this work:
  - `isE2eAppWithPublicApi returns true when e2e app has public_api.ts`
  - `isE2eAppWithPublicApi returns false when e2e app does not have public_api.ts`
  - `getAllNxProjects includes e2e apps with public_api.ts`
  - `NxProject can provide jfrog Url`
  - `e2e app is not publishable when public_api.ts does not exist`
- `actionlint` is not installed locally. The repo CI (`pr-checks.yml`) runs neither jest nor actionlint.

## Desired End State

On `release/25.4` … `release/26.4` and `master`:
- `.github/workflows/fe-release-flow.yml` exists, with refs and Node version matching its branch.
- The artifacts tool has a `RELEASE_FLOW` mode, and the composite action exposes `released`, `tag`, `previous_tag` and `is_latest`.
- `run-many` has an explicit `all` input, and `fe-build` / `fe-e2e` have `ALL_PROJECTS`.
- `fe-install-deps.yml` has no `concurrency:`.
- `workflow-templates/fe/fe-release.yml` is the new caller, and `workflow-templates/fe/fe-tag-pushed.yml` is gone.
- The README documents the flow.

`fe-tag.yml` and `workflows/fe-release.yml` are unchanged everywhere.

Verify with the per-phase greps below, `npx jest` (no failures beyond the Windows baseline), and `actionlint` over `.github/workflows/` and `.github/workflow-templates/fe/`.

### Key Discoveries:
- **An empty `GHA_REF` is handled in the scripts, not the workflows.**
  - All push callers pass `GHA_REF: ''` (`workflow-templates/fe/fe-main.yml:22`, `fe-release.yml:21`), and they keep doing so.
  - `run-many/action.yml:24` passes the arguments positionally and unquoted, so the empty ref arrives as `undefined` and `ref === ''` (`affected-projects.ts:28`) is unreachable today.
  - The scripts normalize an empty or undefined ref to `''`. Once they do, `ref === ''` would be true for every push run, so it can't stay the "all projects" switch. "All" becomes an explicit input passed by env.
- **The composite action has to declare outputs.** `$GITHUB_OUTPUT` inside a composite action's `run` step belongs to that step. `.github/actions/artifacts/action.yml` needs an `id` on the ts-node step and an `outputs:` block, or the job can't read the values.
- **`calculateNewVersion` mutates the tag object it returns** (`utils.ts:205`, `latestExistingTag.patchVersion(...)`). That object also sits in the tag list. `previous_tag` therefore has to be read as a string *before* the bump.
- **The release job needs `!cancelled()` for the skipped-e2e case.** A job whose `if:` has no status function gets an implicit `success()`, so a skipped `needs` job (e2e with `RUN_E2E: false`) skips the dependent job. The `release` condition must start with `!cancelled()` and check `needs.*.result` explicitly.
- **Nested reusable workflows need full paths.** Inside a reusable workflow, `./.github/workflows/x.yml` resolves to the caller's repo, so nested calls must use `collaborationFactory/github-actions/.github/workflows/x.yml@<branch>`.
- **A new file merges silently.** `fe-release-flow.yml` produces no merge conflict on upmerge, so its `@release/25.4` refs and Node `22.15.0` would carry over unnoticed. Each upmerge rewrites them before committing the merge.
- **Test pattern:** `tools/scripts/artifacts/artifacts-handler-tag.test.ts`. It uses jest `spyOn` on `child_process.execSync` and `Utils` statics, and resets env in `afterEach`. Jest workers reuse processes across files, so new env flags must be reset in `afterEach`.
- **Release job pattern:** `workflows/fe-release.yml:19-54` (checkout, node, cache, use-npmrc, install, artifacts) plus `fe-tag.yml:30-48` (PAT checkout, git identity).

## What We're NOT Doing

- Backporting the `[branch-off]` guard (#180) to `release/25.4` … `26.3`.
- A `version/*` tag ruleset or a tag-triggered recovery path. Fixing the branch-off-day `.1` collision. Skip-if-exists / resumable publish.
- Pushing the tag with `GITHUB_TOKEN` (34282), enabling immutable releases (34284), or retiring `GIT_USER*` (34286).
- Changing `fe-tag.yml` / `workflows/fe-release.yml`, or adding run-level concurrency to the `fe-pr` / `fe-main` templates.
- Migrating any consumer repo (pilot PFM-ISSUE-34287 and the following rollout).
- Release branches older than `release/25.4`.
- Scripted live validation. It is deferred and done manually by the user (see "Manual Testing Steps").

## Implementation Approach

Work happens on `improvement/PFM-ISSUE-34283-Consolidate-the-FE-2-0-release-flow-into-a`, branched from `origin/release/25.4`.

The building blocks come first: `run-many` "all", then the tool's release-flow mode and its composite outputs. Each is unit-tested against the contract the design fixes. Phase 3 wires them together end to end in `fe-release-flow.yml` and the caller template, and checks the wiring statically with actionlint: every `needs.*.outputs.*`, input and secret reference must resolve. Phase 4 documents the flow. Phase 5 opens the PR into `release/25.4`. Phase 6 carries the change up the chain, adapting refs and Node per branch, and adds the `[branch-off]`-over-force test where the guard exists.

Every push, PR and merge to a shared branch is **[OUTWARD]**: the user approves each one explicitly, and the user executes each push.

---

## Phase 1: Branch Setup and `run-many` "All Projects" Mode

### Overview
Create the feature branch from `release/25.4`, install actionlint, and commit the spec documents. Then make the existing "all projects" path in `run-many` reachable through an explicit input, with no change to today's default behavior. `fe-build` and `fe-e2e` get an additive `ALL_PROJECTS` input.

### Changes Required:

#### 1. Branch and tooling
```bash
git fetch origin
git switch -c improvement/PFM-ISSUE-34283-Consolidate-the-FE-2-0-release-flow-into-a origin/release/25.4
# the untracked specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/ comes along
npm ci
go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.7
actionlint .github/workflows/*.yml   # record baseline findings (pre-existing, not ours)
```
Commit the spec directory as the first commit (`PFM-ISSUE-34283 - Add research, design and plan`).

#### 2. `run-many` logic
**File**: `tools/scripts/run-many/affected-projects.ts`
**Changes**:
- Replace the `ref === ''` condition with an explicit `all` parameter. `ref` stays in the signature, because `run-many.ts` logs it.
- Add `normalizeRef`, which turns an empty or undefined ref (the workflows pass `GHA_REF: ''`) into `''`. It is exported so it can be unit-tested; `run-many.ts` runs `main()` on import and can't be.

```ts
export function normalizeRef(ref: string | undefined): string {
  return ref ?? '';
}
```

```ts
export function getAffectedProjects(
  target: string,
  jobIndex: number,
  jobCount: number,
  base: string,
  ref: string,
  all = false
) {
  let allAffectedProjects = [];
  if (all) {
    allAffectedProjects = Utils.getAllProjects(false, null, target);
  } else {
    allAffectedProjects = Utils.getAllProjects(true, base, target);
  }
  // … unchanged
}
```

**File**: `tools/scripts/run-many/run-many.ts`
**Changes**: Normalize the ref, read `RUN_MANY_ALL` from env, log it with the other inputs, and pass both on:
```ts
const ref = normalizeRef(process.argv[6]); // replaces `const ref = process.argv[6];`
const all = process.env.RUN_MANY_ALL === 'true';
// add `,\n all ${all}` to the existing Inputs log line
const projects = getAffectedProjects(target, jobIndex, jobCount, base, ref, all);
```

#### 3. Composite action input
**File**: `.github/actions/run-many/action.yml`
**Changes**: Add an optional input. Pass it by env, so the positional arguments stay byte-identical.
```yaml
  all:
    description: 'Run the target for all projects instead of the affected ones'
    required: false
    default: 'false'
# …
      env:
        DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}
        RUN_MANY_ALL: ${{ inputs.all }}
```

#### 4. Reusable build and e2e inputs
**Files**: `.github/workflows/fe-build.yml`, `.github/workflows/fe-e2e.yml`
**Changes**: Add the additive input. The default keeps today's behavior.
```yaml
      ALL_PROJECTS:
        type: boolean
        required: false
        default: false
```
- Pass `all: ${{ inputs.ALL_PROJECTS }}` to the `run-many` step.
- Add `if: ${{ !inputs.ALL_PROJECTS }}` to the "Fetch base branch" step. A dispatch has no base, so `git fetch origin :` would otherwise run against an empty refspec.

#### 5. Tests (new file: sample first)
**File**: `tools/scripts/run-many/affected-projects.test.ts` (new)
**Step 5a.** Write only the sample test, then stop for review of the pattern:
```ts
import { expect } from '@jest/globals';
import { getAffectedProjects } from './affected-projects';
import { Utils } from '../artifacts/utils';

afterEach(() => {
  jest.restoreAllMocks();
});

test('all=true lists all projects with the target, ignoring base and ref', () => {
  const getAllProjects = jest
    .spyOn(Utils, 'getAllProjects')
    .mockReturnValue(['app-a', 'lib-b', 'lib-c']);

  const projects = getAffectedProjects('build', 1, 1, 'origin/release/26.4', '', true);

  expect(getAllProjects).toHaveBeenCalledWith(false, null, 'build');
  expect(projects).toBe('app-a,lib-b,lib-c');
});
```
**Step 5b** (after the pattern is approved):
- `normalizeRef(undefined)` and `normalizeRef('')` both return `''`, and `normalizeRef('feature/x')` returns `'feature/x'`.
- `all` omitted with `ref === ''` → `getAllProjects(true, base, target)`. This locks in today's effective behavior: a normalized empty ref still means affected.
- `all=false` with a non-empty ref → affected.
- Job slicing: 5 projects, `jobCount` 2 → index 1 gets the 1st, 3rd and 5th projects in sorted order; index 2 gets the 2nd and 4th.

### Success Criteria:

#### Automated Verification:
- [ ] The branch is based on `origin/release/25.4`: `git merge-base --is-ancestor origin/release/25.4 HEAD`
- [ ] The new tests pass: `npx jest tools/scripts/run-many`
- [ ] The full suite fails only in the 5 Windows baseline tests: `npx jest 2>&1 | grep -E '^\s+● ' | grep -v Console | sort -u` lists exactly those 5 names
- [ ] The positional args are unchanged: `grep -c 'run-many.ts" ${{ inputs.target }} ${{ inputs.jobIndex }} ${{ inputs.jobCount }} ${{ inputs.base }} ${{ inputs.ref }}$' .github/actions/run-many/action.yml` = 1
- [ ] `ALL_PROJECTS` is wired: `grep -c 'all: ${{ inputs.ALL_PROJECTS }}' .github/workflows/fe-build.yml .github/workflows/fe-e2e.yml` = 1 per file
- [ ] actionlint reports no new findings for `fe-build.yml` / `fe-e2e.yml` compared with the baseline
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 1 complete. Summary: branch created off release/25.4, specs committed, actionlint installed; run-many has an explicit `all` input (env RUN_MANY_ALL), fe-build/fe-e2e have ALL_PROJECTS; affected-projects tests pass (sample reviewed first). Please review the changes and reply 'yes' to continue to Phase 2." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] The sample test pattern was approved before the remaining tests were written
- [ ] Review: no existing caller passes `all`, so PR, main and release runs keep affected behavior

---

## Phase 2: Artifacts Tool Release-Flow Mode

### Overview
Add the combined release mode (version → check → tag + push → publish → outputs) to `ArtifactsHandler`, and expose its outputs through the composite action. The existing `ONLY_BUMP_VERSION`, TAG, snapshot and PR modes stay unchanged.

### Changes Required:

#### 1. Output and summary helpers
**File**: `tools/scripts/artifacts/utils.ts`
**Changes**: Add thin wrappers, so tests can spy on them the same way they spy on other `Utils` statics.
```ts
import * as core from '@actions/core';

public static writeOutput(name: string, value: string) {
  console.log(`Output ${name}=${value}`);
  core.setOutput(name, value);
}

public static appendStepSummary(markdown: string) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
}
```
Let `getLatestTagForReleaseBranch` and `calculateNewVersion` take an optional, precomputed tag list. Existing callers keep exactly one `ls-remote`, in the same order, so the existing mocks in `artifacts-handler-tag.test.ts` still line up.
```ts
public static getLatestTagForReleaseBranch(branch: string, versionOfBranch: Version, allTags?: Version[]): Version {
  …
    tags = (allTags ?? this.getAllVersionTagsInAscendingOrder())
      .filter(…)
  …
}

public static calculateNewVersion(branch: string, allTags?: Version[]): Version {
  const versionOfBranch = Utils.getVersionFromReleaseBranch(branch);
  const latestExistingTag = Utils.getLatestTagForReleaseBranch(branch, versionOfBranch, allTags);
  … // unchanged
}
```

#### 2. Release-flow mode
**File**: `tools/scripts/artifacts/artifacts-handler.ts`
**Changes**:
- Add the fields `releaseFlow` and `force`, parsed like `onlyBumpVersion` (`JSON.parse`, only when defined).
- Dispatch in `handle()` before the `onlyBumpVersion` branch.
- Add the new method.

```ts
private releaseFlow = false;
private force = false;
// constructor, next to ONLY_BUMP_VERSION:
if (process.env.RELEASE_FLOW != undefined)
  this.releaseFlow = JSON.parse(process.env.RELEASE_FLOW);
if (process.env.FORCE != undefined) this.force = JSON.parse(process.env.FORCE);

// handle():
if (this.releaseFlow) {
  await this.tagAndPublishRelease();
} else if (this.onlyBumpVersion && …) { … } else { … }

private async tagAndPublishRelease() {
  Utils.writeOutput('released', 'false');
  if (!this.currentBranch.startsWith(ArtifactsHandler.RELEASE_BRANCH_PREFIX)) {
    if (!this.force) {
      console.log(`Release flow on ${this.currentBranch} without force: nothing is tagged or published`);
      return;
    }
    console.log(`Forced release flow on ${this.currentBranch}: publishing a snapshot of all projects`);
    this.onlyAffected = false;
    this.initProjects();
    await this.buildAndPublishProjects();
    Utils.appendStepSummary(`Published a snapshot of all projects as \`${this.currentVersion}\` (no tag, no GitHub release)`);
    return;
  }

  const allTags = Utils.getAllVersionTagsInAscendingOrder();
  // read before calculateNewVersion: it bumps the returned tag object in place
  const previous = Utils.getLatestTagForReleaseBranch(
    this.currentBranch, Utils.getVersionFromReleaseBranch(this.currentBranch), allTags);
  const previousTag = previous.isValid() ? previous.getGitTag() : '';
  this.calculatedNewVersion = Utils.calculateNewVersion(this.currentBranch, allTags);
  const isLatest = allTags.every((tag) => !tag.isValid() || this.calculatedNewVersion.compareTo(tag) >= 0);
  console.log(`The calculated new tag/version for branch ${this.currentBranch} is ${this.calculatedNewVersion}`);

  if (this.force) {
    console.log('Force is set: skipping the affected check');
  } else {
    // nx affected needs BASE, which only a push provides
    this.initAffectedProjects();
    if (this.projects.length === 0 && this.calculatedNewVersion.patch !== 1) {
      console.log('No projects are affected and no new Minor Release Branch was added therefore no new Minor/Patch version is needed');
      return;
    }
  }

  const gitTag = this.calculatedNewVersion.getGitTag();
  console.log(`Tag phase: pushing ${gitTag}`);
  console.log(execSync(`git tag ${gitTag}`).toString());
  console.log(execSync(`git push origin ${gitTag}`).toString());
  Utils.writeOutput('tag', gitTag);
  Utils.writeOutput('previous_tag', previousTag);
  Utils.writeOutput('is_latest', String(isLatest));
  Utils.appendStepSummary(`Tag phase: pushed \`${gitTag}\`. Publish phase started; if this run failed after this line, the tag is dangling and the next run releases the next patch.`);

  console.log(`Publish phase: publishing all publishable projects as ${this.calculatedNewVersion}`);
  this.currentVersion = this.calculatedNewVersion;
  this.onlyAffected = false;
  this.initProjects();
  await this.buildAndPublishProjects();
  Utils.writeOutput('released', 'true');
  Utils.appendStepSummary(`Publish phase: published all publishable projects as \`${this.calculatedNewVersion}\``);
}
```
Notes:
- `released=false` is written first and is overwritten only after a full publish. `NxProject.publish()` exits the process on failure, so a failed publish leaves `released=false` and a summary line that names the publish phase.
- `initProjects()` with `onlyAffected=false` builds `NxProject`s from `this.task` / `this.currentVersion` (`RELEASE` / the new version on `release/*`; `MAIN_SNAPSHOT` / unique snapshot version on the default branch). Setting `currentVersion` before `initProjects()` is what makes the publish use the tagged version.
- Comment density matches the surrounding code: comment only the non-obvious lines (the mutation note, the BASE note).

#### 3. Composite action outputs
**File**: `.github/actions/artifacts/action.yml`
**Changes**: Additive. Callers that ignore outputs are unaffected.
```yaml
outputs:
  released:
    description: 'true if a version was tagged and published (release flow only)'
    value: ${{ steps.handler.outputs.released }}
  tag:
    description: 'The pushed version tag (release flow only)'
    value: ${{ steps.handler.outputs.tag }}
  previous_tag:
    description: 'The previous tag of the same release line, empty for X.Y.1 (release flow only)'
    value: ${{ steps.handler.outputs.previous_tag }}
  is_latest:
    description: 'true if the pushed tag is the highest version/* tag (release flow only)'
    value: ${{ steps.handler.outputs.is_latest }}
runs:
  using: 'composite'
  steps:
    …
    - id: handler
      run: npx ts-node "$GITHUB_ACTION_PATH/../../../tools/scripts/artifacts/main.ts"
      shell: bash
```

#### 4. Tests (new file: sample first)
**File**: `tools/scripts/artifacts/artifacts-handler-release-flow.test.ts` (new)
Follow `artifacts-handler-tag.test.ts`. Mock `execSync` by command, not by call order, so that `git tag` / `git push` can be asserted directly. `afterEach` resets `RELEASE_FLOW`, `FORCE`, `BASE`, `TAG`, `ONLY_BUMP_VERSION` and `PR_NUMBER`.

**Step 4a.** Write only the sample test, then stop for review of the pattern:
```ts
const lsRemote = [
  'a1\trefs/tags/version/25.4.9',
  'a2\trefs/tags/version/26.3.5',
  'a3\trefs/tags/version/26.4.1',
  'a4\trefs/tags/version/26.4.2',
].join('\n');

test('a push to a release branch with affected projects tags, then publishes all projects at that version', async () => {
  process.env.RELEASE_FLOW = 'true';
  const execMock = mockGit();
  mockBranch('release/26.4');
  jest.spyOn(Utils, 'getAffectedNxProjects').mockReturnValue([new NxProject('lib a', NxProjectKind.Library)]);
  const allProjects = jest.spyOn(Utils, 'getAllNxProjects').mockReturnValue([]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(execMock).toHaveBeenCalledWith('git tag version/26.4.3');
  expect(execMock).toHaveBeenCalledWith('git push origin version/26.4.3');
  expect(allProjects).toHaveBeenCalledWith(TASK.RELEASE, expect.objectContaining({ major: 26, minor: 4, patch: 3 }), '@cplace-frontend-applications');
  expect(pushCallOrder(execMock)).toBeLessThan(allProjects.mock.invocationCallOrder[0]);
  expect(output).toHaveBeenCalledWith('tag', 'version/26.4.3');
  expect(output).toHaveBeenCalledWith('previous_tag', 'version/26.4.2');
  expect(output).toHaveBeenCalledWith('is_latest', 'true');
  expect(output).toHaveBeenLastCalledWith('released', 'true');
});
```
`mockGit()` returns `lsRemote` for `git ls-remote --tags` and `''` otherwise. `mockBranch()` mocks the branch, the scope, `getRootDir`, `initGithubActionsFile` and `appendStepSummary`. `pushCallOrder()` returns the `invocationCallOrder` of the `git push` call.

**Step 4b** (after the pattern is approved):
1. Nothing affected, not forced, `patch > 1` → no `git tag` / `git push`, `getAllNxProjects` not called, the only output is `released=false`.
2. Nothing affected, `FORCE=true` → tags `version/26.4.3` and publishes. `getAffectedNxProjects` is **not** called (no `nx affected` on dispatch).
3. First tag of a line (no `version/26.5.*`), nothing affected, not forced → tags `version/26.5.1`, `previous_tag` is `''`, `is_latest` is `true`.
4. Older line `release/26.3` → tags `version/26.3.6`, `previous_tag=version/26.3.5`, `is_latest=false`.
5. `git push` throws → `handle()` rejects, `getAllNxProjects` is not called, `released` is never `true`.
6. Default branch (`master`), `FORCE=true` → no `git tag` / `git push`. `getAllNxProjects` is called with `TASK.MAIN_SNAPSHOT` and a version whose string contains `-SNAPSHOT-`. `released=false`.
7. Default branch, not forced → `getAllNxProjects` / `getAffectedNxProjects` not called, `released=false`.
8. Unchanged modes: `RELEASE_FLOW` unset → `writeOutput` is never called on the `ONLY_BUMP_VERSION` path (guards against output leaking into the old flow).

Also add to `utils.test.ts`: `calculateNewVersion(branch, tags)` with a precomputed list performs no `ls-remote`.

### Success Criteria:

#### Automated Verification:
- [ ] Release-flow tests pass: `npx jest tools/scripts/artifacts/artifacts-handler-release-flow.test.ts`
- [ ] Existing mode tests pass unchanged: `npx jest tools/scripts/artifacts/artifacts-handler-tag.test.ts tools/scripts/artifacts/artifacts-handler.test.ts`
- [ ] The full suite fails only in the 5 Windows baseline tests (same command as Phase 1)
- [ ] TypeScript compiles: `npx tsc --noEmit -p tsconfig.json`
- [ ] Composite outputs are declared: `grep -c 'steps.handler.outputs' .github/actions/artifacts/action.yml` = 4
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 2 complete. Summary: ArtifactsHandler has a RELEASE_FLOW mode (version → affected check unless FORCE → git tag/push → publish all at that version → outputs released/tag/previous_tag/is_latest; forced default branch = all-projects snapshot); artifacts action exposes the outputs; release-flow tests pass (sample reviewed first). Please review the changes and reply 'yes' to continue to Phase 3." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] The sample test pattern was approved before the remaining tests were written
- [ ] Review: `bumpVersionForReleaseBranch()` and the constructor's mode selection are unchanged (`git diff origin/release/25.4 -- tools/scripts/artifacts/artifacts-handler.ts` shows only additions, plus the `handle()` dispatch)

---

## Phase 3: Release-Flow Workflow, Concurrency, Caller Template

### Overview
Wire everything end to end. This phase adds the new reusable workflow that consumes the Phase 1 and 2 contracts, removes the job-level concurrency from install-deps, replaces the release caller template and deletes the tag-pushed template. actionlint checks that every input, secret, `needs` and output reference resolves.

### Changes Required:

#### 1. New reusable workflow
**File**: `.github/workflows/fe-release-flow.yml` (new, `release/25.4` flavor: Node `22.15.0`, refs `@release/25.4`)

```yaml
name: Frontend Release Flow Workflow

on:
  workflow_call:
    inputs:
      FORCE:
        description: 'release/*: release even if no project is affected. Default branch: publish a snapshot of all projects. false: build and test only.'
        type: boolean
        required: false
        default: false
      RUN_E2E:
        type: boolean
        required: false
        default: true
    secrets:
      JFROG_BASE64_TOKEN:
        required: true
      JFROG_URL:
        required: true
      JFROG_USER:
        required: true
      DOT_NPMRC:
        required: true
      GIT_USER_TOKEN:
        required: true
      GIT_USER:
        required: true
      GIT_USER_EMAIL:
        required: true
      PERCY_TOKEN:
        required: false

env:
  NX_BRANCH: ${{ github.event.number }}
  NX_RUN_GROUP: ${{ github.run_id }}

jobs:
  guard:
    # bot pushes (upmerge, version commits) never release
    if: github.event_name != 'push' || github.event.pusher.name != 'squad-fe'
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: Check dispatch ref
        env:
          EVENT_NAME: ${{ github.event_name }}
          REF: ${{ github.ref }}
          DEFAULT_REF: refs/heads/${{ github.event.repository.default_branch }}
        run: |
          if [ "$EVENT_NAME" = "workflow_dispatch" ] && [ "$REF" != "$DEFAULT_REF" ] && [[ "$REF" != refs/heads/release/* ]]; then
            echo "::error::The release flow can only be dispatched on the default branch or a release/* branch, not on $REF"
            exit 1
          fi

  install-deps:
    needs: guard
    permissions:
      contents: read
    uses: collaborationFactory/github-actions/.github/workflows/fe-install-deps.yml@release/25.4
    with:
      GHA_REF: ''
    secrets:
      DOT_NPMRC: ${{ secrets.DOT_NPMRC }}

  build:
    needs: install-deps
    permissions:
      contents: read
    uses: collaborationFactory/github-actions/.github/workflows/fe-build.yml@release/25.4
    with:
      GHA_REF: ''
      GHA_BASE: ${{ github.event.before }}
      ALL_PROJECTS: ${{ github.event_name == 'workflow_dispatch' }}

  e2e:
    needs: install-deps
    if: inputs.RUN_E2E
    permissions:
      contents: read
    uses: collaborationFactory/github-actions/.github/workflows/fe-e2e.yml@release/25.4
    with:
      GHA_REF: ''
      GHA_BASE: ${{ github.event.before }}
      ALL_PROJECTS: ${{ github.event_name == 'workflow_dispatch' }}
    secrets:
      PERCY_TOKEN: ${{ secrets.PERCY_TOKEN }}

  release:
    needs: [build, e2e]
    # a skipped e2e (RUN_E2E: false) must not skip the release; a non-forced dispatch is a dry run
    if: >-
      !cancelled()
      && needs.build.result == 'success'
      && (needs.e2e.result == 'success' || needs.e2e.result == 'skipped')
      && (github.event_name == 'push' || inputs.FORCE)
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      released: ${{ steps.release.outputs.released }}
      tag: ${{ steps.release.outputs.tag }}
      previous_tag: ${{ steps.release.outputs.previous_tag }}
      is_latest: ${{ steps.release.outputs.is_latest }}
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
        with:
          ref: ''
          fetch-depth: 0
          token: ${{ secrets.GIT_USER_TOKEN }}
      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: 22.15.0
      - name: Cache Node Modules
        id: npm-cache
        uses: actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae # v5.0.5
        with:
          path: '**/node_modules'
          key: ${{ runner.os }}-modules-${{ hashFiles('**/package-lock.json') }}
      - name: Use .npmrc
        uses: collaborationFactory/github-actions/.github/actions/use-npmrc@release/25.4
        with:
          dot-npmrc: ${{ secrets.DOT_NPMRC }}
      - name: Install Modules
        if: steps.npm-cache.outputs.cache-hit != 'true'
        run: npm ci && echo "modules were installed via npm" || yarn
      - name: Configure git user
        run: |
          git config user.name ${{ secrets.GIT_USER }}
          git config user.email ${{ secrets.GIT_USER_EMAIL }}
      - name: Tag and Push to Jfrog NPM Registry
        id: release
        uses: collaborationFactory/github-actions/.github/actions/artifacts@release/25.4
        env:
          JFROG_BASE64_TOKEN: ${{ secrets.JFROG_BASE64_TOKEN }}
          JFROG_URL: ${{ secrets.JFROG_URL }}
          JFROG_USER: ${{ secrets.JFROG_USER }}
          RELEASE_FLOW: true
          FORCE: ${{ inputs.FORCE }}
          BASE: ${{ github.event.before }}
          DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}

  github-release:
    needs: release
    if: needs.release.outputs.released == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Create GitHub release
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
          TAG: ${{ needs.release.outputs.tag }}
          PREVIOUS_TAG: ${{ needs.release.outputs.previous_tag }}
          IS_LATEST: ${{ needs.release.outputs.is_latest }}
        run: |
          if gh release view "$TAG" > /dev/null 2>&1; then
            echo "A GitHub release for $TAG already exists, nothing to do"
            exit 0
          fi
          args=(--verify-tag --generate-notes "--latest=$IS_LATEST")
          if [ -n "$PREVIOUS_TAG" ]; then
            args+=(--notes-start-tag "$PREVIOUS_TAG")
          fi
          gh release create "$TAG" "${args[@]}"
```

#### 2. Remove the install-deps concurrency
**File**: `.github/workflows/fe-install-deps.yml`
**Changes**: Delete lines 16-18 (`concurrency:` / `group:` / `cancel-in-progress:`).

#### 3. New caller template
**File**: `.github/workflow-templates/fe/fe-release.yml` (replace the contents)
```yaml
# Replaces the old two-file release (this file as tagger + fe-tag-pushed.yml / on_tag_pushed.yaml / tag_pushed.yml).
# Delete BOTH old caller files in the same commit that adds this one: the release flow still pushes
# the tag with the PAT, so a tag-push workflow left in the tree would publish a second time.
name: 'Frontend Release CI'
on:
  push:
    branches:
      - 'release/*'
  workflow_dispatch:
    inputs:
      force:
        description: 'Tag and publish (release/*) or publish a snapshot of all projects (default branch). Unticked: build and test only, nothing is tagged or published.'
        type: boolean
        default: false

permissions:
  contents: write

concurrency:
  group: fe-release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release-flow:
    uses: collaborationFactory/github-actions/.github/workflows/fe-release-flow.yml@release/25.4
    with:
      FORCE: ${{ inputs.force == true }}
      # RUN_E2E: false # only for repos that do not run e2e before a release
    secrets: inherit
```

#### 4. Delete the tag-pushed template
**File**: `.github/workflow-templates/fe/fe-tag-pushed.yml`
**Changes**: `git rm`.

### Success Criteria:

#### Automated Verification:
- [ ] actionlint is clean for the new and changed files: `actionlint .github/workflows/fe-release-flow.yml .github/workflows/fe-install-deps.yml .github/workflows/fe-build.yml .github/workflows/fe-e2e.yml`
- [ ] The caller template lints as a workflow: `actionlint .github/workflow-templates/fe/fe-release.yml`
- [ ] No reusable FE workflow declares concurrency except `fe-licenses.yml`: `grep -l '^\s*concurrency:' .github/workflows/fe-*.yml` = `fe-licenses.yml` only
- [ ] All internal refs in the new files point to this branch: `grep -o 'github-actions/.github/[a-z]*/[a-z-]*\(.yml\)\?@[^ ]*' .github/workflows/fe-release-flow.yml .github/workflow-templates/fe/fe-release.yml | grep -vc '@release/25.4$'` = 0
- [ ] The old reusables are untouched: `git diff --quiet origin/release/25.4 -- .github/workflows/fe-tag.yml .github/workflows/fe-release.yml`
- [ ] The tag-pushed template is gone: `test ! -e .github/workflow-templates/fe/fe-tag-pushed.yml`
- [ ] The full jest suite fails only in the 5 Windows baseline tests
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 3 complete. Summary: fe-release-flow.yml added (guard → install-deps → build ∥ e2e → release → github-release), install-deps concurrency removed, caller template replaced (push release/* + dispatch force, run-level non-cancelling concurrency, secrets: inherit), fe-tag-pushed template deleted; actionlint clean. Please review the changes and reply 'yes' to continue to Phase 4." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] Walk through the trigger table in design.md against the `if:` conditions: push on `release/*`; dispatch with force on `release/*`; dispatch with force on the default branch; dispatch without force; dispatch on a feature branch or tag; `squad-fe` push; `RUN_E2E: false`

---

## Phase 4: README Documentation

### Overview
Document the release flow for consumers. The caller no longer lists secrets (`secrets: inherit`), so the README is where they are described.

### Changes Required:

#### 1. README section
**File**: `README.md`
**Changes**: Add a `## FE Release Flow` section after "Node 24 Compatibility" with these subsections:
- **What it does**: one run per push to `release/*` or dispatch. Order: guard → install-deps → build ∥ e2e → tag + publish (one job) → GitHub release. Tag before publish: a failed tag push retries the same version, and a failed publish moves the next run to the next patch.
- **Caller**: copy `.github/workflow-templates/fe/fe-release.yml`. When migrating a branch, delete the old branch-push and tag-push caller files in the same commit (double-publish warning). The caller file name is `fe-release.yml`. The copy on the default branch is the seed for branch-off. Set `RUN_E2E: false` only for repos without e2e on release.
- **Triggers and `force`**: the four-row trigger table from design.md. A dispatch on any other ref fails in `guard`. `squad-fe` pushes are skipped.
- **Required secrets** (via `secrets: inherit`): `JFROG_BASE64_TOKEN`, `JFROG_URL`, `JFROG_USER`, `DOT_NPMRC`, `GIT_USER_TOKEN`, `GIT_USER`, `GIT_USER_EMAIL`, optional `PERCY_TOKEN`. Permissions: `contents: write`.
- **Recovery**:
  - "Re-run failed jobs" on `release` publishes and releases the next patch, leaving the failed version as a dangling tag.
  - Re-running only `github-release` reuses the same tag and skips if the release already exists.
  - A forced dispatch releases even when nothing is affected.
- **Concurrency**: one run per branch at a time, non-cancelling. GitHub keeps only the newest pending run.
- **GitHub release**: created with `GITHUB_TOKEN`. The notes range starts at the previous tag of the same line, and "Latest" goes only to the highest `version/*` tag.

### Success Criteria:

#### Automated Verification:
- [ ] The section exists: `grep -c '^## FE Release Flow' README.md` = 1
- [ ] Every secret declared by the workflow is documented: `for s in $(sed -n '/^    secrets:/,/^env:/p' .github/workflows/fe-release-flow.yml | grep -oE '^      [A-Z_]+' | tr -d ' '); do grep -q "$s" README.md || echo "missing $s"; done` prints nothing
- [ ] Prettier is clean on the touched files: `npx prettier --check README.md .github/workflows/fe-release-flow.yml .github/workflow-templates/fe/fe-release.yml .github/actions tools/scripts/run-many tools/scripts/artifacts`
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 4 complete. Summary: README has an 'FE Release Flow' section (flow, caller migration incl. double-publish warning, trigger/force table, required secrets, recovery, concurrency, GitHub release). Please review README.md and reply 'yes' to continue to Phase 5." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] The README reads correctly for someone who migrates a consumer repo without having read design.md

---

## Phase 5: Review and PR into `release/25.4`

### Overview
Self-review the branch, then open the implementation PR against `release/25.4`. The PR must not target master; default detection would guess wrong.

### Changes Required:

#### 1. Self-review
Run `/review:branch-merge` (or the `code-review` skill) over `origin/release/25.4..HEAD`. Fix only the findings this change caused.

#### 2. PR [OUTWARD]
Push the branch and open the PR only after explicit user approval.
- Base: `release/25.4`. Title: `PFM-ISSUE-34283 - Consolidate the FE 2.0 release flow into a single workflow`.
- Body:
  - the building blocks (run-many `all`, tool release-flow mode + outputs, `fe-release-flow.yml`, install-deps concurrency removal, new caller template, README)
  - the link to PFM-ISSUE-34283
  - the "not in scope" list
  - a note that live validation is pending or manual
  - a note that the upmerges follow after merge

### Success Criteria:

#### Automated Verification:
- [ ] The PR targets `release/25.4`: `gh pr view --json baseRefName --jq .baseRefName` = `release/25.4`
- [ ] The PR's required checks (`pr-checks.yml`) pass: `gh pr checks`
- [ ] The full jest suite fails only in the 5 Windows baseline tests
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 5 complete. Summary: self-review done (findings fixed or listed), PR #<n> open against release/25.4. Please review the PR, and reply 'yes' once it is merged to continue to Phase 6 (upmerge chain)." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] The live validation from "Manual Testing Steps" was done or consciously deferred before merge
- [ ] The PR is reviewed and merged into `release/25.4`

---

## Phase 6: Upmerge Chain `26.1 → 26.2 → 26.3 → 26.4 → master`

### Overview
Carry the merged change up the chain as local merge commits (the repo's existing upmerge practice). Before committing each merge, rewrite the new file's refs and Node version for the target branch. On `26.4`, where the `[branch-off]` guard exists, resolve `handle()` so the guard runs first and add the test that it wins over force. Every push is **[OUTWARD]** and executed by the user after approval.

### Changes Required:

#### 1. Per target branch `T` (from source `S`): `26.1←25.4`, `26.2←26.1`, `26.3←26.2`, `26.4←26.3`, `master←26.4`
```bash
git fetch origin
git switch -C release/T origin/release/T          # for master: git switch -C master origin/master
git merge --no-commit origin/release/S
```
Resolve before committing:
- **Refs**:
  - in `.github/workflows/fe-release-flow.yml` and `.github/workflow-templates/fe/fe-release.yml`, rewrite `@release/S` → `@release/T` (`@master` for master)
  - check that the other files' refs stayed `@release/T` / `@master`
- **Node**: set `node-version:` in `fe-release-flow.yml` to the target's value (`22.15.0` for 26.1–26.3, `24.20.0` for 26.4/master). Take it from `.github/workflows/fe-release.yml` on `T`.
- **Conflicts**:
  - `fe-build.yml` / `fe-e2e.yml` / `fe-install-deps.yml`: keep the target's Node, image and pins, plus this change's additions or removal.
  - `fe-tag-pushed.yml` template: modified on `T` (refs) and deleted on `S`. Resolve as deleted.
  - Caller template: take `S`'s content with refs for `T`.
- **On `26.4` (and again on master)**, `artifacts-handler.ts` `handle()`: keep the `[branch-off]` guard block first, then the `releaseFlow` / `onlyBumpVersion` / publish dispatch. In `artifacts-handler-release-flow.test.ts`, add:
  - `[branch-off] tip commit with RELEASE_FLOW and FORCE → no git tag, no git push, no getAllNxProjects`. Mock `Utils.isBranchOffCommit` → `true`.
  - Make `mockBranch()` mock `isBranchOffCommit` → `false` for all other tests, as `artifacts-handler-tag.test.ts` does on these branches.
  - On master, the test arrives through the merge from 26.4.

Then commit the merge with git's default message (`Merge remote-tracking branch 'origin/release/S' into release/T`) and push after approval.

### Success Criteria:

#### Automated Verification (on each target branch after its merge):
- [ ] No ref from another branch remains in the new files: `grep -o 'github-actions/.github/[a-z]*/[a-z-]*\(.yml\)\?@[^ ]*' .github/workflows/fe-release-flow.yml .github/workflow-templates/fe/fe-release.yml | grep -vc '@<T-ref>$'` = 0
- [ ] The Node version matches the branch: `diff <(grep -o 'node-version: .*' .github/workflows/fe-release-flow.yml) <(grep -o 'node-version: .*' .github/workflows/fe-release.yml)` is empty
- [ ] The whole branch uses one internal ref: `grep -rhoE 'collaborationFactory/github-actions/\.github/[^@]+@[^ ]+' .github | sed 's/.*@//' | sort -u` prints only `release/T` (or `master`)
- [ ] The full jest suite fails only in the 5 Windows baseline tests (on 26.4/master, the branch-off test passes too: `npx jest -t 'branch-off'`)
- [ ] actionlint is clean for `fe-release-flow.yml`, `fe-build.yml`, `fe-e2e.yml`, `fe-install-deps.yml` and the caller template
- [ ] The chain is complete at the end: `git rev-list --count origin/master..origin/release/26.4` = 0, and the same for each adjacent pair
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 6 complete. Summary: upmerged 25.4 → 26.1 → 26.2 → 26.3 → 26.4 → master; per-branch refs and Node versions verified; [branch-off]-over-force test added on 26.4 and passing on 26.4 and master. Please review the merges and reply 'yes' to close out the plan." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] Each push was approved and executed by the user
- [ ] On master, the caller template references `@master` (the seed that branch-off rewrites to `@release/X.Y`)

---

## Testing Strategy

### Unit Tests:
- `affected-projects.test.ts`: explicit `all`, ref normalization (empty or undefined → `''`), the unchanged default when `ref === ''`, and job slicing.
- `artifacts-handler-release-flow.test.ts`:
  - tag/push commands, and the version passed to publish
  - publish happens after the push
  - the affected check, force bypass and skipped `nx affected`
  - first tag of a line, `previous_tag` / `is_latest` across lines
  - push failure, forced and non-forced default branch
  - no outputs from the old modes
  - on 26.4/master, `[branch-off]` wins over force
- `utils.test.ts`: a precomputed tag list avoids a second `ls-remote`.
- The existing `artifacts-handler-tag.test.ts` / `artifacts-handler.test.ts` pass unchanged (regression for unmigrated callers).

### Integration Tests:
- actionlint over the new workflow, the changed reusables and the caller template. It checks `needs` / outputs / inputs / secrets wiring.
- No automated live run (deferred; see below).

### Manual Testing Steps (live validation, done by the user before merging into `release/25.4` or later):
1. Push a `test/*` branch of github-actions whose internal refs point to `@test/…`, and a caller from the new template on a numeric throwaway release line (e.g. `release/99.1`) in the test repo. Never use a real `release/*` line.
2. One push → exactly one run:
   - it tags `version/99.1.1` and publishes all packages at `99.1.1` (dist-tag `release-99.1`)
   - the GitHub release has the right notes range and "Latest" flag
   - no tag-triggered run starts
3. Make the publish fail on purpose → a tag without a GitHub release. "Re-run failed jobs" publishes and releases `99.1.2`.
4. A dispatch without force → build and test only. A dispatch with force and nothing affected → releases. A dispatch on a feature branch → fails in `guard`.
5. Clean up: the test tags, GitHub releases and JFrog versions, and the test branches.

## Performance Considerations

- Forced and dispatched runs build, storybook and e2e **all** projects, which is much slower than an affected run. Watch the 120-minute `fe-e2e` timeout in large repos during the pilot (design risk 3). It isn't tuned in this plan.
- Removing the install-deps concurrency means superseded PR and main runs are no longer cut short. This costs CI minutes, not correctness (design trade-off 4).

## Migration Notes

- Unmigrated consumer branches keep the old two-run flow. `fe-tag.yml` / `workflows/fe-release.yml` stay functional on every github-actions branch.
- A consumer branch migrates with one commit: add `.github/workflows/fe-release.yml` from the template (with the ref for that branch), and delete both old caller files. That is the pilot PFM-ISSUE-34287 and the rollout after it. Both are out of scope here.
- Rollback: revert the merge on the affected github-actions branch. Unmigrated callers are unaffected either way. Migrated callers would need their old caller pair restored.

## References

- Research: [Research Document](./research.md)
- Design: [Design Document](./design.md)
- Original ticket: [PFM-ISSUE-34283](https://base.cplace.io/pages/3oujt03zx1awhafambsry1q90/PFM-ISSUE-34283-Consolidate-the-FE-2.0-release-flow-into-a-single-workflow)
- Test pattern: `tools/scripts/artifacts/artifacts-handler-tag.test.ts:1-114`
- Release job pattern: `.github/workflows/fe-release.yml:19-54`, `.github/workflows/fe-tag.yml:26-58`
- Tag logic to mirror: `tools/scripts/artifacts/artifacts-handler.ts:187-207` (master) / `:174-194` (25.4)
- Prior rollout plan: `specs/2026-06-05_node24-workflow-migration/plan.md`
