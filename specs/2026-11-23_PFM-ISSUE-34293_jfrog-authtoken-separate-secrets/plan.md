---
date: 2026-11-23
ticket: PFM-ISSUE-34293
topic: "Introduce separate JFrog user and token secrets (plain _authToken)"
status: draft
design: ./design.md
research: ./research.md
branch: improvement/PFM-ISSUE-34293-Introduce-separate-JFrog-user-and-token-secrets
---

# Separate JFrog User and Token Secrets (plain `_authToken`) Implementation Plan

## Overview

The artifacts tooling gets a second publish-credential mode. When `JFROG_TOKEN` is present, the generated dist `.npmrc` authenticates with `//<host>/<path>/:_authToken=${JFROG_TOKEN}`. The placeholder is written literally and npm expands it from the step env. When only the deprecated `JFROG_BASE64_TOKEN` is present, the legacy `_auth` file is written byte-for-byte as today, and the run gets a `::warning::` deprecation annotation. When neither is present in a mode that publishes or deletes, the run fails fast with an explicit `::error::`.

All seven reusable workflows that declare JFrog secrets declare `JFROG_TOKEN` and `JFROG_BASE64_TOKEN` as optional and pass both to the composite step. The FE starter templates switch to `JFROG_TOKEN`, and the README documents the secrets contract. Everything is validated live on `clone-cplace-fe` against `cplace-npm-test`.

Scope is the `github-actions` repository only. The pilot on `cplace-remote-filesystem-fe` and the rollout to the other FE repos follow this plan (see "Migration Notes").

## Current State Analysis

- `tools/scripts/artifacts/jfrog-credentials.ts:1-19` reads `JFROG_URL`, `JFROG_USER` and `JFROG_BASE64_TOKEN`, each defaulting to `''`. `getJfrogUrlNoHttp()` strips `https:` and produces a key with **no** trailing slash. No `JFROG_TOKEN` is read anywhere.
- `tools/scripts/artifacts/nx-project.ts:293-313`, `writeNPMRCInDist`, is the only writer of publish credentials. It writes four lines (`<scope>:registry=`, `_auth=`, `always-auth=true`, `email=`), each except the last ending in a literal space, and `console.log`s the full content at `:306`.
- `tools/scripts/artifacts/artifacts-handler.ts:105` logs `'Configuration ' + JSON.stringify(this)`. That serializes `jfrogCredentials`, including `base64Token`, and would include a new token field too. Only GitHub's secret masking hides it today.
- `artifacts-handler.ts:108-143`, `handle()`, dispatches after the branch-off early return (`:117-128`):
  - `releaseFlow` → `tagAndPublishRelease()`. It publishes only on `release/*` or with `force`, and writes the release-version file at `:285` *before* publishing.
  - `onlyBumpVersion` on `release/*` → bump only (`fe-tag`), which needs no credentials.
  - everything else → `buildAndPublishProjects()`, which publishes, or deletes when `onlyDeleteArtifacts` is set.
- `fe-release-flow.yml:102-106` runs the `release` job only for a push or `FORCE`. The release-flow "no force, non-release branch" no-op path is therefore never reached in CI.
- `tools/scripts/artifacts/cleanup-snapshots.ts:77-83`, `deleteSuperfluousArtifacts()`, is the delete entry point. `:88` constructs `JfrogCredentials`. The constructor's `npm search` / `npm view` calls use `~/.npmrc` (`DOT_NPMRC`), not the JFrog secrets.
- **Unset optional secrets arrive as empty strings.** `${{ secrets.X }}` for an optional secret the caller does not pass yields `''` in the step env, so presence must be decided by truthiness.
- Tests:
  - `test-data.ts:84-88` holds the legacy fixture.
  - Four `artifacts-handler*.test.ts` files set `JFROG_BASE64_TOKEN`, `JFROG_URL` and `JFROG_USER` at module level.
  - `cleanup-snapshots.test.ts` sets no `JFROG_*` env and runs the real `deleteArtifact`.
  - No test covers `jfrog-credentials.ts`.
  - CI (`pr-checks.yml`) runs shellcheck and bats but **not** jest or prettier, so the test suite runs locally with `npm test`. `npx prettier --check .` already reports 85 files on `master`, so the plan checks whitespace with `git diff --check` instead.
- Seven reusables declare `JFROG_BASE64_TOKEN: required: true`: `fe-snapshot`, `fe-pr-snapshot`, `fe-pr-close`, `fe-cleanup-snapshots`, `fe-release`, `fe-tag` and `fe-release-flow`. Between them they have eight `env:` blocks; `fe-release-flow` has two, at `:150-156` and `:187-193`. Four templates pass `JFROG_BASE64_TOKEN` explicitly: `fe-main.yml:54`, `fe-pr-snapshot.yml:20`, `fe-pr-close.yml:20` and `fe-cleanup-snapshots.yml:17`.

## Desired End State

- **Token present** (`JFROG_TOKEN` non-empty): the dist `.npmrc` is exactly
  ```
  <scope>:registry=<JFROG_URL>
  //<host>/<path>/:_authToken=${JFROG_TOKEN}
  ```
  It has no `always-auth` and no `email`. The key ends in exactly one `/` whatever the format of `JFROG_URL`. The log shows the publishing user and the literal placeholder, never a token value.
