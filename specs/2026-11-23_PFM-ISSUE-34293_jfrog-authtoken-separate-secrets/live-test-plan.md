---
date: 2026-11-24
branch: improvement/PFM-ISSUE-34293-Introduce-separate-JFrog-user-and-token-secrets
topic: "Live test plan for PFM-ISSUE-34293 - separate JFrog user and token secrets (plain _authToken)"
tags: [live-test, test-plan, clone-cplace-fe, jfrog, npm, authtoken, cplace-npm-test]
status: draft
---

# Live test plan: PFM-ISSUE-34293 in `clone-cplace-fe`

This plan validates the PFM-ISSUE-34293 implementation on the test fork `collaborationFactory/clone-cplace-fe`. It publishes and deletes only in the JFrog test registry `cplace-npm-test`, and only `@cplace-next/*` versions created by these runs.

**What it proves.** Every npm command that runs from a dist directory works with `_authToken=${JFROG_TOKEN}`: `publish`, `show`, `unpublish`, `dist-tag add`/`rm`. The legacy `_auth` path keeps working and is flagged with a deprecation warning. A publishing or deleting run without either secret fails fast, before it publishes or deletes anything.

**What it reuses.** The environment, tools, helper library, per-case procedure, JFrog rule and teardown come from the 34283 live-test document [`clone-cplace-fe-live-tests.md`](../2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/clone-cplace-fe-live-tests.md), abbreviated **LT** below (Parts 1, 2 and 4; e.g. "LT 2.2" is its helper library). The release expected-state rules come from LT 3.1, and the snapshot helper and rules from the 34282 plan [`live-test-plan.md`](../2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/live-test-plan.md) (abbreviated **LT82**, e.g. "LT82 2.4"). This plan lists only the deltas and the cases.

**Already done.** The Phase 1 smoke ([plan.md](./plan.md), Phase 1 §6) ran on 2026-11-24: run `45430072566` published 21 snapshot packages with `_authToken=${JFROG_TOKEN}`. Case T1 repeats it on the final branch.

---

## 1. Expected change

| ID | Item | Before (master) | Expected with 34293 |
|---|---|---|---|
| C1 | dist `.npmrc`, token mode (`JFROG_TOKEN` non-empty) | four lines: `<scope>:registry=`, `_auth=`, `always-auth=true`, `email=` | exactly two lines: `@cplace-next:registry=<JFROG_URL>` and `//cplace.jfrog.io/artifactory/api/npm/cplace-npm-test/:_authToken=${JFROG_TOKEN}`. The placeholder is printed literally; the key ends in exactly one `/` |
| C2 | dist `.npmrc`, legacy mode (only `JFROG_BASE64_TOKEN`) | four lines | unchanged, byte for byte |
| C3 | publishing identity log | none | token mode: `Publishing as JFrog user *** with JFROG_TOKEN` before each `.npmrc` printout |
| C4 | `Configuration` log line | serializes `base64Token` (masked only by GitHub) | `"jfrogCredentials":{"url":"***","user":"***","authMode":"TOKEN"\|"LEGACY"\|"NONE"}`, never a `"token":` or `"base64Token":` key |
| C5 | annotation, legacy mode | none | one `::warning::JFROG_BASE64_TOKEN is deprecated: …` per run of a publishing or deleting step |
| C6 | neither secret, publishing or deleting mode | `required: true` blocks the call at startup | the run starts; the artifacts step fails with `::error::No JFrog credentials: …` before build, publish, delete or the release-version file |
| C7 | secret declarations in the seven reusables | `JFROG_BASE64_TOKEN: required: true` | `JFROG_TOKEN` and `JFROG_BASE64_TOKEN` both `required: false`; both passed to every artifacts step (8 env blocks) |
| C8 | modes without credentials | bump-only (`fe-tag` on `release/*`), release flow on the default branch without force | unchanged: no gate, no annotation |

**What does not change:** `DOT_NPMRC` (installs, `npm search`/`npm view` in cleanup), `JFROG_URL` and `JFROG_USER` (still `required: true`), the registry target (`JFROG_URL` decides it, LT 1.2).

---

## 2. Test environment

