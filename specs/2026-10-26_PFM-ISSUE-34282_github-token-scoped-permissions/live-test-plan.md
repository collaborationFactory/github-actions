---
date: 2026-11-10
last_updated: 2026-11-10
branch: improvement/PFM-ISSUE-34282-Use-GITHUB_TOKEN-with-scoped-permissions-for (on top of PR #183)
topic: "Live test plan for PFM-ISSUE-34282 - GITHUB_TOKEN with scoped permissions for in-repo tag and release"
tags: [live-test, test-plan, clone-cplace-fe, fe-release-flow, fe-main, github-token, permissions, cplace-npm-test]
status: draft
---

# Live test plan: PFM-ISSUE-34282 in `clone-cplace-fe`

This plan validates the PFM-ISSUE-34282 implementation **after** it exists. It runs on the test fork `collaborationFactory/clone-cplace-fe` and publishes only to the JFrog test registry `cplace-npm-test`.

**The two core tests:**
- **M: a workflow on `main`.** A push to `main` runs the main CI (snapshot of the affected projects). A forced release-flow dispatch on `main` publishes a snapshot of all projects through the changed `release` job.
- **R: the release workflow on `release/26.4`.** A push with a real change publishes, tags with `GITHUB_TOKEN` and creates the GitHub release in one run.

The supporting cases cover the paths the token switch can break: forced release, failure cleanup, the `github-release` re-run, the permission ceiling, and a run without the PAT secret.

**What this plan reuses.** The test environment, tools, helper library, preflight, expected-state rules and JFrog rules are defined in the 34283 live-test document from PR #183: [`clone-cplace-fe-live-tests.md`](../2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/clone-cplace-fe-live-tests.md) (abbreviated **LT** below, e.g. "LT 2.2" is its helper library). This plan does not repeat them. It lists only the deltas for 34282 and the cases to run. LT Phase B (B0–B7) is the earlier sketch for this ticket. This plan replaces it: it adds the `main` cases and binds the expectations to the current repository state.

**Workflow baseline.** All workflow references are to the PR #183 state (branch `improvement/PFM-ISSUE-34283-Consolidate-the-FE-2-0-release-flow-into-a-master`, head `4666f60`):
- `.github/workflows/fe-release-flow.yml`: jobs `guard`, `install-deps`, `build`, `e2e`, `release`, `github-release`.
- `.github/workflow-templates/fe/fe-release.yml`: the caller, `permissions: contents: write`, `secrets: inherit`.
- `.github/workflow-templates/fe/fe-main.yml` → `.github/workflows/fe-snapshot.yml`: the main CI.

---

## 1. What 34282 is expected to change

The expected state follows the ticket's requirements, applied to the PR #183 workflows. There is no design or plan yet. **Before running, compare this table with the final implementation and fix the "Expected" column.** The rows marked *design* depend on a decision that is still open (section 7).

| ID | Item | PR #183 state | Expected after 34282 |
|---|---|---|---|
| D1 | `release` job checkout | `token: ${{ secrets.GIT_USER_TOKEN }}` (`fe-release-flow.yml:121`) | no `token:` (default `github.token`), still `fetch-depth: 0` |
| D2 | `release` job permissions | `contents: read` (`:110-111`) | `contents: write` (plus only what the design adds, section 7) |
| D3 | `GIT_USER_TOKEN` in `workflow_call.secrets` | `required: true` (`:24-25`) | removed |
| D4 | Other jobs | `guard`/`install-deps`/`build`/`e2e` `contents: read`, `github-release` `contents: write` | unchanged |
| D5 | "Configure git user" step and `GIT_USER`/`GIT_USER_EMAIL` | present (`:143-149`, `:26-29`) | *design*: kept for 34286, or removed |
| D6 | Caller template `fe-release.yml` | `contents: write`; header says the PAT pushes the tag | `contents: write` unchanged; header comment updated |
| D7 | `fe-main.yml` template (four-scope block) | `contents/pull-requests: write`, `actions: read`, `checks: write` | *design*: unchanged, or narrowed |
| D8 | Deprecated `fe-tag.yml`/`fe-release.yml` (reusables) | PAT-based | unchanged (old consumers keep working) |
| D9 | README (`:43-48`, `:71-73`) and guard message | describe the PAT tag push | updated |

---

## 2. Test environment

### 2.1 State on 2026-11-10 (read-only check)

| Item | Value |
|---|---|
| Branches | `main`, `release/26.4`, `release/26.3` (LT A12), `fix/PFM-ISSUE-35119-…` (leftover) |
| Version tags | `version/26.3.1`, `version/26.4.1` … `version/26.4.7` |
| Latest release run (PAT baseline) | `42292826750` (LT A8 retest, `26.4.7`), canary run `42297425544` as actor `squad-fe` |
| `release/26.4` | migrated: `fe-release.yml` → `fe-release-flow.yml@test/PFM-ISSUE-34283-release-flow`; canary `zz-tag-push-canary.yml` present; tip `5d1491344` |
| `main` | **not migrated**: `push_to_release.yaml` and `on_tag_pushed.yaml` still present. `push_main.yaml` calls `fe-install-deps`/`fe-build`/`fe-snapshot` `@master`, with `permissions: contents: read, actions: write`. Tip `54ca47f60` |
| `main` push triggers | `push_main.yaml` only. `sonar-scan.yml`, `deploy_storybook.yaml`, `auto-pr-upmerge.yml` are manual. `xray-scan.yml` triggers on `package.json`/`package-lock.json` changes only, so a commit touching those files must not be pushed to `main` |
| Teardown | None wanted (test repo; see the project memory). Throwaway branches are still deleted inside their case |

The next release on `26.4` is therefore `26.4.8`.

**Not usable as evidence:** the repository activity API (`repos/$R/activity`) lists branch pushes but no tag pushes (checked 2026-11-10). Like the events API (LT 1.4), it cannot prove who pushed a tag. The canary (LT 1.6 S1) remains the proof.

### 2.2 Placeholders (in addition to LT)

| Name | Value |
|---|---|
| `TEST_BRANCH` | `test/PFM-ISSUE-34282-github-token` |
| `FB` | the 34282 feature branch (`improvement/PFM-ISSUE-34282-…`) |
| `BR` | `release/26.4` |
| `MB` | `main` |

### 2.3 Setup steps

Every push to `github-actions` is a stop (LT 2.1). Pushes to `clone-cplace-fe` are allowed.

**T1: Build the test branch** (stop: push).
1. `git switch -c $TEST_BRANCH origin/$FB` in `github-actions`.
2. Commit 1: rewrite every internal ref to the test branch (`.github/workflows` and `.github/actions` only, not `workflow-templates`):
   ```bash
   grep -rlE 'collaborationFactory/github-actions/\.github/.+@master' .github/workflows .github/actions \
     | xargs sed -i "s#\(collaborationFactory/github-actions/\.github/[^@]*\)@master#\1@$TEST_BRANCH#g"
   ```
3. Commit 2: remove the e2e job, as in 34283 commit `b8ca5b4`: try `git cherry-pick b8ca5b4`; on conflict redo it by hand (drop the `e2e` job and the `RUN_E2E` input, `release.needs: build`, drop the `needs.e2e` condition).
4. Push. Run LT P2 and P3 against `$TEST_BRANCH`/`$FB`.
5. Recreate the test branch whenever `FB` changes (P3 detects it).

**T2: Switch the release caller on `BR`** (= LT S2).
- One commit on `BR`: in `.github/workflows/fe-release.yml`, change `@test/PFM-ISSUE-34283-release-flow` to `@$TEST_BRANCH`. Copy the header comment from the 34282 template (D6). Change nothing else.
- Its push starts a release run with nothing affected: that run is case **R0**.

**T3: Prepare `main`** (= LT S3, plus the main CI switch). One commit on `MB`, no other file:
- Add `.github/workflows/fe-release.yml` from the 34282 template, `uses:` → `@$TEST_BRANCH`.
- Delete `push_to_release.yaml` and `on_tag_pushed.yaml` (otherwise the guard fails every `main` dispatch).
- In `push_main.yaml`, change the three `@master` refs to `@$TEST_BRANCH`. If 34282 changes `fe-main.yml` (D7), apply its `permissions:` block to `push_main.yaml` as well. Keep the fork's test-job removal.
- Check that the commit touches neither `package.json` nor `package-lock.json` (xray).
- Its push starts the main CI: that run is case **M0**.

**T4: Preflight.** Run LT P1–P11 with the new `TEST_BRANCH`, plus:

| ID | Check | Pass |
|---|---|---|
| P1m | `uses:` lines of `fe-release.yml` and `push_main.yaml` on `MB` | all `@$TEST_BRANCH` |
| P12 | Static diff `git diff origin/improvement/PFM-ISSUE-34283-…-master...origin/$FB -- .github README.md` | matches section 1 (D1–D9). No other workflow change. `fe-tag.yml` and `fe-release.yml` (reusables) untouched |
| P13 | `git grep -n GIT_USER_TOKEN origin/$TEST_BRANCH -- .github/workflows/fe-release-flow.yml` | empty |
| P14 | `actionlint` on `fe-release-flow.yml` of `$TEST_BRANCH` | no error |
| P15 | `gh api repos/$R/actions/permissions/workflow` | `default_workflow_permissions: read` (so any write must come from a job block) |

### 2.4 Helper for snapshot versions

LT 2.2 `snapshot()` filters snapshot tarballs out. For the `main` cases, add this to `$OUT/lib.sh`:

```bash
# snap_tgz <since-iso> <file>: @cplace-next snapshot tarballs created since the given time
snap_tgz() {
  jf rt curl $J -s -XPOST /api/search/aql -H 'Content-Type: text/plain' -d \
    "items.find({\"repo\":\"cplace-npm-test\",\"path\":{\"\$match\":\"@cplace-next/*/-/@cplace-next\"},\"name\":{\"\$match\":\"*-0.0.0-SNAPSHOT-*.tgz\"},\"created\":{\"\$gte\":\"$1\"}}).include(\"path\",\"name\",\"created\")" \
    | jq -r '.results[] | "\(.path|split("/")[1])\t\(.name)\t\(.created)"' | sort > "$2"
}
```

### 2.5 Replay commits

| Use | Upstream SHA | Kind | Subject | Projects |
|---|---|---|---|---|
| R1 (on `BR`) | `e2d33835d4b` | squash #2969 | 35090 Rich Text Editor too small | cf-editor-lib (LT 1.5 #5) |
| spare (on `BR`) | `4b83e9883e5` | merge #3010 | 35135 split ai-companion e2e | `-m 1`; adds apps (LT 1.5 #6) |
| M1 (on `MB`) | `97b45e73a1f` | squash #2971 | 34987 display aggregation rows in table | cf-frontend-sdk, libs/api, cf-e2e-testing-sdk |
| spare (on `MB`) | `7e81a3a8442` | squash #2991 | 35098 shared component for aggregations | cf-frontend-sdk, libs/api, cf-shell-lib |

`main`'s fork point is upstream `320b61b22`; `#2989` is already replayed. The two upmerges `db7584e5a4f`/`750142f686a` were skipped. If `97b45e73a1f` conflicts outside fork-setup files, stop (LT replay rules). Recompute with `git log --first-parent --reverse 320b61b22..upstream/main` before use.

---

## 3. Expected-state rules

Use the LT 3.1 rules **RELEASE(N)** (E1–E8), **NO-RELEASE** (N1–N2) and **REJECTED** (X1–X2), with **E7 in its Phase B form**: no run of any workflow for `version/N`. Wait at least 3 minutes after the tag push before evaluating E7.

Additional rules for this ticket:

**T: token and authentication** (every case that runs the `release` job)

| Row | Rule | Evidence |
|---|---|---|
| T1 | Each job log's `GITHUB_TOKEN Permissions` group lists exactly: `guard`/`install-deps`/`build (*)` → `Contents: read`, `Metadata: read`. `release` → `Contents: write`, `Metadata: read` (+ only design additions). `github-release` → `Contents: write`, `Metadata: read`. No `Checks`, `PullRequests`, `Issues`, `Actions` unless the design lists them | LT B2 extraction command |
| T2 | No authentication error in the `release` job log: no `Authentication failed`, `could not read Username`, `Permission to … denied`, `403`, on `git push`, `git ls-remote` or `git fetch` | `grep -inE 'authentication failed\|could not read username\|permission to .* denied\|returned error: 403' <release log>` |
| T3 | If D5 removed the identity step: no `Please tell me who you are` / `empty ident` | release job log |
| T4 | The run was not started with a `startup_failure` and no `Secret GIT_USER_TOKEN is required` annotation | `run.json`, annotations |

**S: snapshot on `main`**

| Row | Rule | Evidence |
|---|---|---|
| S1 | Run `success`. Every job `success`, except `github-release` = `skipped` in the release flow | `jobs.tsv` |
| S2 | All tarballs created in the run window share **one** version `0.0.0-SNAPSHOT-<id>`. The packages are: push (M1) = the affected publishable projects of the log's `Projects being processed`; forced (M2) = every publishable project (same count as the latest release, 27 unless a replay changed the set) | `snap_tgz`, log |
| S3 | `snapshot` dist-tag of each published package → the new version. `release-26.4` and `release-26.3` unchanged on every package. `latest` may move to the snapshot (Artifactory moves it to the newest version, as seen in LT 1.2); record but do not fail on it | `dist-tags.tsv` diff |
| S4 | `tags.txt`, `releases.txt`, `latest-release.txt` unchanged. No run of any workflow for a `version/*` ref in the window | `snapshot()` diff, `runs_since` |
| S5 | No release-version tarball (`npm-tgz.tsv` unchanged), nothing outside `@cplace-next/*` in the window | AQL |

---

## 4. Test cases

Run in this order, one at a time (LT 2.1 and 2.3). Each case computes `N` from its own before-snapshot. The versions below assume nothing else happens in between.

| ID | Kind | Branch | Trigger | Outcome | Version |
|---|---|---|---|---|---|
| R0 | smoke | `BR` | T2 push (caller switch) | NO-RELEASE + T1, T4 | – |
| M0 | smoke | `MB` | T3 push (main prep) | main CI `success`, S4, S5 | – |
| **R1** | **core** | `BR` | push of replay `e2d33835d4b` | RELEASE(26.4.8) + T1–T4 | 26.4.8 |
| **M1** | **core** | `MB` | push of replay `97b45e73a1f` | main CI snapshot of the affected projects, S1–S5 | snapshot |
| **M2** | **core** | `MB` | forced release-flow dispatch on `main` | snapshot of all projects, S1–S5, T1–T2 | snapshot |
| R2 | support | `BR` | forced dispatch, nothing affected | RELEASE(26.4.9) | 26.4.9 |
| R3 | support | `BR` | forced release, publish fails on the last package, then re-run | cleanup, then RELEASE(26.4.10) | 26.4.10 |
| R4 | support | `BR` | re-run of `github-release` (exists / deleted) | idempotent / recreated | 26.4.10 |
| R5 | negative | `test/ceiling` | caller ceiling `contents: read` | REJECTED at startup | – |
| R6 | optional, stop | `BR` | forced release with `GIT_USER_TOKEN` deleted | RELEASE(26.4.11) | 26.4.11 |

### R0: Caller switch on `BR`

- **Trigger:** the T2 push.
- **Expected:** NO-RELEASE (N1, N2). Log: `No projects are affected since version/26.4.7`.
- **Plus:** T4 (the caller ceiling `contents: write` covers the new `release: contents: write`, and the secret contract still validates). T1 for the jobs that ran.
- **Why:** a startup failure here would mean every migrated consumer breaks on the next push.

### M0: `main` preparation push

- **Trigger:** the T3 push.
- **Expected:**
  - Exactly one "Frontend Main CI" run, `success`; no "Frontend Release CI" run (it triggers on `release/*` only); no xray run.
  - The jobs use `@$TEST_BRANCH` (job log: `Uses: collaborationFactory/github-actions/.github/workflows/fe-snapshot.yml@refs/heads/test/PFM-ISSUE-34282-github-token`).
  - Snapshot: workflow files are no project input, so the log is expected to list no projects and nothing is published. If the tool does publish, record the package list; S2–S5 apply then.
  - S4, S5.

### R1: Release on a real change (core)

- **Purpose:** one push → one run that publishes, tags **with `GITHUB_TOKEN`**, and creates the GitHub release. The shared PAT is not used.
- **Trigger:**
  ```bash
  git -C "$WT" fetch origin && git -C "$WT" reset --hard origin/$BR
  git -C "$WT" cherry-pick e2d33835d4b && git -C "$WT" push origin HEAD:$BR
  SHA=$(git -C "$WT" rev-parse HEAD)
  ```
- **Expected:** RELEASE(26.4.8): E1–E8 with E7 Phase B, plus T1–T4. In detail:
  - **Build:** `install-deps`, `build (*)`, `release`, `github-release` `success`; the log lists cf-editor-lib among the affected projects (`Checking affected projects since version/26.4.7`).
  - **Artifacts:** `Publish phase: publishing all publishable projects as 26.4.8`, then one `+ @cplace-next/<p>@26.4.8` per publishable project, then `Promote phase: moving release-26.4 to 26.4.8`, then `Tag phase: pushing version/26.4.8`. AQL count of `*-26.4.8.tgz` under `@cplace-next` = the publishable count (27 for the last release). `release-26.4` → `26.4.8` on every package, no `release-26.4-pending` left, `snapshot`/`latest` unchanged.
  - **Tag:** `refs/tags/version/26.4.8`, type `commit` (lightweight), on `SHA`. No other tag added or moved.
  - **GitHub release:** `version/26.4.8`, `draft=false`, `pre=false`, author `github-actions[bot]`, latest. Body ends with the compare link `version/26.4.7...version/26.4.8`. The cherry-picked commit is no PR of the clone, so "What's Changed" may be empty; that is not a failure.
  - **PAT out of the path:** **no** canary run for `version/26.4.8` (the PAT baseline `26.4.7` had canary run `42297425544` as `squad-fe`). T1 shows `release` with `Contents: write`; the PAT baseline run `42292826750` showed `Contents: read`.
- **Record:** the publish order (R3 needs the last package) and the `release` job duration.

### M1: Push to `main` with a real change (core)

- **Purpose:** the main CI still builds and publishes snapshots with the 34282 test branch, and its jobs hold no more write scope than the (possibly narrowed) caller grants.
- **Trigger:**
  ```bash
  git -C "$WT" fetch origin main && git -C "$WT" switch -C main-wt origin/main
  git -C "$WT" cherry-pick 97b45e73a1f && git -C "$WT" push origin HEAD:main
  ```
- **Expected:**
  - One "Frontend Main CI" run, `success`: `install-deps`, `build (*)`, `snapshot` `success`.
  - **Build:** the build job builds the affected projects since `github.event.before` without error.
  - **Artifacts:** S2 (push): one version `0.0.0-SNAPSHOT-<id>` for the affected publishable projects, cf-frontend-sdk among them. Each `+ @cplace-next/<p>@0.0.0-SNAPSHOT-<id>` log line has a matching tarball.
  - S3, S4 (no tag, no GitHub release, no tag-triggered run), S5.
  - **Permissions:** each job's `GITHUB_TOKEN Permissions` group matches the `push_main.yaml` grant (`Contents: read`, `Actions: write`, `Metadata: read` today; the D7 block if 34282 narrows the template). Record it next to the release flow's T1 result.
- **If D7 changed the template:** this case is also the regression test for the narrowed main permissions. Any `403`/`Resource not accessible by integration` in a job log is a FAIL.

### M2: Forced release-flow dispatch on `main` (core)

- **Purpose:** the changed `release` job (D1–D3: no PAT, `contents: write`) also serves the default-branch path: it publishes a snapshot of all projects and pushes nothing. LT A13 skipped this in Phase A, so it is new coverage.
- **Precondition:** T3 done. Nothing in flight on `MB`.
- **Trigger:** `gh workflow run fe-release.yml -R $R --ref main -f force=true`, then find the run with `runs_since "$T0"` (event `workflow_dispatch`, branch `main`).
- **Expected:**
  - `guard` `success` (default branch is allowed, no old caller on `MB`).
  - `install-deps`, `build (*)`, `release` `success`; `github-release` `skipped` (no tag output).
  - Release log: `Forced release flow on main: publishing a snapshot of all projects`. Step summary: `Published a snapshot of all projects as \`0.0.0-SNAPSHOT-<id>\` (no tag, no GitHub release)`.
  - S2 (forced: every publishable project), S3, S4, S5.
  - T1 (the `release` job holds `Contents: write` here too) and T2. No `git push` in the log.
- **Non-forced variant (optional, cheap):** the same dispatch with `force=false`: `release` `skipped` (dry run), S4, and no new snapshot tarball.

### R2: Forced release on `BR`

- **Precondition:** nothing affected since `version/26.4.8` (true after R1, M cases do not touch `BR`).
- **Trigger:** `gh workflow run fe-release.yml -R $R --ref $BR -f force=true`
- **Expected:** RELEASE(26.4.9), E1–E8 with E7 Phase B, T1–T4. Log `Force is set: skipping the affected check`. The tag is on the `BR` tip at dispatch.

### R3: Failure cleanup with `GITHUB_TOKEN`

- **Purpose:** the cleanup's `git ls-remote --exit-code` and the later tag push both work with the persisted `GITHUB_TOKEN`. An auth failure in `ls-remote` would end in the "Could not check whether … is pushed" error and leave a partial release.
- **Setup and trigger:** as LT A8 with `N = 26.4.10` and `LAST` = the last package of R1's publish order (stop: show the placeholder upload).
- **Expected, attempt 1:**
  - `failure` on `LAST` ("cannot publish over the previously published versions: 26.4.10").
  - "Check for an incomplete release" logs `version/26.4.10 was not pushed: unpublishing its artifacts`, i.e. `ls-remote` exit code 2. **Exit code 128 or the `Could not check whether` error is a FAIL** (token cannot read the remote).
  - One `Deleted artifact from Jfrog: …@26.4.10` per published package and the placeholder; AQL `*-26.4.10.tgz` = 0; `release-26.4` still `26.4.9` everywhere; no staging tag; no tag, no release; `github-release` skipped.
- **Trigger 2:** `gh run rerun $RUN -R $R --failed`.
- **Expected, attempt 2:** RELEASE(26.4.10), E1–E8 with E7 Phase B, T1–T4. The same `N`, not `26.4.11`.

### R4: `github-release` re-run

- **Precondition:** R3's run is the most recent successful release (LT A10 precondition).
- **Steps and expectations:** as LT A10.
  1. Re-run `github-release`: `A GitHub release for version/26.4.10 already exists, nothing to do`; releases unchanged.
  2. Delete the release only (`gh api -X DELETE repos/$R/releases/<id>`, check 404), re-run again: recreated, author `github-actions[bot]`, range `version/26.4.9...version/26.4.10`, latest.
- **Plus:** T1 for the re-run job (the fresh token still has `Contents: write`).

### R5: Caller ceiling below the job request (negative)

- **Setup:** branch `test/ceiling` from `BR` with one commit changing the caller's top-level `permissions` to `contents: read`.
- **Trigger:** `gh workflow run fe-release.yml -R $R --ref test/ceiling -f force=false`
- **Expected:** REJECTED at startup (X1, X2): no job started; the error names `release` (and `github-release`) requesting `contents: write` with only `contents: read` allowed. If `guard` runs and fails on the ref instead, the ceiling was not enforced: FAIL.
- **Cleanup:** delete `test/ceiling`.

### R6 (optional, stop): Release without the PAT secret

- **Purpose:** the strongest proof that the PAT is out of the tag and release path.
- **Precondition:** the user agrees to delete the `GIT_USER_TOKEN` secret of `R` (Phase A of LT can no longer run without it; the value must be re-supplied to restore it).
- **Step:** `gh secret delete GIT_USER_TOKEN -R $R`, then R2's trigger.
- **Expected:** RELEASE(26.4.11), E1–E8 with E7 Phase B, T1–T4. `Secret GIT_USER_TOKEN is required, but not provided` is a FAIL (D3 missing).
- **Also run M1's spare replay (`7e81a3a8442`) afterwards** to show the main CI does not need the secret either.
- If D5 removed `GIT_USER`/`GIT_USER_EMAIL`, delete those as well in the same step.

---

## 5. Pass criteria for the ticket

The acceptance criteria of PFM-ISSUE-34282 are met when:

| Acceptance criterion | Shown by |
|---|---|
| In-repo tag and release authenticate via `GITHUB_TOKEN` | R1/R2/R3: tag pushed with no canary run (E7 Phase B), T2 clean; `github-release` author `github-actions[bot]`; P13; R6 (if run) |
| Least-privilege, job-scoped permissions | T1 in R0, R1, M2: only `release` and `github-release` hold `Contents: write`; no unlisted scope; R5 |
| The shared user PAT is no longer used for tagging/releasing | P12/P13 (no `GIT_USER_TOKEN` in the flow), E7 Phase B, R6 |
| Builds and publishes still work | R1/R2 (release artifacts, tag, release notes), M1/M2 (snapshots on `main`), R3/R4 (recovery) |
| No regression for unmigrated consumers | P12: `fe-tag.yml`/`fe-release.yml` reusables unchanged |

Any failed row stops the series (LT 2.1). Do not fix forward: record it, fix it on `FB`, recreate the test branch (T1) and rerun from the failed case.

---

## 6. Report

`$OUT/results.md` holds:
- the case table (ID, run ids and attempts, verdict, note);
- the PAT vs. `GITHUB_TOKEN` comparison:

  | | PAT baseline (`26.4.7`, run `42292826750`) | 34282 (R1) |
  |---|---|---|
  | `release` job token scope | `Contents: read` | `Contents: write` |
  | Canary run on the new tag | `42297425544`, actor `squad-fe` | none |
  | `GIT_USER_TOKEN` declared | yes | no |
  | GitHub release author | `github-actions[bot]` | `github-actions[bot]` |

- the `main` permissions (M1, M2) per job;
- deviations, each with its evidence file.

Copy the case table and the comparison into the PFM-ISSUE-34282 PR description as the live-validation evidence.

**Cleanup:** none beyond the throwaway branches (`test/ceiling`). Tags, releases, test tarballs and the migrated `main` stay (user decision for this test repo). The `github-actions` test branch is deleted only after the user confirms (stop). If R6 deleted secrets, ask whether to restore them.

---

## 7. Open points to settle before execution

1. **Final permission set of `release`**: this plan assumes `contents: write` only. If `checks`/`pull-requests` are added, update T1 and check that the caller template grants them (R0 would otherwise fail at startup).
2. **D5 identity step**: decides whether rule T3 (section 3) and the `GIT_USER*` part of R6 apply.
3. **D7 `fe-main.yml`**: if the template is narrowed in 34282, M1 is its regression test; if not, M1 is a plain regression check.
4. **Credential style**: if the implementation switches to `persist-credentials: false` with a push-only credential, add to R1/R3: the `release` job's `.git/config` contains no `extraheader` during `npm ci` (check with a temporary `git config --get-all http.https://github.com/.extraheader || echo none` debug step on the test branch only), and the push and `ls-remote` still succeed.