- **Only `JFROG_BASE64_TOKEN` present:** the legacy four-line file is unchanged, and the run carries the deprecation warning annotation.
- **Neither present**, in a publish or delete mode (snapshot, PR snapshot, PR close, release flow on `release/*` or forced, deprecated tag-push release, cleanup): the run fails before any build, publish, delete or release-version file, with an `::error::` that names `JFROG_TOKEN`. Bump-only (`fe-tag` on `release/*`) still succeeds without credentials.
- `JSON.stringify` of `JfrogCredentials` never contains `base64Token` or `token`.
- The seven reusables accept callers that pass `JFROG_TOKEN`, `JFROG_BASE64_TOKEN`, both or neither, with no workflow-level "required secret" error. The templates show `JFROG_TOKEN`, and the README documents every JFrog secret.
- The live matrix in `live-test-plan.md` passes on `clone-cplace-fe`, and its results are recorded in that file.

### Key Discoveries:
- `nx-project.ts:293-313` is the single `.npmrc` writer, and `deleteArtifact` (`:243-258`) reuses it when the dist directory is missing. PR close and cleanup therefore run through the same writer.
- `artifacts-handler.ts:105` is a second log path for credentials that the design does not mention. Redacting with `toJSON()` closes it for both secrets.
- `artifacts-handler.ts:285` writes the release-version file before publishing. The credential gate must run before it, or the workflow's failure cleanup (`fe-release-flow.yml:160-193`) would start an unpublish that fails a second time.
- `fe-release-flow.yml` callers use `secrets: inherit`, so on the release-flow path the clone's repository secrets alone decide which credential mode applies. The other reusables are selected by what the caller passes.
- Test style to follow is `nx-project.test.ts`: top-level `test(...)` blocks, `expect` from `@jest/globals`, `jest.spyOn` mocks, and names in the form "`<Subject>` can/does …".

## What We're NOT Doing

- No change to `DOT_NPMRC`, `use-npmrc`, install auth, the `npm search`/`npm view` calls in cleanup, or Bryntum auth.
- No removal of the legacy fallback, and `JFROG_TOKEN` is not made required. Both belong to the follow-up cleanup ticket.
- No removal of JFrog secret declarations from any reusable, including `fe-tag`.
- No change to `fe-release.yml` in the templates (it uses `secrets: inherit`), and no change to `JFROG_URL` or `JFROG_USER` declarations (they stay `required: true`).
- No backport to `release/26.4` or older lines.
- No minting of tokens or setting of secrets in any production FE repo. No edits to callers in FE repos: the pilot and rollout are follow-ups.
- `printenv` in the `artifacts`/`snapshots` composites stays as is. `JFROG_TOKEN` is a registered secret and is masked there like `JFROG_BASE64_TOKEN` today.
- No jest step added to `pr-checks.yml`.

## Implementation Approach

The first phase builds a thin vertical slice: token mode in `JfrogCredentials`, the token branch of the writer, the redaction, and `fe-snapshot.yml`. It is proven live with one token-only snapshot publish on `clone-cplace-fe` before anything else is built on it. That run settles the two least certain assumptions early: npm expands the literal placeholder from the step env, and JFrog accepts the reference token as Bearer.

Phase 2 adds the transition behavior (gate, warning, fail-fast) behind the same interfaces. Phase 3 extends the workflow change to the remaining reusables, the templates and the README. Phases 4 and 5 write and run the full live matrix.

All live runs use the 34283 harness: `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/clone-cplace-fe-live-tests.md`, Parts 1, 2 and 4. They target a github-actions test branch, `test/PFM-ISSUE-34293-jfrog-token`, which is the feature branch plus one commit that rewrites every internal `collaborationFactory/github-actions/...@master` ref in `.github/workflows` and `.github/actions` to `@test/PFM-ISSUE-34293-jfrog-token` (harness 1.3 step 5, preflight P2). That commit never lands on the feature branch.

Credential scenarios on the clone are selected by **caller edits**: which secret name the clone's caller passes. Secrets are only deleted where `secrets: inherit` leaves no other choice. Adding the `JFROG_TOKEN` secret to the clone is the one secret change every phase needs, and it requires the user's consent and value.

---

## Phase 1: Walking skeleton — token `.npmrc` for snapshot publish, proven live

### Overview
Introduce token mode end to end for the main-branch snapshot path: env → `JfrogCredentials` → dist `.npmrc` → `npm publish`. It runs live once, token-only, on `clone-cplace-fe`. The new test file's pattern is reviewed before more tests are written.

### Changes Required:

#### 1. Sample test (pattern gate — stop for review before step 2)
**File**: `tools/scripts/artifacts/jfrog-credentials.test.ts` (new)
**Changes**: Write only this one test first. Then call `AskUserQuestion`: "Sample test for jfrog-credentials.test.ts written (pattern: top-level `test`, env cleared in `afterEach`). Approve the pattern before the remaining tests are written?" Do not write further tests in this file until the user approves.

```ts
import { expect } from '@jest/globals';
import { JfrogAuthMode, JfrogCredentials } from './jfrog-credentials';

const JFROG_ENV = ['JFROG_URL', 'JFROG_USER', 'JFROG_TOKEN', 'JFROG_BASE64_TOKEN'];

afterEach(() => {
  JFROG_ENV.forEach((name) => delete process.env[name]);
  jest.restoreAllMocks();
});

test('JfrogCredentials uses the token when JFROG_TOKEN and JFROG_BASE64_TOKEN are both set', () => {
  process.env.JFROG_TOKEN = 'jfrog_token';
  process.env.JFROG_BASE64_TOKEN = 'jfrog_base64_token';

  expect(new JfrogCredentials().authMode).toBe(JfrogAuthMode.TOKEN);
});
```

#### 2. Token mode, auth key, redaction
**File**: `tools/scripts/artifacts/jfrog-credentials.ts`
**Changes**: Read `JFROG_TOKEN`. Add `JfrogAuthMode` and an `authMode` getter that decides by truthiness, so an empty string counts as absent. Add `getAuthKey()` (normalized nerf-dart key with exactly one trailing slash) and `toJSON()` redaction. `getJfrogUrlNoHttp()` and the existing fields stay unchanged; the legacy writer still uses them.