### 2.1 State on 2026-11-24 (read-only check)

| Item | Value |
|---|---|
| Secrets | `DOT_NPMRC`, `GIT_USER`, `GIT_USER_EMAIL`, `GIT_USER_TOKEN`, `GRADLE_PROPERTIES`, `JFROG_BASE64_TOKEN`, `JFROG_TOKEN` (set by the user 2026-11-24), `JFROG_URL`, `JFROG_USER` |
| Branches | `main`, `release/26.4`, `release/26.3`, `fix/PFM-ISSUE-35119-…` (leftover) |
| Version tags | up to `version/26.4.10` (latest release). The next release on `26.4` is `26.4.11` |
| `main` tip | the Phase 1 smoke replay (upstream #2991) |
| `main` callers | `push_main.yaml`: `fe-install-deps`/`fe-build` `@test/PFM-ISSUE-34282-github-token`, `fe-snapshot` `@test/PFM-ISSUE-34293-jfrog-token` with `JFROG_TOKEN`. `pull_request_snapshot.yaml`, `pull_request_close.yaml`, `cron_cleanup_snapshots.yaml`: `@master` with `JFROG_BASE64_TOKEN`. `fe-release.yml` → `fe-release-flow.yml@test/PFM-ISSUE-34282-github-token`, `secrets: inherit` |
| `release/26.4` callers | `fe-release.yml` → `fe-release-flow.yml@test/PFM-ISSUE-34282-github-token`, `secrets: inherit`, `RUN_E2E` not set (defaults to `true`). Other callers `@release/26.4`. Canary `zz-tag-push-canary.yml` present |
| PR triggers | `pull_request_snapshot.yaml` on `labeled`, `synchronize`, `reopened`; `fe-pr-snapshot.yml` runs only with label `snapshot` (the clone has no such label yet; adding it to a PR creates it). `pull_request_close.yaml` on `closed` |
| Cleanup trigger | `cron_cleanup_snapshots.yaml`: `workflow_dispatch` only (schedule disabled in the fork) |
| Snapshot ages in `cplace-npm-test` | every `@cplace-next` snapshot tarball dates from 2026-10/11. The cleanup computes the age from the version suffix (`…-YYYYMMDD`), so no version there reaches the 4-month threshold |

Recheck the rows before Phase 5 starts; record any change in the report.

### 2.2 Placeholders (in addition to LT)

| Name | Value |
|---|---|
| `TEST_BRANCH` | `test/PFM-ISSUE-34293-jfrog-token` |
| `FB` | `improvement/PFM-ISSUE-34293-Introduce-separate-JFrog-user-and-token-secrets` |
| `MB` | `main` |
| `BR` | `release/26.4` |
| `OUT` | `<scratchpad>/34293` (results, captures, `lib.sh`) |
| `WT` | `$OUT/wt`, a working copy of the clone (LT 1.4: `core.longpaths`, `core.autocrlf false`) |

### 2.3 Setup

Every push to `github-actions` and every secret change is a stop (LT 2.1). Pushes to the clone are allowed.

**S1: Recreate the test branch** (stop: push). The Phase 1 test branch predates Phases 2 and 3, so P3 fails until it is recreated.
1. Delete the remote `TEST_BRANCH` and recreate it from `origin/$FB` (stop: the delete and the push).
2. One commit rewrites every internal `collaborationFactory/github-actions/.github/...@master` ref in `.github/workflows` and `.github/actions` to `@$TEST_BRANCH` (34282 plan T1 step 2 command; 14 files). `workflow-templates` stay on `@master`.
3. No e2e-removal commit: the release cases switch e2e off in the caller instead (S3).
4. Run LT P2 and P3 against `TEST_BRANCH`/`FB`. Both must be empty.

**S2: Point the `main` callers at the test branch.** One commit on `MB`, `.github/workflows` only, no `package.json`/`package-lock.json` (xray):
- `pull_request_snapshot.yaml`, `pull_request_close.yaml`, `cron_cleanup_snapshots.yaml`: `@master` → `@$TEST_BRANCH`, and their `JFROG_BASE64_TOKEN:` line → `JFROG_TOKEN: ${{ secrets.JFROG_TOKEN }}`.
- `push_main.yaml`: `fe-snapshot` already `@$TEST_BRANCH` with `JFROG_TOKEN` (Phase 1). `fe-install-deps`/`fe-build` stay on the 34282 test branch (they handle no JFrog secret).
- The push starts the main CI with no project affected. Record it as an extra observation: `success`, nothing published.

**S3: Point the release caller at the test branch.** One commit on `BR`: in `fe-release.yml`, `@test/PFM-ISSUE-34282-github-token` → `@$TEST_BRANCH`, and uncomment `RUN_E2E: false` (the clone cannot run e2e; LT 1.7). Keep `secrets: inherit`. The push starts a release run with nothing affected: expected NO-RELEASE (LT 3.1 N1, N2), token mode, no annotation. Record it as **T4a**.

**S4: Helpers.** Source LT 2.2 into `$OUT/lib.sh`, plus LT82 2.4 `snap_tgz`, plus:

```bash
# annotations <capture-dir> <job name>: check-run annotations (level, message) of one job
annotations() {
  local id=$(awk -F'\t' -v n="$2" '$1==n{print $3}' "$1/jobs.tsv")
  gh api "repos/$R/check-runs/$id/annotations" --jq '.[] | "\(.annotation_level)\t\(.message)"'
}
# leak_check <log>: lines that must not appear in any 34293 run
leak_check() { grep -nE '"token":|"base64Token":|Failed to replace env in config' "$1"; }
```

**S5: Preflight.** LT P2, P3, P5 (registry target), P9 (nothing in flight), P10 (tools), plus:

| ID | Check | Pass |
|---|---|---|
| Q1 | `gh api repos/$R/actions/secrets --jq '.secrets[].name'` | lists `JFROG_TOKEN`, `JFROG_BASE64_TOKEN`, `JFROG_URL`, `JFROG_USER` |
| Q2 | `uses:` and `JFROG_*` lines of the four explicit callers on `MB` and of `fe-release.yml` on `BR` | as after S2/S3 |
| Q3 | `git diff origin/master...origin/$FB --stat -- .github README.md tools` | only the files of [plan.md](./plan.md) Phases 1–3 |

### 2.4 Replay commits

Main and PR cases need real changes. Recompute before use (LT 1.5 rules apply; skip upstream upmerge merges as LT82 did):

```bash
git -C "$WT" log --first-parent --reverse --format='%h %ad %s' --date=short 320b61b22..upstream/main
git -C "$WT" log --first-parent --reverse --format='%h %ad %s' --date=short b93fdc38e..upstream/release/26.4
```

| Use | Upstream commit (state 2026-11-24) | Note |
|---|---|---|
| T1 (on `MB`) | `a79102a2` #3002, 35103 FE 2.0 dialog to configure aggregations | next non-upmerge after the Phase 1 replay (#2991) |
| L1 (on `MB`) | the next non-upmerge commit after `a79102a2` | |
| PR branches (T2/T3, L2, N2) | one further `main` commit, cherry-picked onto each PR branch | PRs are closed unmerged, so the same commit can serve every PR |
| T4 (on `BR`) | `4b83e9883e5` #3010 (`-m 1`), 35135 split ai-companion e2e | LT 1.5 #6, adds apps; if it conflicts outside fork-setup files, stop; `d9d83f5a6ee` is the spare |

Each case must show a project affected in its log (`Projects being processed` non-empty) before its artifacts rows are evaluated.

---

## 3. Expected-state rules

**A: authentication, every token case**

| Row | Rule | Evidence |
|---|---|---|
| A1 | Each dist `.npmrc` printout is the two C1 lines, preceded by C3 | artifacts job log |
| A2 | `"authMode":"TOKEN"` in the `Configuration` line (C4) | log |
| A3 | `leak_check` is empty; no `always-auth`, no `:_auth=` | log |
| A4 | No `E401`, `E403`, `ENEEDAUTH`, `Unable to authenticate` in an npm command | `grep -nE 'E401\|E403\|ENEEDAUTH\|Unable to authenticate' <log>` |
| A5 | No `::warning::JFROG_BASE64_TOKEN` and no `No JFrog credentials` annotation | `annotations` |
| A6 | Every version the run created or deleted, checked by exact path in `cplace-npm-test` (LT 4.2) | AQL |

**L: legacy cases** — the four legacy lines per printout (masked `_auth`), `"authMode":"LEGACY"`, exactly one `warning` annotation with `JFROG_BASE64_TOKEN is deprecated` on the artifacts job, A3, A4, A6.

**N: neither cases** — the artifacts job `failure`; one `failure` annotation `No JFrog credentials: pass the JFROG_TOKEN secret …`; `"authMode":"NONE"`; no `nx run`/build output in the artifacts step, no `+ @cplace-next/` line, no `npm unpublish`; `snap_tgz "$T0"` adds nothing; no run is blocked at startup with `Secret … is required`.

**Release rules** — LT 3.1 RELEASE(N) with E7 in its Phase B form (no run for `version/N`, as the tag is pushed with `GITHUB_TOKEN`); NO-RELEASE as in LT 3.1.

**Snapshot rules** — LT82 3 S1–S5.

---

## 4. Test cases

Run one at a time in this order (LT 2.1, LT 2.3). Before each case: `T0`, `snapshot "$OUT/<ID>/before"`, `snap_tgz` baseline. After: capture, evaluate, `verdict.md`, ledger, results line.

| ID | Mode | Flow | Trigger | Proves | Outcome |
|---|---|---|---|---|---|
| T1 | token | main snapshot (`fe-snapshot`) | push of the T1 replay to `MB` | publish (re-run of the Phase 1 smoke on the final branch) | LT82 S1–S5 + A1–A6 |
| T2 | token | PR snapshot (`fe-pr-snapshot`), labelled PR pushed twice | PR from `test/34293-pr-token`, label `snapshot`, then a second push | `npm show` + unpublish + republish of the same version with Bearer auth | publish, then replace; A1–A6 |
| T3 | token | PR close (`fe-pr-close`) on T2's PR | close T2's PR unmerged | unpublish via the "dist missing" path of `deleteArtifact`, the same path cleanup uses | versions deleted; A1–A6 |
| T4 | token | release flow push on `BR` with a real change | push of the T4 replay to `BR` | publish under the staging tag, then `dist-tag add`/`rm` promote | RELEASE(26.4.11) + A1–A6 |
| T5 | token | cleanup (`fe-cleanup-snapshots`, dispatch) | `gh workflow run cron_cleanup_snapshots.yaml -R $R --ref main` | gate + search + authenticated `npm show`; deletion only if a snapshot in `cplace-npm-test` is ≥ 4 months old, otherwise deletion is covered by T3 (record which) | `success`; no deletion expected (2.1) |
| T6 (optional) | token | release flow with induced publish failure (LT A8 method) | forced dispatch on `BR` with a placeholder at `N` (stop) | failure-cleanup unpublish | cleanup, then RELEASE(N) on re-run |
| L1 | legacy | main snapshot | caller edit + push of the L1 replay to `MB` | legacy path still publishes; `::warning::` annotation present; dist `.npmrc` printout has the four legacy lines | LT82 S1–S5 + L |
| L2 | legacy | PR snapshot + PR close | PR from `test/34293-pr-legacy` with a legacy caller on the PR branch | legacy unpublish still works with the warning | publish, close deletes; L |
| L3 | legacy | release flow via explicit-secrets caller | forced dispatch on `BR` with an explicit-secrets caller without `JFROG_TOKEN` | legacy release + promote still works with the warning | RELEASE(26.4.12) + L |
| N1 | neither | main snapshot | caller edit on `MB` without either line | run fails before `npm run`/build, with the `::error::` annotation; nothing published | N |
| N2 | neither | PR close | PR from `test/34293-pr-none` without label, closed | fails before any `npm unpublish` | N |

Version numbers assume that nothing else releases on `26.4` in between; each case computes `N` from its own before-snapshot.

### T1: Main snapshot, token (re-run of the smoke)

- **Precondition:** S1–S5 done.
- **Trigger:** `git -C "$WT" fetch origin && git -C "$WT" switch -C main-wt origin/main && git -C "$WT" cherry-pick <T1 replay> && git -C "$WT" push origin HEAD:main`.
- **Expected:** one "Frontend Main CI" run, `success`. The snapshot job `Uses` `fe-snapshot.yml@refs/heads/$TEST_BRANCH`. One `0.0.0-SNAPSHOT-<id>` for the affected publishable projects, each `+ @cplace-next/<p>@…` line with a matching tarball (LT82 S2); `snapshot` dist-tag moved (S3); S4, S5; A1–A6.
- **Compare** with the Phase 1 run `45430072566`: same `.npmrc` printout format.

### T2: PR snapshot, token, pushed twice

- **Setup:** branch `test/34293-pr-token` from `origin/main` with the PR replay commit; the PR callers on `MB` are already token callers (S2). Open a PR to `main`: `gh pr create -R $R --base main --head test/34293-pr-token --title "34293 T2 token PR snapshot" --body "live test, do not merge"`.
- **Trigger 1:** add the label: `gh api repos/$R/issues/<pr>/labels -f 'labels[]=snapshot'`.
- **Expected 1:** "Frontend Pull Request Snapshot CI" `success`. Version `0.0.0-test-34293-pr-token-<pr>` (`Utils.getPRVersion`) for every affected publishable project; dist-tag `latest-pr-snapshot`. Log per project: `npm show … --registry=…cplace-npm-test` ran with the token `.npmrc` (the version does not exist yet: `Skipping deletion`), then publish. A1–A6. Record the package list.
- **Trigger 2:** push one more commit to the PR branch (an empty commit is enough: `git commit --allow-empty`). Affected is computed against the base, so the same projects are processed.
- **Expected 2:** `success`. For each project: `Package … exists in registry`, `npm unpublish …@<version> --force`, `Deleted artifact from Jfrog`, then the same version is published again. AQL: one tarball per package at that version, `created` inside the second run's window. A1–A6.
- **Why:** this is the first `npm show` and `npm unpublish` with Bearer auth (design risk 1).

### T3: PR close, token

- **Trigger:** `gh pr close <T2 pr> -R $R` (unmerged).
- **Expected:** "Frontend Pull Request Close CI" `success`. For each project: `Path to project in dist does not exist, creating it`, the token `.npmrc` printout (A1), `Package … exists in registry`, `npm unpublish`, `Deleted artifact from Jfrog`. AQL for every T2 version = 0 hits (allow LT 2.3 step 5 metadata delay). A2–A5.
- **Cleanup:** delete the branch `test/34293-pr-token`.

### T4: Release flow on `BR`, token

- **Precondition:** T4a (S3 push) evaluated. Nothing in flight on `BR`.
- **Trigger:** `git -C "$WT" fetch origin && git -C "$WT" switch -C br-wt origin/$BR && git -C "$WT" cherry-pick -m 1 4b83e9883e5 && git -C "$WT" push origin HEAD:$BR`.
- **Expected:** RELEASE(26.4.11) (LT 3.1 E1–E8, E7 Phase B), plus A1–A6 on the `release` job:
  - `Publish phase: publishing all publishable projects as 26.4.11`, one `+ @cplace-next/<p>@26.4.11` per publishable project, each published under `release-26.4-pending`.
  - `Promote phase`: one `npm dist-tag add …@26.4.11 release-26.4` and one `npm dist-tag rm … release-26.4-pending` per package, each without an auth error (A4). After the run: `release-26.4` → `26.4.11` everywhere, no `release-26.4-pending` left.
  - Tag `version/26.4.11`, GitHub release by `github-actions[bot]`, no canary run.
- **Why:** the only case that runs `dist-tag add`/`rm` with Bearer auth.

### T5: Snapshot cleanup, token

- **Precondition:** S2 done (the cleanup caller passes `JFROG_TOKEN`).
- **Trigger:** `gh workflow run cron_cleanup_snapshots.yaml -R $R --ref main`; find the run with `runs_since "$T0"`.
- **Expected:** `success`. `"authMode":"TOKEN"`, no annotation (A5). `npm search`/`npm view` run with `DOT_NPMRC` (unchanged), so the candidates come from the install registry, not from `cplace-npm-test`. Two outcomes are valid:
  - **Candidates found** (old snapshots in the install registry): for each, the dist `.npmrc` printout is the token form (A1) and `npm show … --registry=…cplace-npm-test` answers without an auth error (A4). Per 2.1 none exists in `cplace-npm-test`, so each ends with `does not exist in the registry. Skipping deletion`.
  - **No candidate** (`versions to delete: []` everywhere): only the gate and the search are proven; record that `show` is covered by T2/T3.
  - Either way, AQL before = after.
- **Stop** if any `npm unpublish` appears: compare its version against the ledger before anything else (it must be one of ours; LT 4.2).
- **Record:** "deletion covered by T3" (or, if a deletion happened, its versions and their check).

### T6 (optional): Failure cleanup, token

- **Setup and trigger:** as LT A8 / LT82 R3: upload a placeholder tarball for the last package of T4's publish order at the next `N` (stop: show the upload), then `gh workflow run fe-release.yml -R $R --ref $BR -f force=true`.
- **Expected attempt 1:** `failure` on the placeholder's package; "Unpublish the incomplete release" deletes every package at `N` with the token `.npmrc` (A1, A4); AQL at `N` = 0 (placeholder included); no tag. **Attempt 2** (`gh run rerun --failed`): RELEASE(N).

### L1: Main snapshot, legacy

- **Trigger:** one push to `MB` with two commits: a caller edit in `push_main.yaml` (`JFROG_TOKEN:` line → `JFROG_BASE64_TOKEN: ${{ secrets.JFROG_BASE64_TOKEN }}`; ref unchanged), then the L1 replay.
- **Expected:** "Frontend Main CI" `success`; LT82 S1–S5; the L rules: four-line printout per project (`:_auth=***`, `:always-auth=true`, `:email=***`), `"authMode":"LEGACY"`, one `warning` annotation with `JFROG_BASE64_TOKEN is deprecated` on the snapshot job, visible in the run summary.
- **Restore:** push the caller back to `JFROG_TOKEN` (nothing affected; record the run as an extra observation).

### L2: PR snapshot and close, legacy

- **Setup:** branch `test/34293-pr-legacy` from `origin/main` with the PR replay commit plus one commit that changes the `JFROG_TOKEN:` line in both `pull_request_snapshot.yaml` and `pull_request_close.yaml` to `JFROG_BASE64_TOKEN: ${{ secrets.JFROG_BASE64_TOKEN }}`. `pull_request` runs use the workflow files of the PR's merge ref, so this selects legacy mode for this PR only. Open the PR.
- **Trigger 1:** add the label `snapshot`. **Expected:** `success`; L rules; versions `0.0.0-test-34293-pr-legacy-<pr>` published.
- **Trigger 2:** close the PR. **Expected:** `success`; L rules on the close job; AQL for the L2 versions = 0.
- **Cleanup:** delete the branch.

### L3: Release flow via explicit secrets, legacy

- **Why explicit secrets:** `secrets: inherit` hands the clone's `JFROG_TOKEN` to the flow, which then selects token mode. Never delete the clone's `JFROG_TOKEN` secret for this case.
- **Setup:** one commit on `BR`: in `fe-release.yml`, replace `secrets: inherit` with
  ```yaml
      secrets:
        JFROG_BASE64_TOKEN: ${{ secrets.JFROG_BASE64_TOKEN }}
        JFROG_URL: ${{ secrets.JFROG_URL }}
        JFROG_USER: ${{ secrets.JFROG_USER }}
        DOT_NPMRC: ${{ secrets.DOT_NPMRC }}
        GIT_USER: ${{ secrets.GIT_USER }}
        GIT_USER_EMAIL: ${{ secrets.GIT_USER_EMAIL }}
  ```
  Its push starts a release run with nothing affected: expected NO-RELEASE, plus the L warning (the gate runs on every `release/*` run). Record it as **L3a**.
- **Trigger:** `gh workflow run fe-release.yml -R $R --ref $BR -f force=true`.
- **Expected:** RELEASE(26.4.12) (E7 Phase B) with the L rules on the `release` job: legacy printout, warning annotation, publish under `release-26.4-pending`, promote (`dist-tag add`/`rm`) without an auth error.
- **Restore:** one commit on `BR` back to `secrets: inherit` (another NO-RELEASE run, token mode, no annotation).

### N1: Main snapshot, neither

- **Trigger:** one commit on `MB` that removes the `JFROG_TOKEN:` line from `push_main.yaml`'s snapshot job (so it passes only `JFROG_URL` and `JFROG_USER`). No replay needed: the gate runs before the affected computation.
- **Expected:** the run starts (no `Secret … is required` startup failure, C7). `install-deps` and `build` `success`; `snapshot` `failure`; the N rules. The log line before the failure is the `Configuration` line with `"authMode":"NONE"`; `About to build and release projects` does not appear.
- **Restore:** push the caller back to `JFROG_TOKEN` (extra observation, nothing affected).

### N2: PR close, neither

- **Setup:** branch `test/34293-pr-none` from `origin/main` plus one commit removing the `JFROG_TOKEN:` line from `pull_request_close.yaml` (and from `pull_request_snapshot.yaml`, which does not run without the label). Open the PR without a label, so nothing is published for it.
- **Trigger:** close the PR.
- **Expected:** "Frontend Pull Request Close CI" `failure` in the artifacts step; N rules; no `npm show`, no `npm unpublish`, no `Path to project in dist does not exist` line.
- **Cleanup:** delete the branch.

---

## 5. Pass criteria for the ticket

| Requirement / success criterion ([design.md](./design.md)) | Shown by |
|---|---|
| npm publish auth uses `//<registry>/:_authToken=${JFROG_TOKEN}` | A1 in T1–T5 |
| Every dist-`.npmrc` npm command works with Bearer auth (design risk 1) | publish T1/T2/T4, `show` T2/T3/T5, `unpublish` T2/T3 (+T6), `dist-tag add`/`rm` T4 |
| npm never runs without `JFROG_TOKEN` in env (design risk 2) | A3 (`Failed to replace env in config` absent) in every case |
| Legacy callers keep working, and are flagged | L1–L3 publish, unpublish and promote with the warning annotation |
| No startup failure for callers passing either, both or neither (design risk 3) | T cases (both declared, token passed), L cases (legacy only), N cases (neither) all start |
| Fail-fast only in publishing and deleting modes (design risk 4) | N1, N2 fail before any npm write; T4a/L3a/the restore runs show the release flow's gate on `release/*`; bump-only and the default-branch no-op are covered by unit tests |
| No secret value in logs | A2/A3 (C4) in every case |

Any failed row stops the series (LT 2.1). Record it, fix it on `FB`, recreate the test branch (S1) and rerun from the failed case. T1–T5, N1 and N2 must pass; L1–L3 must pass unless a deviation is accepted by the user; T6 is optional.

---

## 6. Report

To be filled in Phase 5. One row per case; the verdict is `pass`, `fail` or `skipped`.

| Case | Run(s) | Evidence | Versions touched in `cplace-npm-test` (state) | Verdict | Note |
|---|---|---|---|---|---|

Deviations, each with its evidence file:

---

## 7. Teardown

Stop before each step (LT 4.3). `clone-cplace-fe` and `cplace-npm-test` are test-only: tags, releases and release tarballs created here stay unless the user decides otherwise. PR-snapshot versions are already deleted by T3/L2.

1. **Callers.** Revert the clone's callers to `@master`:
   - after `FB` is merged: `@master` with `JFROG_TOKEN` (master then declares it);
   - before the merge: `@master` with `JFROG_BASE64_TOKEN`, because `@master` does not declare `JFROG_TOKEN` yet and a caller passing it fails at startup (design risk 3);
   - `BR`'s `fe-release.yml`: decide with the user (its `RUN_E2E: false` stays as long as the clone cannot run e2e).
2. **Test branch.** Delete `TEST_BRANCH` in `github-actions` only after no clone caller references it (`gh api` contents grep for `@test/PFM-ISSUE-34293` on `MB` and `BR` is empty). Pushing the deletion is a stop.
3. **Secrets.** The clone's `JFROG_TOKEN` secret stays.
4. **Throwaway branches.** `test/34293-pr-*` are deleted inside their cases; verify none is left.
