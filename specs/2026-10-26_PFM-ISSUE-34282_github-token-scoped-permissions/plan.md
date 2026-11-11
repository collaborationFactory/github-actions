---
date: 2026-11-11
branch: improvement/PFM-ISSUE-34282-Use-GITHUB_TOKEN-with-scoped-permissions-for
git_commit: 87feb8e4218d9fe87791883f9f683ddca3106e05
topic: "PFM-ISSUE-34282 - Use GITHUB_TOKEN with scoped permissions for in-repo tag and release"
tags: [plan, github-actions, fe-release-flow, github-token, permissions, pat]
status: draft
---

# Use GITHUB_TOKEN with scoped permissions for in-repo tag and release - Implementation Plan

## Overview

The consolidated FE release flow (`fe-release-flow.yml`, PR #183) pushes its `version/X.Y.Z` tag with the
built-in `GITHUB_TOKEN` instead of the shared user PAT `GIT_USER_TOKEN`. The `release` job gets
`contents: write` and nothing else. `GIT_USER_TOKEN` leaves the flow's secret contract. The template header,
README and the 34283 Q10 note describe the new state. The live test plan is aligned with the design and run in
`clone-cplace-fe`.

## Current State Analysis

- The only PAT use on the tag/release path is the `release` job checkout:
  `token: ${{ secrets.GIT_USER_TOKEN }}` (`.github/workflows/fe-release-flow.yml:117-121`). Checkout persists
  it in `.git/config`. The artifacts tool's `git push origin <tag>` (`tools/scripts/artifacts/artifacts-handler.ts:313`)
  and the cleanup's `git ls-remote --exit-code` (`fe-release-flow.yml:176`) use it implicitly.
- The `release` job declares `contents: read` (`fe-release-flow.yml:110-111`). That works only because the PAT,
  not `GITHUB_TOKEN`, carries the push.
- `GIT_USER_TOKEN` is declared `required: true` in `workflow_call.secrets` (`fe-release-flow.yml:24-25`).
- Every other job already narrows: `guard`, `install-deps`, `build`, `e2e` = `contents: read`;
  `github-release` = `contents: write` with `GH_TOKEN: ${{ github.token }}` (`:198-222`).
- The caller template grants `permissions: contents: write` and passes `secrets: inherit`
  (`.github/workflow-templates/fe/fe-release.yml:18-19`, `:32`). Its header (`:1-5`) still says the flow
  "pushes the tag with the PAT".
- README describes the PAT tag push (`README.md:54-59`), lists `GIT_USER_TOKEN` as required (`:86-88`), and
  says only the GitHub release uses `GITHUB_TOKEN` (`:146`).
- `actionlint` (`/c/Users/VladimirArsov/go/bin/actionlint`) is installed and passes on the current flow.
- The only spec file on the branch is `live-test-plan.md`. It still lists design decisions as open (section 1
  "There is no design or plan yet", rows D2/D5/D7, section 7) and has stale README line references in D9.

## Desired End State

- `fe-release-flow.yml`: no `GIT_USER_TOKEN` anywhere; `release` job `permissions: contents: write` only; the
  release checkout has no `token:` and keeps `fetch-depth: 0`; guard check unchanged, guard comment reworded.
- No scope other than `contents` is granted anywhere in `fe-release-flow.yml`.
- The deprecated reusables `fe-tag.yml` and `workflows/fe-release.yml`, the `fe-main.yml` template, the TS
  artifacts tool and the "Configure git user" step are unchanged.
- Template header and README describe the `GITHUB_TOKEN` tag push, the secret list has no `GIT_USER_TOKEN`,
  and README has a tag-ruleset note. The 34283 design's Q10 bullet carries the same ruleset note.
- `live-test-plan.md` matches the design; the live series has run in `clone-cplace-fe` with the results
  recorded.
- `research.md`, `design.md` and `plan.md` are committed on the branch.

Verify with the automated checks of each phase and with the live test plan (Phase 4).

### Key Discoveries:
- Pattern for the checkout: `.github/workflows/fe-snapshot.yml:26-29` (34285 precedent, commit `faa4771`):
  `actions/checkout` with `ref` and `fetch-depth: 0`, no `token:`.
- Pattern for the secret contract: `fe-snapshot.yml:12-18` after 34285 (the declaration is simply removed).
- The caller grant is a ceiling: requesting a scope the caller does not grant fails every migrated consumer at
  startup (research §4). `contents: write` is already granted, so the switch needs no caller change.
- `secrets: inherit` means an undeclared secret is simply not passed (research §4); removing the declaration
  needs no caller change.
- The guard still has a purpose after the switch: an old tag-push caller would publish manually pushed tags,
  and an old `fe-tag.yml` caller would tag in parallel with the PAT (design, "Docs, template header and guard
  wording").
- Q10 exists in the 34283 design only as the out-of-scope bullet at
  `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/design.md:97`.
- Commit message style on this branch: `PFM-ISSUE-34282 - <Imperative sentence>` plus the `Co-Authored-By`
  trailer.

## What We're NOT Doing

- Isolating the write token from third-party code (`persist-credentials: false` with a push-only credential,
  or a separate tag-push job).
- A pre-publish push-rights or ruleset check.
- Removing the "Configure git user" step or `GIT_USER` / `GIT_USER_EMAIL` (PFM-ISSUE-34286).
- Narrowing `fe-main.yml` or the other FE templates' permissions (PFM-ISSUE-35504), including the stale
  `actions: write` in cplace-fe `push_main.yaml`.
- Changing the deprecated `fe-tag.yml` / `workflows/fe-release.yml` reusables.
- Changing the guard's check or its error message.
- Changing the TS artifacts tool.
- JFrog secret changes; the backend credential-store approach.
- Deleting `GIT_USER_TOKEN` from any production repo.

## Implementation Approach

Three edits in one job of `fe-release-flow.yml` make the switch; everything else is wording. The workflow
change comes first and is verified statically. Docs and the live test plan follow, since the live test plan's
preflight P12 checks the docs (D9) as part of the expected state. The end-to-end proof is the live series in
`clone-cplace-fe` (Phase 4): phases 2 and 3 change no runtime behaviour, so it directly follows the code
change.

The spec documents are committed in Phase 1 so the branch carries research, design and plan for review.

---

## Phase 1: Workflow change

### Overview
Switch the `release` job to the persisted default `GITHUB_TOKEN` with `contents: write`, drop
`GIT_USER_TOKEN` from the secret contract, reword the guard comment. Commit the spec documents.

### Changes Required:

#### 1. Spec documents
**Files**: `specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/research.md`, `design.md`, `plan.md`
**Changes**: Commit all three (they are untracked; `research.md` was removed from the branch in `0d0206b` and
is re-added on the user's decision). Separate commit from the workflow change, e.g.
`PFM-ISSUE-34282 - Add research, design and implementation plan`. Do not add `dist/`.

#### 2. Secret contract
**File**: `.github/workflows/fe-release-flow.yml`
**Changes**: Remove the `GIT_USER_TOKEN` declaration (`:24-25`). `GIT_USER`, `GIT_USER_EMAIL`, JFrog,
`DOT_NPMRC` and `PERCY_TOKEN` stay.

```yaml
      DOT_NPMRC:
        required: true
      GIT_USER:
        required: true
      GIT_USER_EMAIL:
        required: true
      PERCY_TOKEN:
        required: false
```

#### 3. `release` job permissions and checkout
**File**: `.github/workflows/fe-release-flow.yml`
**Changes**: `contents: read` → `contents: write` (`:110-111`); remove `token:` from the checkout (`:121`).

```yaml
    runs-on: ubuntu-latest
    permissions:
      contents: write
    outputs:
      ...
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
        with:
          ref: ''
          fetch-depth: 0
```

No other step of the job changes: the identity step stays (34286), the artifacts step and the cleanup use the
persisted credential.

#### 4. Guard comment
**File**: `.github/workflows/fe-release-flow.yml`
**Changes**: Reword the comment at `:59-61`. The "fail on the tags of this flow" part goes (those tags no longer
trigger anything). The `run:` script, including the error message, stays byte-identical.

```yaml
      # an old tag-push caller would publish manually pushed version/* tags; an old fe-tag.yml caller
      # (branch push) would tag in parallel with the PAT. Any trigger counts, comment lines do not
      # (a commented-out caller is not active).
```

Commit the workflow change separately, e.g.
`PFM-ISSUE-34282 - Push the release tag with GITHUB_TOKEN instead of the PAT`.

### Success Criteria:

#### Automated Verification:
- [x] `actionlint .github/workflows/fe-release-flow.yml` reports no error
- [x] `git grep -n GIT_USER_TOKEN -- .github/workflows/fe-release-flow.yml` is empty
- [x] The only `write` scope lines in the flow are in `release` and `github-release`, and no scope other than
      `contents` appears: `grep -nE '^\s+(contents|checks|pull-requests|issues|actions|packages|id-token|statuses|deployments):' .github/workflows/fe-release-flow.yml`
      lists six `contents:` lines (`guard`, `install-deps`, `build`, `e2e` = `read`; `release`,
      `github-release` = `write`) and nothing else
- [x] No checkout in the flow passes a token: `grep -n 'token:' .github/workflows/fe-release-flow.yml` (case-sensitive,
      so `GH_TOKEN:` / `PERCY_TOKEN:` do not match) is empty, and the `release` checkout still has `fetch-depth: 0`
- [x] The guard script is unchanged: `git diff origin/improvement/PFM-ISSUE-34283-Consolidate-the-FE-2-0-release-flow-into-a-master -- .github/workflows/fe-release-flow.yml`
      touches only the secret declaration, the guard comment lines, the `release` permission and the checkout `token:` line
- [x] Deprecated reusables, `fe-main.yml`, `fe-snapshot.yml` and the artifacts tool unchanged against PR #183:
      `git diff --stat origin/improvement/PFM-ISSUE-34283-Consolidate-the-FE-2-0-release-flow-into-a-master -- .github/workflows/fe-tag.yml .github/workflows/fe-release.yml .github/workflow-templates/fe/fe-main.yml .github/workflows/fe-snapshot.yml tools/ .github/actions/`
      is empty
- [x] `research.md`, `design.md` and `plan.md` are tracked: `git ls-files specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions`
      lists all four spec files; `git ls-files dist` is empty
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 1 complete. Summary: release job now `contents: write` with the persisted default token, `GIT_USER_TOKEN` removed from the secret contract, guard comment reworded, spec documents committed. Please review the changes and reply 'yes' to continue to Phase 2." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] The diff of `fe-release-flow.yml` reads as the three-line switch plus the comment, nothing else

---

## Phase 2: Docs, template header and 34283 Q10 note

### Overview
Describe the `GITHUB_TOKEN` tag push everywhere the PAT push is described; add the tag-ruleset note.

### Changes Required:

#### 1. Caller template header
**File**: `.github/workflow-templates/fe/fe-release.yml`
**Changes**: Replace `:1-5`. Nothing below the header changes (`contents: write` ceiling, concurrency,
`secrets: inherit` stay).

```yaml
# Replaces the old two-file release (this file as tagger + fe-tag-pushed.yml / on_tag_pushed.yaml / tag_pushed.yml).
# Delete BOTH old caller files in the same commit that adds this one: a tag-push workflow left in the tree
# would release manually pushed version/* tags, and an old fe-tag.yml caller would tag in parallel. The
# release flow's guard job fails while an old caller exists. The flow pushes its tag with GITHUB_TOKEN,
# which starts no workflow.
```

#### 2. README migration note
**File**: `README.md`
**Changes**: Replace the sub-bullets of step 2 (`:54-59`).

```markdown
2. **Delete the old release callers**: `fe-release.yml` as tagger, plus `fe-tag-pushed.yml` /
   `on_tag_pushed.yaml` / `tag_pushed.yml`.
   - The release flow pushes its tag with `GITHUB_TOKEN`, which starts no workflow. A tag-push
     workflow left in the tree would still release manually pushed `version/*` tags, and an old
     `fe-tag.yml` caller would tag in parallel.
   - The `guard` job fails while any workflow of the branch still calls `workflows/fe-release.yml` or
     `workflows/fe-tag.yml`.
```

#### 3. README required secrets
**File**: `README.md`
**Changes**: Replace `:86-88`.

```markdown
Passed with `secrets: inherit`: `JFROG_BASE64_TOKEN`, `JFROG_URL`, `JFROG_USER`, `DOT_NPMRC`,
`GIT_USER`, `GIT_USER_EMAIL`, and optionally `PERCY_TOKEN`. The caller needs
`permissions: contents: write`; the flow grants it only to the `release` and `github-release` jobs.

The tag is pushed with `GITHUB_TOKEN`; the flow does not use `GIT_USER_TOKEN`. The deprecated
`fe-tag.yml` and `workflows/fe-release.yml` still need it: remove it from a repo only once none of
its branches calls them.
```

#### 4. README tag-ruleset note
**File**: `README.md`
**Changes**: New subsection between "Required secrets" and "Recovery".

```markdown
### Tag rulesets

The tag is pushed as GitHub Actions (`GITHUB_TOKEN`), after publish and promote. A ruleset that
restricts `version/*` tags must list GitHub Actions as a bypass actor. Otherwise the push is
rejected, the cleanup unpublishes the version, and the promoted packages lose `release-X.Y` (see
"Promote or tag push failed" under Recovery).
```

#### 5. README GitHub release section
**File**: `README.md`
**Changes**: `:146` "Created with `GITHUB_TOKEN`." → "Created with `GITHUB_TOKEN`, like the tag."

#### 6. 34283 Q10 note
**File**: `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/design.md`
**Changes**: Extend the out-of-scope bullet at `:97`.

```markdown
- A `version/*` tag ruleset or a tag-triggered recovery path (Q10, deferred). Since PFM-ISSUE-34282 the
  tag is pushed with `GITHUB_TOKEN`: such a ruleset must list GitHub Actions as a bypass actor, otherwise
  the push is rejected after publish and promote.
```

Commit, e.g. `PFM-ISSUE-34282 - Describe the GITHUB_TOKEN tag push in the docs`.

### Success Criteria:

#### Automated Verification:
- [ ] No PAT tag-push wording left: `grep -nE 'with the PAT|GIT_USER_TOKEN|removes the tag-push trigger' README.md .github/workflow-templates/fe/fe-release.yml`
      returns only the README sentence that the deprecated reusables still need `GIT_USER_TOKEN`
- [ ] README has the ruleset note: `grep -n '### Tag rulesets' README.md` matches, placed before `### Recovery`
- [ ] Template body unchanged below the header: `git diff origin/improvement/PFM-ISSUE-34283-Consolidate-the-FE-2-0-release-flow-into-a-master -- .github/workflow-templates/fe/fe-release.yml`
      touches only lines 1-5
- [ ] `actionlint` does not apply to templates; check the template still parses: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflow-templates/fe/fe-release.yml'))"`
      (or any YAML parser available) exits 0
- [ ] 34283 design carries the note: `grep -n 'bypass actor' specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/design.md` matches
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 2 complete. Summary: template header, README (migration note, secrets, new Tag rulesets section, GitHub release line) and the 34283 Q10 note now describe the GITHUB_TOKEN tag push. Please review the changes and reply 'yes' to continue to Phase 3." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] README "FE Release Flow" reads consistently top to bottom (What it does → Migration → Secrets → Tag rulesets → Recovery)

---

## Phase 3: Align the live test plan with the design

### Overview
Turn the open points of `live-test-plan.md` into the settled expectations, so the plan can run unchanged.

### Changes Required:

#### 1. Expected state
**File**: `specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/live-test-plan.md`
**Changes**:
- Frontmatter: `last_updated` to the edit date.
- Section 1 intro: replace "There is no design or plan yet … section 7)" with a sentence that the expected
  state follows `design.md` and `plan.md` in the same directory (link both).
- D2: `contents: write` only.
- D5: kept for PFM-ISSUE-34286 (unchanged).
- D7: unchanged (PFM-ISSUE-35504).
- D9: `README.md:54-59`, `:86-88`, new "Tag rulesets" section, `:146`; guard **comment** (message unchanged);
  34283 design Q10 note.

#### 2. Rules and cases
**File**: same
**Changes**:
- T1: drop "(+ only design additions)" and "unless the design lists them".
- T3 (rule): remove the row (the identity step stays).
- Setup T3 (prepare `main`): drop "If 34282 changes `fe-main.yml` (D7) …".
- M1: drop the "If D7 changed the template" bullet and the "(possibly narrowed)" / "the D7 block if 34282
  narrows the template" wording; M1 is a plain regression check.
- R6: drop the last bullet (`GIT_USER*` deletion).
- T1–T4 references in the case table and cases become T1, T2, T4.
- Section 7: replace the open points with a short "Settled by the design" list: `release` = `contents: write`
  only; identity step kept (T3 and the `GIT_USER*` part of R6 do not apply); `fe-main.yml` unchanged (M1 is a
  regression check); persisted default credential (open point 4 dropped).

Commit, e.g. `PFM-ISSUE-34282 - Align the live test plan with the design`.

### Success Criteria:

#### Automated Verification:
- [ ] No open-decision wording left: `grep -nE 'design\*|There is no design|depend on a decision|If D5|If D7|only design additions|unless the design' specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/live-test-plan.md`
      is empty
- [ ] No reference to rule T3: `grep -nE '\bT3\b' …/live-test-plan.md` matches only the setup step "T3: Prepare `main`"
      and its references
- [ ] D9's README line references (PR #183 state) point at the PAT/secret text that Phase 2 replaced: check each
      cited range with `git show origin/improvement/PFM-ISSUE-34283-Consolidate-the-FE-2-0-release-flow-into-a-master:README.md | sed -n '<range>p'`
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 3 complete. Summary: live-test-plan.md now states the settled expectations (release = contents: write only, identity kept, fe-main unchanged); rule T3 and the GIT_USER* part of R6 removed; section 7 replaced. Please review the changes and reply 'yes' to continue to Phase 4 (live tests in clone-cplace-fe)." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] Section 1's Expected column matches the Phase 1 and Phase 2 diffs row by row

---

## Phase 4: Live validation in `clone-cplace-fe`

### Overview
Run `live-test-plan.md` against the branch. It is the end-to-end proof that the tag and release work with
`GITHUB_TOKEN` and that nothing else regressed. Follow the plan exactly; it reuses the 34283 live-test document
(LT) for environment, helpers, preflight and expected-state rules.

### Changes Required:

#### 1. Setup (live-test-plan section 2.3)
- **T1**: build `test/PFM-ISSUE-34282-github-token` from the pushed feature branch (rewrite internal `@master`
  refs, drop e2e). **Stop before the push to `github-actions`** (LT 2.1). Requires phases 1-3 pushed to the
  feature branch first, which is also a stop.
- **T2**: switch the release caller on `release/26.4` → case R0.
- **T3**: prepare `main` (new caller, delete old callers, `push_main.yaml` refs) → case M0.
- **T4**: preflight LT P1-P11 plus P1m, P12-P15.

#### 2. Cases (live-test-plan section 4), in order, one at a time
R0, M0, **R1**, **M1**, **M2**, R2, R3, R4, R5. R6 only after the user explicitly agrees to delete the
`GIT_USER_TOKEN` secret of `clone-cplace-fe` (stop). Compute `N` per case from its before-snapshot.

A failed row stops the series: record it, fix on the feature branch, recreate the test branch (T1), rerun from
the failed case (live-test-plan section 5). No teardown beyond throwaway branches (project memory); delete the
`github-actions` test branch only after the user confirms.

#### 3. Results
**File**: `$OUT/results.md` (live-test working directory, per LT) and the PR #189 description
**Changes**: case table, PAT vs. `GITHUB_TOKEN` comparison, `main` permissions per job, deviations with evidence
(live-test-plan section 6). Copy the case table and comparison into the PR description.

### Success Criteria:

#### Automated Verification:
- [ ] Preflight P12-P15 pass (static diff matches D1-D9, `GIT_USER_TOKEN` absent on the test branch flow,
      actionlint clean, `default_workflow_permissions: read`)
- [ ] R0: no startup failure, no `Secret GIT_USER_TOKEN is required` annotation (T4)
- [ ] R1/R2/R3 attempt 2: RELEASE(N) E1-E8 with E7 Phase B (no run of any workflow for `version/N`), T1
      (`release` = `Contents: write`, `Metadata: read` only), T2 (no auth error in the `release` log)
- [ ] R3 attempt 1: `ls-remote` exit code 2 path taken (`was not pushed: unpublishing its artifacts`), all
      `*-N.tgz` removed
- [ ] M1/M2: S1-S5; M2 `release` holds `Contents: write`, no `git push` in its log
- [ ] R4: idempotent re-run, recreated release authored by `github-actions[bot]`
- [ ] R5: rejected at startup, no job started
- [ ] R6 (if agreed): RELEASE(N) with the secret deleted
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 4 complete. Summary: live series in clone-cplace-fe [list cases and verdicts, run ids]; results recorded in results.md and the PR description. Please review the results and reply 'yes' to finish." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] The R1 GitHub release and tag look right in the `clone-cplace-fe` UI (lightweight tag on the pushed SHA,
      release notes range `version/26.4.7...version/26.4.8`)
- [ ] The PR #189 description carries the case table and the PAT vs. `GITHUB_TOKEN` comparison

---

## Testing Strategy

### Unit Tests:
- None. The TS artifacts tool is unchanged; the change is workflow YAML and docs.

### Static checks:
- `actionlint` on `fe-release-flow.yml`; greps for `GIT_USER_TOKEN` and granted scopes; `git diff` against the
  PR #183 branch to prove the deprecated reusables, `fe-main.yml`, `fe-snapshot.yml` and the tool are untouched.

### Integration Tests:
- The live series in `clone-cplace-fe` (Phase 4): release on `release/26.4` (R1-R4), main CI and forced
  release-flow dispatch on `main` (M0-M2), the permission ceiling (R5), and optionally a release without the
  PAT secret (R6).

### Manual Testing Steps:
1. After R1, confirm there is no canary run for `version/26.4.8` and the `release` job's
   `GITHUB_TOKEN Permissions` group shows `Contents: write`, `Metadata: read`.
2. After R3 attempt 1, confirm the cleanup log took the exit-code-2 branch.
3. After R5, confirm the startup error names `release` and `github-release`.

## Performance Considerations

None. The job structure and step count are unchanged.

## Migration Notes

- Migrated consumers need no change: the template's `contents: write` ceiling and `secrets: inherit` already
  cover the switch. The change reaches them when `fe-release-flow.yml@master` is updated (after PR #183 and this
  PR are merged).
- Unmigrated consumers keep using the deprecated reusables with the PAT.
- A repo can drop `GIT_USER_TOKEN` once none of its branches calls the deprecated reusables (README).
- Rollback: revert the Phase 1 workflow commit; the PAT secret is still present in every repo.

## References

- Research: [Research Document](./research.md)
- Design: [Design Document](./design.md)
- Live test plan: [live-test-plan.md](./live-test-plan.md)
- Original ticket: [PFM-ISSUE-34282](https://base.cplace.io/pages/p9vu89ujy61fxb2nrrp6focwy/PFM-ISSUE-34282-Use-GITHUB-TOKEN-with-scoped-permissions-for-in-repo-tag-and-release)
- Base: [34283 design](../2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/design.md), [34283 live tests](../2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/clone-cplace-fe-live-tests.md)
- Similar implementation: `.github/workflows/fe-snapshot.yml:12-18`, `:26-29` (PFM-ISSUE-34285, commit `faa4771`)