```ts
export enum JfrogAuthMode {
  TOKEN = 'TOKEN',
  LEGACY = 'LEGACY',
  NONE = 'NONE',
}

export class JfrogCredentials {
  /** written literally into the dist .npmrc; npm expands it from the step env */
  public static readonly TOKEN_PLACEHOLDER = '${JFROG_TOKEN}';
  public url = '';
  public user = '';
  public base64Token = '';
  public token = '';

  constructor() {
    // ...existing url/user/base64Token reads unchanged...
    this.token = process.env.JFROG_TOKEN != undefined ? process.env.JFROG_TOKEN : '';
  }

  /** an optional secret the caller does not pass arrives as '', so presence is truthiness */
  public get authMode(): JfrogAuthMode {
    if (this.token) return JfrogAuthMode.TOKEN;
    if (this.base64Token) return JfrogAuthMode.LEGACY;
    return JfrogAuthMode.NONE;
  }

  public getJfrogUrlNoHttp(): string {
    return this.url.replace('https:', '');
  }

  /** npm looks credentials up by the registry's nerf-dart, which ends in exactly one '/' */
  public getAuthKey(): string {
    return this.getJfrogUrlNoHttp().replace(/\/+$/, '') + '/';
  }

  /** keeps secrets out of JSON.stringify, e.g. the handler's "Configuration" log line */
  public toJSON() {
    return { url: this.url, user: this.user, authMode: this.authMode };
  }
}
```

#### 3. Token branch of the dist `.npmrc` writer
**File**: `tools/scripts/artifacts/nx-project.ts` (`writeNPMRCInDist`, `:293-313`)
**Changes**: In token mode, write the two lines with the literal placeholder and log the publishing identity. Every other mode uses the existing four-line code **unchanged**: move it into an `else` without touching the strings. The `console.log(this.npmrcContent)` and file-write lines stay shared.

```ts
public writeNPMRCInDist(jfrogCredentials: JfrogCredentials, scope: string) {
  if (jfrogCredentials.authMode === JfrogAuthMode.TOKEN) {
    this.npmrcContent =
      `${scope}:registry=${jfrogCredentials.url}\n` +
      `${jfrogCredentials.getAuthKey()}:_authToken=${JfrogCredentials.TOKEN_PLACEHOLDER}`;
    console.log(`Publishing as JFrog user ${jfrogCredentials.user} with JFROG_TOKEN`);
  } else {
    // legacy _auth path: byte-for-byte unchanged (existing lines 294-305)
  }
  console.log(this.npmrcContent + '\n\n');
  // ...existing mkdir + writeFileSync unchanged...
}
```

#### 4. Token fixture and remaining Phase 1 tests
**File**: `tools/scripts/artifacts/test-data.ts`
**Changes**: Add a token fixture next to `npmrc`, which stays untouched.

```ts
export const npmrcToken =
  '@cplace-frontend-applications:registry=jfrog_url\n' +
  'jfrog_url/:_authToken=${JFROG_TOKEN}';
```

**File**: `tools/scripts/artifacts/jfrog-credentials.test.ts`
**Changes**: Add after the sample is approved:
- `authMode` is `LEGACY` with only `JFROG_BASE64_TOKEN`, and `NONE` with neither.
- `authMode` is `NONE` when both are set to `''`, which is how workflows pass unset optional secrets.
- `getAuthKey()` returns `//cplace.jfrog.io/artifactory/cplace-npm-test/` for `JFROG_URL` without a trailing slash, with one, and with `//`.
- `JSON.stringify(new JfrogCredentials())` contains neither the token nor the base64 value.

**File**: `tools/scripts/artifacts/nx-project.test.ts`
**Changes**: Add `NxProject writes a token .npmrc when JFROG_TOKEN is set`. It sets `JFROG_URL=https://cplace.jfrog.io/artifactory/cplace-npm-test/` and `JFROG_TOKEN=secret_value`, then calls `writeNPMRCInDist` with fs mocked as in the existing tests. It asserts:
- the content equals the two expected lines with the literal placeholder;
- the content does not contain `secret_value`, `always-auth` or `email`;
- `fs.writeFileSync` received the same content.

Clear the env in the file's `afterEach`.

**File**: `tools/scripts/artifacts/artifacts-handler.test.ts`
**Changes**: Add `can write the token .npmrc for Snapshots in main branch`. It mirrors `can create and overwrite Snapshots in main branch` with `JFROG_TOKEN = 'jfrog_token'` set and expects `npmrcContent` to equal `npmrcToken`. Add `delete process.env.JFROG_TOKEN` to `afterEach`. The existing legacy assertion (`:145-146`, `npmrc`) stays and must keep passing.

#### 5. `fe-snapshot.yml` wiring
**File**: `.github/workflows/fe-snapshot.yml`
**Changes**: Declare `JFROG_TOKEN` and make `JFROG_BASE64_TOKEN` optional (`:12-18`). Pass both in the `artifacts` step env (`:43-46`).

```yaml
    secrets:
      JFROG_TOKEN:
        required: false
      # deprecated, replaced by JFROG_TOKEN; used only when JFROG_TOKEN is not passed
      JFROG_BASE64_TOKEN:
        required: false
      JFROG_URL:
        required: true
      JFROG_USER:
        required: true
...
        env:
          JFROG_TOKEN: ${{ secrets.JFROG_TOKEN }}
          JFROG_BASE64_TOKEN: ${{ secrets.JFROG_BASE64_TOKEN }}
          JFROG_URL: ${{ secrets.JFROG_URL }}
          JFROG_USER: ${{ secrets.JFROG_USER }}
```

#### 6. Live smoke: token-only snapshot publish on `clone-cplace-fe`
**Repos**: `collaborationFactory/github-actions` (test branch), `collaborationFactory/clone-cplace-fe`
**Changes**:
1. Create `test/PFM-ISSUE-34293-jfrog-token` from the feature branch, plus the ref-rewrite commit (harness 1.3 step 5). Run harness preflight P2 (refs point to the test branch) and P3 (test branch is current). **Stop for user confirmation before every push** (harness 2.1).
2. **Stop for consent:** the user sets the `JFROG_TOKEN` secret on `clone-cplace-fe`. The value is a reference token of the clone's `JFROG_USER` with deploy, delete and annotate rights on `cplace-npm-test`. The agent never handles the value.
3. On the clone's `main`, point the caller of `fe-snapshot.yml` at `@test/PFM-ISSUE-34293-jfrog-token`, and replace its `JFROG_BASE64_TOKEN:` line with `JFROG_TOKEN: ${{ secrets.JFROG_TOKEN }}`. Push a change that affects at least one publishable project. The 34282 `live-test-plan.md` M1 shows the procedure.
4. Capture the run with the harness `capture` helper (2.2).

### Success Criteria:

#### Automated Verification:
- [x] The sample test was approved by the user before any other test in `jfrog-credentials.test.ts` was written
- [x] Unit tests pass: `npm test` (all new tests pass; the 8 failures in `utils`, `artifacts-handler-tag` and `nx-project` also fail on `master` on Windows: path separators and local env)
- [x] No whitespace errors in the change: `git diff --check master` is empty (a repo-wide `prettier --check` is not usable: 85 files on `master` already fail it)
- [x] Legacy fixture unchanged: `git diff master -- tools/scripts/artifacts/test-data.ts` shows only added lines
- [x] `fe-snapshot.yml` declares `JFROG_TOKEN` and `JFROG_BASE64_TOKEN` as `required: false` and passes both: `grep -A1 -E '^      JFROG_(BASE64_)?TOKEN:$' .github/workflows/fe-snapshot.yml` shows `required: false` twice, and `grep -c 'secrets.JFROG_TOKEN' .github/workflows/fe-snapshot.yml` is `1`
- [x] The feature branch contains no test-branch refs: `git grep -n '@test/' -- .github` is empty
- [x] Live smoke run on `clone-cplace-fe` concluded `success`. Its log contains `_authToken=${JFROG_TOKEN}` literally, `Publishing as JFrog user`, a `+ @cplace-next/` publish line and `"authMode":"TOKEN"`. It contains no `Failed to replace env in config` and no `"token":` / `"base64Token":` keys. The published version exists in `cplace-npm-test` (harness AQL check)
  - _Result 2026-11-24: run [45430072566](https://github.com/collaborationFactory/clone-cplace-fe/actions/runs/45430072566) ("Frontend Main CI", `success`, all jobs `success`). Trigger: on the clone's `main`, `push_main.yaml`'s snapshot caller switched to `@test/PFM-ISSUE-34293-jfrog-token` with `JFROG_TOKEN` in place of `JFROG_BASE64_TOKEN`, plus upstream `cplace-fe` #2991 replayed (it touches `cf-frontend-sdk`). The user set `JFROG_TOKEN` on the clone (and on all FE repos) on 2026-11-24. Snapshot job log: `_authToken=${JFROG_TOKEN}` ×21, `Publishing as JFrog user *** with JFROG_TOKEN` ×21, 21 `+ @cplace-next/…@0.0.0-SNAPSHOT-mwuw5lai-20261124` lines, `"jfrogCredentials":{"url":"***","user":"***","authMode":"TOKEN"}`. No `Failed to replace env in config`, `"token":`, `"base64Token":`, `always-auth` or `:_auth=` lines. AQL finds all 21 tarballs in `cplace-npm-test`, deployed by the token's owner. `cf-frontend-sdk` dist-tag `snapshot` → `0.0.0-SNAPSHOT-mwuw5lai-20261124`._
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 1 complete. Summary: token mode, auth-key normalization and redaction in JfrogCredentials; token branch in writeNPMRCInDist; fe-snapshot.yml accepts JFROG_TOKEN; token-only snapshot publish succeeded live on clone-cplace-fe (run <id>). Please review the changes and reply 'yes' to continue to Phase 2." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [x] In the smoke run's job log, the dist `.npmrc` printout has exactly two lines, and the registry/key part is masked as `***` while `_authToken=${JFROG_TOKEN}` stays readable
  - _Observed in run 45430072566: two lines; `@cplace-next:registry=***` is masked, but the key line shows `//cplace.jfrog.io/artifactory/api/npm/cplace-npm-test/` in clear. The key is `JFROG_URL` without `https:`, so it isn't a substring match of the secret. Legacy mode prints its `getJfrogUrlNoHttp()` keys the same way (harness P5 relies on these unmasked paths). The repository URL isn't a credential. Accepted by the user at the Phase 1 checkpoint._
- [x] The installed snapshot (`npm view @cplace-next/<pkg>@<version>` against `cplace-npm-test`) has the expected tag `snapshot`

---

## Phase 2: Credential gate, deprecation warning, fail-fast

### Overview
Restore the protection that `required: true` gave, scoped to the modes that publish or delete, and make unmigrated callers visible. The gate runs once per run, before any work.

### Changes Required:

#### 1. Gate on the credentials class
**File**: `tools/scripts/artifacts/jfrog-credentials.ts`
**Changes**: Add `requireForPublishing()`, which emits the annotation for the selected mode and throws when nothing can authenticate.

```ts
public static readonly LEGACY_WARNING =
  'JFROG_BASE64_TOKEN is deprecated: set the JFROG_TOKEN repository secret and pass ' +
  'JFROG_TOKEN instead of JFROG_BASE64_TOKEN to the github-actions FE workflows (PFM-ISSUE-34293).';
public static readonly MISSING_ERROR =
  'No JFrog credentials: pass the JFROG_TOKEN secret (or the deprecated JFROG_BASE64_TOKEN) ' +
  'to this workflow. Publishing and deleting npm artifacts needs one of them.';

/** call once per run, before anything is published or deleted */
public requireForPublishing(): void {
  switch (this.authMode) {
    case JfrogAuthMode.TOKEN:
      return;
    case JfrogAuthMode.LEGACY:
      console.log(`::warning::${JfrogCredentials.LEGACY_WARNING}`);
      return;
    default:
      console.log(`::error::${JfrogCredentials.MISSING_ERROR}`);
      throw new Error(JfrogCredentials.MISSING_ERROR);
  }
}
```

#### 2. Mode-scoped gate in the handler
**File**: `tools/scripts/artifacts/artifacts-handler.ts`
**Changes**: Insert the gate in `handle()` after the branch-off early return (after `:128`) and before the dispatch. Add a private predicate that mirrors the dispatch order exactly. The thrown error rejects `handle()`, and the unhandled rejection in `main.ts` exits non-zero.

```ts
    if (this.requiresPublishCredentials())
      this.jfrogCredentials.requireForPublishing();
    if (this.releaseFlow) {
...

  /** mirrors the dispatch in handle(): only bump-only and the release flow's no-op path need no credentials */
  private requiresPublishCredentials(): boolean {
    const onReleaseBranch = this.currentBranch.startsWith(
      ArtifactsHandler.RELEASE_BRANCH_PREFIX
    );
    if (this.releaseFlow) return onReleaseBranch || this.force;
    if (this.onlyBumpVersion && onReleaseBranch) return false;
    return true;
  }
```

#### 3. Gate in cleanup
**File**: `tools/scripts/artifacts/cleanup-snapshots.ts`
**Changes**: Construct `JfrogCredentials` once, as a field. Call `requireForPublishing()` at the top of `deleteSuperfluousArtifacts()`, before the loop, and pass the field to `removeSnapshotArtifacts` instead of creating new credentials at `:88`.

#### 4. Tests
**File**: `tools/scripts/artifacts/jfrog-credentials.test.ts`
**Changes**:
- `requireForPublishing` logs no annotation in token mode.
- It logs exactly one `::warning::` with `LEGACY_WARNING` in legacy mode.
- It logs `::error::` and throws `MISSING_ERROR` with neither set.

Use `jest.spyOn(console, 'log')` for the logging checks.

**File**: `tools/scripts/artifacts/artifacts-handler.test.ts`
**Changes**: Add `refuses to delete artifacts when a Pull Request is closed without JFrog credentials`. It sets `JFROG_BASE64_TOKEN = ''` with no `JFROG_TOKEN`, then expects `exec()` to reject with `No JFrog credentials` and `deleteArtifactSpy` not to have been called. Restore `JFROG_BASE64_TOKEN = 'jfrog_base64_token'` in `afterEach`.

**File**: `tools/scripts/artifacts/artifacts-handler-tag.test.ts`
**Changes**: Add a bump-only test on `release/5.18` with both secrets cleared that still tags and pushes. Restore the env in `afterEach`.

**File**: `tools/scripts/artifacts/artifacts-handler-release-flow.test.ts`
**Changes**: Add:
- A release flow on `release/26.4` without credentials rejects with `No JFrog credentials`, and neither publish nor `Utils.writeReleaseVersionFile` is called.
- A non-forced release flow on `main` without credentials resolves and publishes nothing.

Restore the env in `afterEach`.

**File**: `tools/scripts/artifacts/cleanup-snapshots.test.ts`
**Changes**:
- Set `process.env.JFROG_URL` and `process.env.JFROG_TOKEN` for the existing test, which now needs credentials to reach deletion.
- Add `refuses to delete snapshots without JFrog credentials`: neither secret set, `deleteSuperfluousArtifacts()` rejects, and no `npm unpublish` call goes to `execSync`.

### Success Criteria:

#### Automated Verification:
- [x] Unit tests pass: `npm test` (117 tests; only the 8 failures that also fail on `master` on Windows. Mutation check: without the gate calls, the PR-close, release and cleanup gate tests fail)
- [x] No whitespace errors in the change: `git diff --check master` is empty (a repo-wide `prettier --check` is not usable: 85 files on `master` already fail it)
- [x] Gate called exactly once per entry point: `grep -c 'requireForPublishing()' tools/scripts/artifacts/artifacts-handler.ts tools/scripts/artifacts/cleanup-snapshots.ts` prints `1` for each
- [x] `cleanup-snapshots.ts` constructs `JfrogCredentials` once: `grep -c 'new JfrogCredentials' tools/scripts/artifacts/cleanup-snapshots.ts` is `1`
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 2 complete. Summary: requireForPublishing (token silent / legacy ::warning:: / none ::error:: + throw) gated by mode in ArtifactsHandler.handle() and CleanupSnapshots.deleteSuperfluousArtifacts(); bump-only and the release flow's no-op path stay credential-free; unit tests cover all cases. Please review the changes and reply 'yes' to continue to Phase 3." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] The warning and error texts read clearly in a GitHub annotation and name the exact secret to set

---

## Phase 3: Remaining reusables, templates, README

### Overview
Apply the `fe-snapshot.yml` pattern from Phase 1 to the other six reusables. Point the templates at `JFROG_TOKEN`, and document the secrets contract.

### Changes Required:

#### 1. Reusable workflows
**Files**:
- `.github/workflows/fe-pr-snapshot.yml` (declarations `:9-17`, env `:67-70`)
- `.github/workflows/fe-pr-close.yml` (`:9-17`, `:49-52`)
- `.github/workflows/fe-cleanup-snapshots.yml` (`:5-13`, `:43-46`)
- `.github/workflows/fe-release.yml` (`:5-13`, `:53-56`)
- `.github/workflows/fe-tag.yml` (`:12-24`, `:55-58`)
- `.github/workflows/fe-release-flow.yml` (`:15-29`; env in **both** `artifacts` steps, `:150-156` and `:187-193`)

**Changes**: Identical to Phase 1 §5. Add `JFROG_TOKEN: required: false` above `JFROG_BASE64_TOKEN`, switch `JFROG_BASE64_TOKEN` to `required: false` with the same deprecation comment, and add `JFROG_TOKEN: ${{ secrets.JFROG_TOKEN }}` above every `JFROG_BASE64_TOKEN:` env line. `JFROG_URL`, `JFROG_USER` and all other secrets are unchanged.

#### 2. Templates
**Files**: `.github/workflow-templates/fe/fe-main.yml:54`, `fe-pr-snapshot.yml:20`, `fe-pr-close.yml:20`, `fe-cleanup-snapshots.yml:17`
**Changes**: Replace `JFROG_BASE64_TOKEN: ${{ secrets.JFROG_BASE64_TOKEN }}` with `JFROG_TOKEN: ${{ secrets.JFROG_TOKEN }}`. `fe-release.yml` (`secrets: inherit`) is unchanged.

#### 3. README
**File**: `README.md` ("Required secrets", `:83-91`)
**Changes**:
- In the inherit list, replace `JFROG_BASE64_TOKEN` with `JFROG_TOKEN`.
- Add a subsection with the secrets contract that applies to all FE workflows:

```markdown
#### JFrog and npm secrets (all FE workflows)

| Secret | Content | Used for |
| --- | --- | --- |
| `JFROG_URL` | URL of the npm repository artifacts are published to (`cplace-npm-local`); a trailing slash does not matter | `<scope>:registry=`, `publishConfig.registry`, `--registry=` and the credential key of the generated dist `.npmrc` |
| `JFROG_USER` | JFrog user that owns `JFROG_TOKEN` | logged as the publishing identity; not used for authentication |
| `JFROG_TOKEN` | JFrog reference token of `JFROG_USER` with deploy, delete and annotate rights on `cplace-npm-local` | publish, unpublish, `npm show` and `dist-tag`: written literally as `_authToken=${JFROG_TOKEN}` into the dist `.npmrc` and expanded by npm at runtime |
| `JFROG_BASE64_TOKEN` | **Deprecated.** `base64(user:secret)` | `_auth` in the dist `.npmrc`, only when `JFROG_TOKEN` is not passed; the run shows a deprecation warning |
| `DOT_NPMRC` | a complete `.npmrc` | installs (`npm ci`), `npm search`/`npm view` in snapshot cleanup, third-party registries; never used for publishing |

To migrate a repository: set the `JFROG_TOKEN` secret (and make `JFROG_USER` its owner), then replace the
`JFROG_BASE64_TOKEN:` line with `JFROG_TOKEN: ${{ secrets.JFROG_TOKEN }}` in every caller. Workflows called
with `secrets: inherit` pick it up without an edit. Keep the `JFROG_BASE64_TOKEN` repository secret while a
release branch still passes it. A publishing or deleting run without either secret fails with "No JFrog
credentials".
```

### Success Criteria:

#### Automated Verification:
- [x] No whitespace errors in the change: `git diff --check master` is empty (a repo-wide `prettier --check` is not usable: 85 files on `master` already fail it)
- [x] Unit tests still pass: `npm test` (117 tests, only the 8 `master`-on-Windows failures; `actionlint` reports the same findings on the FE workflows as on `master`)
- [x] Every reusable that declares `JFROG_BASE64_TOKEN` also passes `JFROG_TOKEN`: `for f in $(grep -l 'JFROG_BASE64_TOKEN:' .github/workflows/*.yml); do grep -q 'secrets.JFROG_TOKEN' "$f" || echo "MISSING $f"; done` prints nothing
- [x] Env blocks are paired: `grep -c 'secrets.JFROG_TOKEN' .github/workflows/*.yml` sums to the same total as `grep -c 'secrets.JFROG_BASE64_TOKEN' .github/workflows/*.yml` (8)
- [x] No reusable requires either credential: `grep -A1 -E '^      JFROG_(BASE64_)?TOKEN:$' .github/workflows/*.yml | grep -c 'required: true'` is `0`
- [x] No template passes the deprecated secret: `grep -rn 'JFROG_BASE64_TOKEN' .github/workflow-templates` is empty
- [x] The feature branch contains no test-branch refs: `git grep -n '@test/' -- .github` is empty
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 3 complete. Summary: the six remaining reusables accept JFROG_TOKEN (optional) next to the now-optional JFROG_BASE64_TOKEN and pass both; four templates pass JFROG_TOKEN; README documents the JFrog/npm secrets contract and migration. Please review the changes and reply 'yes' to continue to Phase 4." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] The README table renders correctly on GitHub, and the migration paragraph is enough for a repo owner to switch without reading the code

---

## Phase 4: Write the live test plan

### Overview
Write the executable live matrix as `specs/2026-11-23_PFM-ISSUE-34293_jfrog-authtoken-separate-secrets/live-test-plan.md`. Structure and level of detail follow `specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/live-test-plan.md`. The environment, execution model, helpers, JFrog rule and teardown are taken by reference from the 34283 harness (Parts 1, 2 and 4) instead of being copied.

### Changes Required:

#### 1. `live-test-plan.md`
**File**: `specs/2026-11-23_PFM-ISSUE-34293_jfrog-authtoken-separate-secrets/live-test-plan.md` (new)
**Changes**: The document must contain:
- **Expected change:** what 34293 changes in a run, i.e. the dist `.npmrc` format per mode, the annotations, the fail-fast, and the redacted `Configuration` line.
- **Environment:**
  - a read-only state check of `clone-cplace-fe`: its secrets, including `JFROG_TOKEN` from Phase 1, and the callers and their refs;
  - test branch `test/PFM-ISSUE-34293-jfrog-token`, recreated if stale (P3);
  - placeholders added to the harness ones.
- **Scenario selection rules:**
  - Explicit-secret callers (`fe-snapshot`, `fe-pr-snapshot`, `fe-pr-close`, `fe-cleanup-snapshots`) select token-only, legacy-only or neither **by editing the clone's caller**: which secret line it passes.
  - The release flow uses `secrets: inherit`. For its legacy-only case, temporarily switch the clone's `release/26.4` caller to explicit secrets that omit `JFROG_TOKEN`, and revert afterwards. Never delete the clone's `JFROG_TOKEN` secret for this.
  - Any secret change on the clone is a stop for the user's consent.
- **Cases**, each with trigger, expected end state and evidence:

  | ID | Mode | Flow | Proves |
  |---|---|---|---|
  | T1 | token | main snapshot (`fe-snapshot`) | publish (re-run of the Phase 1 smoke on the final branch) |
  | T2 | token | PR snapshot (`fe-pr-snapshot`), labelled PR pushed twice | `npm show` + unpublish + republish of the same version with Bearer auth |
  | T3 | token | PR close (`fe-pr-close`) on T2's PR | unpublish via the "dist missing" path of `deleteArtifact`, the same path cleanup uses |
  | T4 | token | release flow push on `release/26.4` with a real change | publish under the staging tag, then `dist-tag add`/`rm` promote |
  | T5 | token | cleanup (`fe-cleanup-snapshots`, dispatch or schedule) | gate + search; deletion only if a snapshot in `cplace-npm-test` is ≥ 4 months old, otherwise deletion is covered by T3 (record which) |
  | T6 (optional) | token | release flow with induced publish failure (harness A8 method) | failure-cleanup unpublish |
  | L1 | legacy | main snapshot | legacy path still publishes; `::warning::` annotation present; dist `.npmrc` printout has the four legacy lines |
  | L2 | legacy | PR snapshot + PR close | legacy unpublish still works with the warning |
  | L3 | legacy | release flow via explicit-secrets caller | legacy release + promote still works with the warning |
  | N1 | neither | main snapshot | run fails before `npm run`/build, with the `::error::` annotation; nothing published |
  | N2 | neither | PR close | fails before any `npm unpublish` |

- **Evidence common to all token cases:**
  - the log contains `_authToken=${JFROG_TOKEN}` and `"authMode":"TOKEN"`;
  - no `"token":`, `"base64Token":`, `always-auth` or `Failed to replace env in config`;
  - every version the run touched is checked by exact path in `cplace-npm-test` (harness 4.2).
- **Pass criteria for the ticket** (mapped to the design's success criteria), a **report** section to be filled in Phase 5, and **teardown**:
  - revert the clone's callers to `@master`;
  - delete the test branch, with a stop;
  - the clone's `JFROG_TOKEN` secret stays.

### Success Criteria:

#### Automated Verification:
- [x] `live-test-plan.md` exists and lists every case ID: `for id in T1 T2 T3 T4 T5 L1 L2 L3 N1 N2; do grep -q "| $id " specs/2026-11-23_PFM-ISSUE-34293_jfrog-authtoken-separate-secrets/live-test-plan.md || echo "MISSING $id"; done` prints nothing
- [x] No whitespace errors: `git diff --check master -- specs/2026-11-23_PFM-ISSUE-34293_jfrog-authtoken-separate-secrets/` is empty
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 4 complete. Summary: live-test-plan.md written with cases T1–T6, L1–L3, N1–N2 on clone-cplace-fe, scenario selection by caller edits, consent stops for secret changes. Please review the live test plan and reply 'yes' to continue to Phase 5 (execution)." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] Every case can be triggered and evaluated from the document and the harness alone, without guessing
- [ ] No case writes to `cplace-npm-local`, a real FE repo, or a real `release/*` branch outside the clone

---

## Phase 5: Run the live matrix

### Overview
Run `live-test-plan.md` against the final feature branch, through a recreated test branch, and record the results in its report section. Fix any defect found on the feature branch, then repeat the affected cases.

### Changes Required:

#### 1. Execution
**Repos**: `collaborationFactory/clone-cplace-fe`, `collaborationFactory/github-actions` (test branch only)
**Changes**: Run the preflight and then the cases in the order the document gives. Follow the harness stops: every github-actions push, every secret change and every deletion waits for user confirmation. Capture each run with the harness helpers into the scratchpad results directory.

#### 2. Report
**File**: `specs/2026-11-23_PFM-ISSUE-34293_jfrog-authtoken-separate-secrets/live-test-plan.md` (report section)
**Changes**: For each case, record the run id and link, the conclusion, the evidence lines, the versions touched in `cplace-npm-test` and their cleanup state, and any deviation.

#### 3. Teardown
Execute the document's teardown steps, with a stop before each.

_2026-11-25: deferred by user decision until the feature branch is merged. The clone callers stay on the test branch (token mode), and the test branch stays. After the merge: callers to `@master` with `JFROG_TOKEN`, then delete the test branch (each a stop; live-test-plan.md §7)._

### Success Criteria:

#### Automated Verification:
- [x] Every case in the report section has a run id and a verdict: `grep -cE '^\| (T[1-6]|L[1-3]|N[12]) .*\| (pass|fail|skipped) ' specs/2026-11-23_PFM-ISSUE-34293_jfrog-authtoken-separate-secrets/live-test-plan.md` is at least `10`
- [x] The token cases T1–T5 and the neither cases N1–N2 are recorded as `pass` (T5 accepted as a pre-existing deviation by the user, see note)
  - _2026-11-25: T1–T4, N1, N2 `pass` (T4 with deviation D1: `github-release` skipped by a pre-existing `master` bug with `RUN_E2E: false`; GitHub releases created by hand, separate ticket per user decision). **T5 `fail`**: blocked by pre-existing deviation D2 (the cleanup's search crashes on `npm view` E404 before the gate; upstream production cleanup fails the same way since 2026-07). Accepted by the user on 2026-11-25 as a pre-existing deviation, to be fixed in a separate ticket. L1–L3 `pass`, T6 `skipped` (user decision). Details: live-test-plan.md §6._
- [x] Unit tests still pass on the final branch: `npm test` (117 tests; only the 8 failures that also fail on `master` on Windows)
- [x] The feature branch contains no test-branch refs: `git grep -n '@test/' -- .github` is empty
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 5 complete. Summary: live matrix executed on clone-cplace-fe — <n> pass / <n> fail / <n> skipped, report recorded in live-test-plan.md, teardown done. Please review the report and reply 'yes' to close the plan." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] Spot-check one token run and one legacy run log in the GitHub UI: the annotation summary and the dist `.npmrc` printout match the report
- [ ] No leftover versions from the tests remain in `cplace-npm-test` beyond those the report deliberately keeps

---

## Testing Strategy

### Unit Tests:
- `JfrogCredentials`:
  - mode selection: token only, legacy only, both (token wins), neither, and empty strings;
  - `getAuthKey()` with no trailing slash, one and several;
  - `toJSON()` redaction;
  - `requireForPublishing()` annotations and throw.
- `NxProject.writeNPMRCInDist`: exact two-line token content with the literal placeholder, and no token value, `always-auth` or `email`. The legacy fixture assertions are unchanged.
- `ArtifactsHandler`:
  - token `.npmrc` on the snapshot path;
  - fail-fast in PR close and in the release flow on `release/*`, before the release-version file is written;
  - no credentials needed for bump-only on `release/*` or the non-forced release flow on `main`.
- `CleanupSnapshots`: succeeds with a token, fails fast with neither.

### Integration Tests:
- Live matrix on `clone-cplace-fe` → `cplace-npm-test` (Phases 1 and 5): every npm command run from the dist directory (`publish`, `show`, `unpublish`, `dist-tag add`/`rm`) in token mode, the legacy regression with the warning, and the fail-fast with neither.

### Manual Testing Steps:
1. Phase 1 smoke: token-only snapshot publish on the clone.
2. Phase 5: the T, L and N cases from `live-test-plan.md`.
3. Read one annotation of each kind (warning, error) in the GitHub run summary.

## Performance Considerations

None. The change adds one in-memory check per run and changes the content of a two-to-four-line file.

## Migration Notes

**Rollback:** revert the merge commit on `master`. While repos still pass `JFROG_BASE64_TOKEN`, they keep working on the revert.

A repo that has already switched its callers to `JFROG_TOKEN` would fail after a revert: `JFROG_BASE64_TOKEN` is required again, and `JFROG_TOKEN` is no longer declared. Such a repo must revert its own caller edit too. Only the pilot is at risk during the pilot window.

**Follow-ups after merge (not part of this plan, operational):**
1. **Pilot `cplace-remote-filesystem-fe`:**
   - set `JFROG_TOKEN`, and make `JFROG_USER` the token's owner (user, existing token tooling);
   - replace `JFROG_BASE64_TOKEN:` with `JFROG_TOKEN:` in every caller on the default branch;
   - verify a snapshot publish from the default branch.
2. **Remaining 13 FE repos:** the same steps per repo, preserving today's service-account grouping (design Decision 2). This also fixes the `JFROG_USER` mismatches in office-reports, workflow and project-planning.
3. **Entry check for the cleanup ticket:** a cross-repo search of the 14 FE repos' default branches finds no `JFROG_BASE64_TOKEN` reference.
4. **Cleanup ticket (to be created, design Next Steps 3):**
   - remove the legacy fallback and `JFROG_BASE64_TOKEN` declarations;
   - make `JFROG_TOKEN` required;
   - delete the repo secrets only after the last referencing release line is out of support.

## References

- Research: [Research Document](./research.md)
- Design: [Design Document](./design.md)
- Original ticket: [PFM-ISSUE-34293](https://base.cplace.io/pages/writuvh8xnwnf0bzeo6c6u2hc/PFM-ISSUE-34293-Introduce-separate-JFrog-user-and-token-secrets-plain-auth-token)
- Live harness: `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/clone-cplace-fe-live-tests.md`
- Live-test-plan precedent: `specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/live-test-plan.md`
- Similar implementation: `tools/scripts/artifacts/nx-project.ts:293-313`, `tools/scripts/artifacts/jfrog-credentials.ts:1-19`
- Test pattern: `tools/scripts/artifacts/nx-project.test.ts`
