---
date: 2026-11-02
last_updated: 2026-11-02
branch: improvement/PFM-ISSUE-34283-Consolidate-the-FE-2-0-release-flow-into-a-master (PR #183)
topic: "Live tests of the FE release flow (PFM-ISSUE-34283, PFM-ISSUE-34282) in collaborationFactory/clone-cplace-fe"
tags: [live-test, clone-cplace-fe, fe-release-flow, github-token, jfrog, cplace-npm-test, agent-executable]
status: draft
---

# Live tests of the FE release flow in `clone-cplace-fe`

This document has three parts:

1. **Part 1: the test environment.** How it is built, what it contains on 2026-11-02, and how to rebuild it for a later change.
2. **Part 2: the execution model** for an agent. It covers tools, state capture, triggering, evaluation and stops.
3. **Part 3: the test cases.** Each case has a trigger, the expected end state and the evidence to collect.

**What is tested:**
- **Phase A:** the consolidated release flow from PR #183 (PFM-ISSUE-34283). The tag is still pushed with the PAT.
- **Phase B:** the same flow after PFM-ISSUE-34282, which pushes the tag with `GITHUB_TOKEN` and uses job-scoped permissions.

Phase A doubles as the baseline that Phase B is compared against. This document replaces the "Manual Testing Steps" of this ticket's plan ([plan.md](./plan.md), lines 788-798) as the executable version. Phase B is the follow-up for PFM-ISSUE-34282. Its test items come from the 34282 research ([research.md](../2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/research.md), open question 7).

The method follows the backend precedent `cplace-gh-workflows/specs/2026-10-19_PFM-ISSUE-35048_oversized-build-workspace-cache/clone-cplace-staging-procedure.md`, adapted to the FE repo.

**Placeholders:**

| Name | Value |
|---|---|
| `R` | `collaborationFactory/clone-cplace-fe` |
| `GA` | `collaborationFactory/github-actions` |
| `UP` | `collaborationFactory/cplace-fe` (upstream) |
| `BR` | `release/26.4` (the release line under test) |
| `TEST_BRANCH` | the github-actions test branch. Phase A: `test/PFM-ISSUE-34283-release-flow`. Phase B: `test/PFM-ISSUE-34282-<slug>`. |
| `J` | `--server-id cplace.jfrog.io` |
| `OUT` | a results directory outside every repo (the agent's scratchpad) |
| `WT` | a local working copy of `R` (see 1.4) |
| `N` | the version a run is expected to release; `PREV` is the highest existing `version/26.4.*` tag |

---

# Part 1: Test environment

## 1.1 Components

```
cplace-fe (upstream, untouched)
   │  fork on an older commit
   ▼
clone-cplace-fe ──caller fe-release.yml──▶ github-actions@TEST_BRANCH ──▶ JFrog cplace-npm-test
   ▲  (release/26.4, main)                  (feature branch + refs to itself,      (npm, @cplace-next/*)
   │                                          test jobs removed)
   └── upstream PRs replayed one by one (cherry-pick + push) to create real changes
```

| Component | Role | Write access in tests |
|---|---|---|
| `clone-cplace-fe` | Consumer repo, a fork of `cplace-fe` (internal) | Everything: branches including `release/*` and `main`, tags, releases, secrets |
| `github-actions` `TEST_BRANCH` | The reusable workflows under test | Only the test branch, and **every push stops for user confirmation** |
| JFrog `cplace-npm-test` | Target npm registry for publishes | Only our own versions, exact paths, never wildcards (see 4.2) |
| `cplace-fe`, the github-actions `master`/`release/*` branches, the real npm registries | Production | **None** |

## 1.2 `clone-cplace-fe` facts (read 2026-11-02)

| Item | Value | Source |
|---|---|---|
| Fork parent | `collaborationFactory/cplace-fe`, visibility internal, default branch `main` | `gh api repos/$R` |
| Branches | `main`, `release/26.4`, plus the leftover `fix/PFM-ISSUE-35119-…` from replay PR #1 | `gh api repos/$R/branches` |
| Fork point `release/26.4` | upstream `b93fdc38e` (PFM-ISSUE-35170, 2026-10-22) | commit list |
| Fork point `main` | upstream `320b61b22` (#3001, 2026-10-23) | commit list |
| Setup commits on `release/26.4` | `5a378a07e` test-fork identity, `58c416208` no CODEOWNERS, `803be74fb` new release caller, `dac8698d3` test jobs removed (HEAD) | 1.3 |
| Setup commits on `main` | `56cd3e364` identity, `a55a9efb5` no CODEOWNERS, `54ca47f60` test jobs removed. Replay PR #1 (`#2989`) merged as `0640d604d`. | commit list |
| Release caller on `release/26.4` | `.github/workflows/fe-release.yml` → `fe-release-flow.yml@test/PFM-ISSUE-34283-release-flow`, `permissions: contents: write`, `secrets: inherit`, concurrency `fe-release-${{ github.ref }}`, non-cancelling | file content |
| Old callers | Deleted on `release/26.4` (`push_to_release.yaml`, `on_tag_pushed.yaml`). **Still present on `main`**, so `main` is not migrated. | contents API |
| Version tags | `version/26.4.1` only. It is lightweight, on `58c416208`, and was released by the **old** flow: run `41081346891` "Frontend Tag Pushed CI", actor `squad-fe` (the PAT user). | refs, runs API |
| GitHub releases | None. The old flow created none, so `releases/latest` returns 404. | releases API |
| Registry state `26.4.1` | 28 `@cplace-next/*` tarballs, created 2026-10-30 15:39–15:44Z. Example dist-tags (`cf-frontend-sdk`): `release-26.4 → 26.4.1`, `snapshot`/`latest → 0.0.0-SNAPSHOT-mvv12a4h-20261030`. | AQL, npm metadata API |
| Secrets | `DOT_NPMRC`, `GIT_USER`, `GIT_USER_EMAIL`, `GIT_USER_TOKEN`, `GRADLE_PROPERTIES`, `JFROG_BASE64_TOKEN`, `JFROG_URL`, `JFROG_USER`. There is no `PERCY_TOKEN`, which is fine because e2e is removed. | `gh api repos/$R/actions/secrets` |
| Default workflow token | `default_workflow_permissions: read` | `gh api repos/$R/actions/permissions/workflow` |
| Rulesets and protection | None on `release/26.4` or `main`, `protected: false`, no repository properties | `rules/branches/*`, `properties/values` |
| Runs with the new flow | `41088060031` (`803be74fb`) and `41432167152` (`dac8698d3`). Both ended with `release` = success and "No projects are affected since version/26.4.1"; `github-release` was skipped. | jobs API, log |

**What the registry target depends on.**
- The artifacts tool writes a dist `.npmrc` with `@cplace-next:registry=${JFROG_URL}`. It sets each dist `package.json` `publishConfig.registry` from the same source (`tools/scripts/artifacts/nx-project.ts:290-341`).
- **The `JFROG_URL` secret therefore decides the target.** The source `publishConfig` change in `5a378a07e` is a second safety net.
- The tool prints the dist `.npmrc` to the job log. The `_auth` value is masked. Preflight P5 uses that log line.

**Release semantics the expectations rely on** (`tools/scripts/artifacts/artifacts-handler.ts:219-302`):
- On a `release/*` push, the tool computes `N` as the highest `version/<line>.*` patch + 1. On a line with no tags it releases the first version of the line.
- **Affected check:** with no project affected since `PREV`, nothing is released. If any project is affected, the publish phase publishes **all publishable projects** at `N`, not only the affected ones. `FORCE` skips the affected check.
- **Order:** publish first, then `git tag` (a lightweight tag) and `git push origin <tag>`. Then the `github-release` job runs `gh release create --verify-tag --generate-notes --latest=<is_latest> [--notes-start-tag PREV]`.
- **npm dist-tag:** a release sets `release-<line>`, from `Version.getNpmTag()`. `latest` and `snapshot` are not touched.
- A tip commit whose subject starts with `[branch-off]` is neither tagged nor published.
- **Guard job:** a dispatch outside the default branch or `release/*` fails. Any workflow file that references `github-actions/.github/workflows/(fe-release|fe-tag).yml@` also fails it.
- **Failure cleanup:** if the `release` job fails or is cancelled after the version file is written and before the tag exists on the remote, the "Unpublish the incomplete release" step deletes every project at `N`.

## 1.3 How the environment was built (recipe for rebuilding)

Steps 1–7 were done once. Repeat them to build a fresh environment, for example for another release line or after the fork is deleted.

1. **Fork on an old commit.**
   - Fork `UP` as `clone-cplace-fe` (internal).
   - Reset its `release/<X.Y>` and `main` to upstream commits a few weeks back.
   - The upstream commits after the fork point are the **replay queue** (1.5). They give real code changes that make projects affected, without inventing commits.
   - Delete all other branches and tags.
2. **Test-fork identity** (commit `5a378a07e` on `release/26.4`, `56cd3e364` on `main`):
   - Rename the root package to `@cplace-next/clone-cplace-fe`, plus the docs and the e2e Docker image and volume names.
   - Point every `publishConfig.registry` to `https://cplace.jfrog.io/artifactory/api/npm/cplace-npm-test/`.
   - Make the scheduled or auto-triggered workflows manual-only: `cron_check_upmerge`, `cron_cleanup_snapshots`, `deploy_storybook`, `auto-pr-upmerge`.
3. **No CODEOWNERS** (`58c416208`), so upstream owners are not asked to review clone PRs.
4. **Secrets** (repository level):
   - `JFROG_URL` = the `cplace-npm-test` npm API URL.
   - `JFROG_USER` / `JFROG_BASE64_TOKEN` = a JFrog identity with deploy **and delete** rights on `cplace-npm-test` only, and no write access to the real npm repositories.
   - `DOT_NPMRC` = a read `.npmrc` for installing dependencies through the cplace npm proxy.
   - `GIT_USER` / `GIT_USER_EMAIL` / `GIT_USER_TOKEN` stay as long as Phase A runs: the 34283 flow declares the PAT as a required secret.
5. **github-actions test branch.**
   - Create `TEST_BRANCH` from the feature branch under test.
   - Commit 1 rewrites **every** internal `collaborationFactory/github-actions/...@master` ref to `@TEST_BRANCH`. In 34283 that is commit `976d511`, touching 14 workflow files.
   - Commit 2 removes the test jobs. In 34283 that is `b8ca5b4`, which removes the `e2e` job and the `RUN_E2E` input, and makes `release` need only `build`.
   - Push it (stop: user confirmation).
   - The test branch must be **recreated** whenever the feature branch changes. Preflight P3 detects drift.
6. **Migrate the release caller on `release/<X.Y>`** (`803be74fb`):
   - Add `.github/workflows/fe-release.yml` from `.github/workflow-templates/fe/fe-release.yml`, with the `uses:` ref set to `@TEST_BRANCH`.
   - In the **same commit**, delete `push_to_release.yaml` and `on_tag_pushed.yaml`.
   - Add the per-caller concurrency blocks to `pull_request.yaml` and `push_main.yaml`.
7. **Remove test jobs from the callers** (`dac8698d3` / `54ca47f60`).
   - Drop the e2e and code-quality jobs from the PR and main callers.
   - Delete the test-only workflows: devkit e2e, visual regression, baseline healing, Windows.
8. **Baseline release.** The line needs one released version so `PREV` exists. Here `version/26.4.1` came from the old flow (run `41081346891`) before step 6.
9. **Tag-push canary** (step S1 in 1.6, not yet done). A tag-triggered workflow that only logs who pushed the tag. Phases A and B differ here.

**Branch protection and rulesets.** Today nothing protects `clone-cplace-fe`. If org rulesets ever start to apply (for example by a repository `type` property), pushes to `release/*` and the teardown can be declined. In that case follow the "Rulesets" section of the backend procedure: an admin sets the property to `generic` for the test window.

## 1.4 Working copy and tools

```bash
WT="$OUT/wt-clone-cplace-fe"
git clone --filter=blob:none --branch release/26.4 https://github.com/collaborationFactory/clone-cplace-fe.git "$WT"
git -C "$WT" remote add upstream https://github.com/collaborationFactory/cplace-fe.git
git -C "$WT" fetch --filter=blob:none upstream release/26.4
```

| Tool | Note |
|---|---|
| `gh` | Version 2.29 locally. Use `gh api` rather than the newer `--json` subcommands, except `gh run view --json` and `gh run rerun`/`cancel`/`watch`, which exist. |
| `jf` | Version 2.53, server id `cplace.jfrog.io`. Pass `$J` on every call. |
| Git Bash on Windows | `export MSYS_NO_PATHCONV=1`, or `jf rt curl /api/...` and `git show <ref>:<path>` get their paths rewritten (seen as `curl: (3) URL rejected`). |
| `jq` | 1.6 is available. |
| GitHub events API | **Not usable as evidence.** For `R` it returned only 10 events and no tag creation. The pusher of a tag is proven by the canary run's actor (S1). |

## 1.5 Replay queue (upstream `release/26.4`, first-parent, after `b93fdc38e`)

Replay in this order, one commit per push. Merge commits use `git cherry-pick -m 1`; squash commits use a plain cherry-pick. The "projects" column lists the top-level project directories each commit touches. It hints at what becomes affected; the tool's log is authoritative.

| # | Upstream SHA | Kind | Subject | Projects touched | Used by |
|---|---|---|---|---|---|
| 1 | `2b5dc05cc61` | merge #2992 | 35089 advanced-search z-index (to 26.4) | cf-ai-companion-e2e, cf-e2e-testing-sdk, cf-frontend-sdk, cf-platform-lib | A2 |
| 2 | `9830623eecd` | merge | Upmerge release/26.3 into release/26.4 | cf-frontend-sdk(-e2e, -visual-e2e), cf-editor-lib, cf-platform-lib | A11 push 1 |
| 3 | `1df8cfc88e5` | commit | cf-editor-lib visual baselines after upmerge | cf-editor-lib-e2e | A11 push 2 |
| 4 | `a1f33f048dc` | merge | Upmerge release/26.3 into release/26.4 | (no project directory) | A11 push 3 |
| 5 | `e2d33835d4b` | squash #2969 | 35090 Rich Text Editor too small | cf-editor-lib | B1 |
| 6 | `4b83e9883e5` | merge #3010 | 35135 split ai-companion e2e (**adds apps**, so the project set changes) | cf-ai-companion-1/2-e2e, … | B2 (or spare) |
| 7 | `d9d83f5a6ee` | merge #3013 | 35238 re-enable tooltip tests | cf-frontend-sdk | spare |
| 8 | `94740beacd2` | squash #2998 | 35129 tooltip in Table 2.0 headers | cf-frontend-sdk, cf-e2e-testing-sdk, table-e2e | spare |
| 9 | `a0ee066eaf8` | merge #3018 | 34449 document handling | cf-ai-companion-1-e2e, cf-platform-lib, … | spare |
| 10 | `d900454c377` | merge #3024 | 35101 attachment permission ceiling | libs/api, cf-platform-lib, … | spare |

Recompute the list before use:

```bash
git -C "$WT" log --first-parent --reverse --format='%h %ad %s' --date=short b93fdc38e..upstream/release/26.4
```

**Replay rules:**
- **Order and conflicts.** Keep the upstream order; skipping a commit can make later ones conflict. If a cherry-pick conflicts in a file changed by the fork setup (`package.json` `publishConfig`, `.github/workflows/*`), keep the **fork's** side and record it. Any other conflict is a stop.
- **Never replay `.github/workflows` changes from upstream** without checking that they don't bring back an old caller. The guard would fail, which is a test in itself (A6) but not wanted here.
- **Direct push vs. PR.** A direct push to `BR` is the production-equivalent event: a merged PR is a push to the branch. The PR route (as used for replay PR #1 on `main`) also works, but adds PR runs that these tests don't need.

## 1.6 One-time additions for these tests

**S1: tag-push canary on `BR`.** Commit and push `.github/workflows/zz-tag-push-canary.yml`:

```yaml
name: 'Tag Push Canary'
on:
  push:
    tags: ['version/*']
permissions: {}
jobs:
  canary:
    runs-on: ubuntu-latest
    steps:
      - run: echo "tag ${{ github.ref_name }} pushed by actor=${{ github.actor }} triggering=${{ github.triggering_actor }}"
```

- Tag pushes run the workflows found in the **tagged commit's** tree. That tree is `BR`, so the canary has to live there. `main`'s `on_tag_pushed.yaml` never fires for a tag on a `BR` commit.
- The canary contains no `fe-release.yml@` / `fe-tag.yml@` reference, so the guard ignores it.
- **Expected:** with a PAT push (Phase A), every new `version/*` tag starts a canary run with actor `squad-fe`. With `GITHUB_TOKEN` (Phase B), it starts **no** run.
- The push that adds the canary also starts a release run. Nothing is affected, so that run is an extra A1 observation.

**S2 (Phase B only): switch the caller to the 34282 test branch.** This needs the 34282 implementation and its test branch, built per 1.3 step 5.
- Commit on `BR`: in `.github/workflows/fe-release.yml`, change `@test/PFM-ISSUE-34283-release-flow` to `@test/PFM-ISSUE-34282-<slug>`.
- Re-apply the current template's header comment if 34282 changed it.
- Change nothing else. Then rerun preflight.

**S3 (optional, A13 only): migrate `main`.** Add the same caller to `main` and delete `push_to_release.yaml` + `on_tag_pushed.yaml` there. Otherwise the guard fails on every `main` dispatch, and the forced snapshot path cannot be tested.

## 1.7 Known differences from production

- **No e2e** in the release flow (`b8ca5b4`), so the `RUN_E2E` input and the e2e→release dependency are not exercised. They are covered statically by actionlint on the feature branch.
- **Size.** The clone is the size of `cplace-fe`, so build times are realistic. The 120-minute `fe-e2e` timeout risk (34283 design risk 3) cannot be measured here.
- **Rulesets.** There is no `version/*` tag ruleset and no branch protection. Behaviour under a tag ruleset (34283 Q10) is not covered.
- **Release lines.** There is a single line (`26.4`), so `is_latest` is always `true` unless A12 creates an older line.
- **Registry.** `cplace-npm-test` is shared with the backend staging (`@cplace-assets/*`). Our scope is `@cplace-next/*`.

---

# Part 2: Execution model (for an agent)

## 2.1 Rules and stops

**The agent runs autonomously except at these stops (ask the user):**
- Every push to `GA` (any branch). The agent never pushes to `UP`, or to `GA`'s `master` or `release/*`.
- **Preflight.** Any preflight check fails.
- **Replay.** A cherry-pick conflict outside the fork-setup files.
- **Results.**
  - An expected-state row fails. Record it, stop the phase, and do not "fix forward".
  - Any registry write outside `cplace-npm-test` or outside `@cplace-next/*` shows up.
- **Phase B.** Before S2, and before deleting or changing a repository secret (B3).
- **Teardown.** Before every JFrog delete (4.2), show the hit list.

**Everything else in `R` is allowed:** pushes to `BR` and throwaway branches, tags, releases, dispatches, re-runs and cancels.

**Runs one at a time.** Except A11, start a case only when the previous case's runs, including canary runs, are completed and evaluated. All cases share the `fe-release-refs/heads/release/26.4` concurrency group, and the release state is cumulative.

## 2.2 Helper library

Write this to `$OUT/lib.sh` and source it in every shell:

```bash
export MSYS_NO_PATHCONV=1 JFROG_CLI_AVOID_NEW_VERSION_WARNING=TRUE
R=collaborationFactory/clone-cplace-fe; J="--server-id cplace.jfrog.io"; LINE=26.4; BR=release/26.4

# snapshot <dir>: tags, releases, npm release versions and dist-tags of @cplace-next/*
snapshot() {
  local d=$1; mkdir -p "$d"
  gh api "repos/$R/git/matching-refs/tags/version/" --jq '.[] | "\(.ref) \(.object.type) \(.object.sha)"' | sort > "$d/tags.txt"
  gh api "repos/$R/releases?per_page=100" \
    --jq '.[] | "\(.tag_name) draft=\(.draft) pre=\(.prerelease) author=\(.author.login)"' | sort > "$d/releases.txt"
  (gh api "repos/$R/releases/latest" --jq .tag_name 2>/dev/null || echo none) > "$d/latest-release.txt"
  jf rt curl $J -s -XPOST /api/search/aql -H 'Content-Type: text/plain' -d \
    'items.find({"repo":"cplace-npm-test","path":{"$match":"@cplace-next/*/-/@cplace-next"},"name":{"$match":"*.tgz"}}).include("path","name","created")' \
    | jq -r '.results[] | "\(.path|split("/")[1])\t\(.name)\t\(.created)"' | grep -v -i snapshot | sort > "$d/npm-tgz.tsv"
  cut -f1 "$d/npm-tgz.tsv" | sort -u > "$d/npm-packages.txt"
  : > "$d/dist-tags.tsv"
  while read -r p; do
    jf rt curl $J -s "/api/npm/cplace-npm-test/-/package/@cplace-next%2F$p/dist-tags" \
      | jq -r --arg p "$p" 'to_entries[] | "\($p)\t\(.key)\t\(.value)"' >> "$d/dist-tags.tsv"
  done < "$d/npm-packages.txt"
  sort -o "$d/dist-tags.tsv" "$d/dist-tags.tsv"
}

# runs_for <sha> <event>: release-flow and canary runs for a commit
runs_for() { gh api "repos/$R/actions/runs?head_sha=$1&event=$2&per_page=20" --jq '.workflow_runs[] | "\(.id) \(.name) \(.status) \(.conclusion)"'; }

# runs_since <iso-time>: every run created since (e.g. the canary on a tag)
runs_since() { gh api "repos/$R/actions/runs?created=>=$1&per_page=50" --jq '.workflow_runs[] | "\(.id)\t\(.name)\t\(.event)\t\(.head_branch)\t\(.actor.login)\t\(.status)/\(.conclusion)"'; }

# capture <run-id> <dir>: run metadata, jobs, full logs
capture() {
  local run=$1 d=$2; mkdir -p "$d"
  gh api "repos/$R/actions/runs/$run" > "$d/run.json"
  gh api "repos/$R/actions/runs/$run/jobs?filter=all&per_page=100" > "$d/jobs.json"
  jq -r '.jobs[] | "\(.name)\t\(.conclusion)\t\(.id)"' "$d/jobs.json" > "$d/jobs.tsv"
  while IFS=$'\t' read -r name _ id; do
    gh api "repos/$R/actions/jobs/$id/logs" > "$d/job-$id.log" 2>/dev/null || true
  done < "$d/jobs.tsv"
}

# wait_run <run-id>: block until completed, print conclusion
wait_run() { until [ "$(gh api repos/$R/actions/runs/$1 --jq .status)" = completed ]; do sleep 30; done; gh api repos/$R/actions/runs/$1 --jq .conclusion; }
```

**Finding the run.**
- After a push: `runs_for "$SHA" push`. It can take 5–20 s to appear, so poll.
- After a dispatch: `runs_since "$T0"` filtered on event `workflow_dispatch` and the branch.
- After a re-run: the same run id with a higher `run_attempt`. Capture the previous attempt **before** re-running: `gh run view $RUN -R $R --attempt <n> --log`.

## 2.3 Per-case procedure

1. `T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)`, then `snapshot "$OUT/<ID>/before"`.
2. Trigger as described in the case. Record the SHA, branch and run id(s) in `$OUT/<ID>/case.env`.
3. `wait_run`, then `capture` into `$OUT/<ID>/run-<id>-<attempt>/`.
4. Wait for the canary or any tag-triggered runs to settle (poll `runs_since "$T0"` until nothing is `in_progress`/`queued` for 60 s). Then `snapshot "$OUT/<ID>/after"`.
5. Registry metadata is recalculated **asynchronously**. If `dist-tags.tsv` lags the tarballs, re-snapshot up to 3 times, 2 minutes apart, before calling a dist-tag row failed.
6. Evaluate every row of the case against the rules in 3.1. Write `$OUT/<ID>/verdict.md` with the comparison table (row, expected, actual, PASS/FAIL, evidence file).
7. Append what the case created (tags, releases, npm versions, branches) to `$OUT/ledger.tsv`. Teardown (Part 4) reads it.
8. Append one line to `$OUT/results.md`: `| <ID> | <runs> | PASS/FAIL | <one-line note> |`.

## 2.4 Preflight (read-only, before Phase A and again after S2)

| ID | Check | Command (sketch) | Pass |
|---|---|---|---|
| P1 | Caller ref | `gh api "repos/$R/contents/.github/workflows/fe-release.yml?ref=$BR" --jq .content \| base64 -d \| grep uses:` | `…/fe-release-flow.yml@$TEST_BRANCH` |
| P2 | Test branch refs point to itself | `git -C <github-actions> grep -nE 'collaborationFactory/github-actions/\.github/.+@' origin/$TEST_BRANCH -- .github \| grep -v "@$TEST_BRANCH"` | empty |
| P3 | Test branch is current | `git log --oneline origin/$TEST_BRANCH..origin/<feature-branch>` | empty (the feature branch has nothing the test branch lacks) |
| P4 | No old callers on `BR` | the guard's grep over `BR`'s `.github/workflows` | empty |
| P5 | Registry target | the last publishing run's log (`41081346891` until a new-flow release exists): `grep -E '@cplace-next:registry='` | `https://cplace.jfrog.io/artifactory/api/npm/cplace-npm-test/` only |
| P6 | Source `publishConfig` | `git -C "$WT" grep -n '"registry"' -- '*/package.json' package.json \| grep -v cplace-npm-test` | empty |
| P7 | Repo settings | workflow permissions, `rules/branches/$BR`, branch protection | `read`, empty, `false` (as in 1.2) |
| P8 | Canary present (after S1) | contents API for `zz-tag-push-canary.yml` on `BR` | exists |
| P9 | No run in flight | `gh api "repos/$R/actions/runs?status=in_progress"` and `?status=queued` | none |
| P10 | Tools | `gh auth status`; `jf rt ping $J` | OK |
| P11 | Start state | `snapshot "$OUT/S0"`; tags = only known versions | matches the ledger (first time: `version/26.4.1` only) |

---

# Part 3: Test cases

## 3.1 Expected-state rules

Each case states its outcome: **RELEASE(N)**, **NO-RELEASE**, **REJECTED** (guard or startup failure), or a case-specific outcome. `S0`/`S1` are the before and after snapshots, and `RUN` is the release-flow run.

**RELEASE(N)**

| Row | Rule | Evidence |
|---|---|---|
| E1 Run | Exactly one "Frontend Release CI" run for the trigger. Conclusion `success`. Jobs `guard`, `install-deps`, `build (*)`, `release`, `github-release` are all `success`. | `jobs.tsv` |
| E2 Version | `N` = the highest `version/26.4.*` patch in S0 + 1 (a forced run: the same). The log says `The calculated new tag/version for branch release/26.4 is N`. | release job log |
| E3 Tag | S1.tags = S0.tags + `refs/tags/version/N`, type `commit` (lightweight), SHA = `RUN.head_sha`. No other tag added or moved. | `tags.txt` diff |
| E4 Publish set | The new tarballs in S1 (S1 − S0 in `npm-tgz.tsv`) are exactly `<p>-N.tgz` for every package in the log's `+ @cplace-next/<p>@N` lines. Their count equals the publishable project count. It equals the previous release's count unless the replayed commit added or removed a project (then explain). All `created` timestamps fall inside the run window. | `npm-tgz.tsv`, log |
| E5 Dist-tags | For every published package, `release-26.4` → `N`. `latest` and `snapshot` are unchanged from S0. | `dist-tags.tsv` diff |
| E6 GitHub release | A release `version/N` exists, `draft=false`, `pre=false`, author `github-actions[bot]`. `latest-release.txt` = `version/N` when `is_latest` (the log/output `is_latest=true`). The body has the compare range `version/PREV...version/N`. If S0 had no release yet, the range still starts at `PREV` (`--notes-start-tag`). | `releases.txt`, `gh api repos/$R/releases/tags/version/N --jq .body` |
| E7 Tag trigger | Phase A: exactly one canary run for `version/N` with actor `squad-fe`. Phase B: **no** run of any workflow for `version/N` (`runs_since T0`, `head_branch == version/N` → none). | `runs_since` |
| E8 No residue | No `version/N` artifacts outside `@cplace-next/*`, and no other version of any `@cplace-next/*` package created in the window | AQL with the time window |

**NO-RELEASE**

| Row | Rule |
|---|---|
| N1 | Run `success`. `release` is `success` with the reason line, or `skipped` (non-forced dispatch). `github-release` is `skipped`. |
| N2 | S1 = S0 for `tags.txt`, `releases.txt`, `npm-tgz.tsv` and `dist-tags.tsv`. No canary run. |

**REJECTED**

| Row | Rule |
|---|---|
| X1 | Run `failure` (guard), or `startup_failure`/`failure` with **no** job started (permission validation). The expected error text appears in the job log or in the run annotations (`gh api repos/$R/check-runs/<job-id>/annotations`, or `gh run view <id> -R $R`). |
| X2 | S1 = S0, as in N2 |

## 3.2 Case overview

| ID | Phase | Ticket | Trigger | Outcome | Needs |
|---|---|---|---|---|---|
| A1 | A | 34283 | push without project changes | NO-RELEASE | – (observed twice already) |
| A2 | A | 34283 | push of replay #1 | RELEASE(26.4.2) | replay #1 |
| A3 | A | 34283 | dispatch, `force=false` | NO-RELEASE (build only) | – |
| A4 | A | 34283 | dispatch, `force=true`, nothing affected | RELEASE | – |
| A5 | A | 34283 | dispatch on a `test/*` branch | REJECTED (guard ref check) | throwaway branch |
| A6 | A | 34283 | push with an old caller in the tree | REJECTED (guard old-caller check) | throwaway `release/99.9` |
| A7 | A | 34283 | push of a `[branch-off]` tip commit | NO-RELEASE (skipped) | – |
| A8 | A | 34283 | forced release, a publish fails midway, then "Re-run failed jobs" | cleanup, then RELEASE (same N) | placeholder package |
| A9 | A | 34283 | forced release cancelled during publish, then re-run | cleanup, then RELEASE (same N) | – |
| A10 | A | 34283 | re-run of `github-release` only (release exists, then deleted) | idempotent / recreated | a RELEASE run |
| A11 | A | 34283 | three pushes in quick succession | 1 RELEASE + 1 cancelled pending + 1 RELEASE/NO-RELEASE | replays #2–#4 |
| A12 | A | 34283 | push of a new older line `release/26.3` | RELEASE(26.3.1) with `latest=false` | optional |
| A13 | A | 34283 | dispatch `force=true` on `main` | snapshot of all projects, no tag, no release | optional, S3 |
| B0 | B | 34282 | preflight after S2 | – | 34282 test branch |
| B1 | B | 34282 | push of replay #5 | RELEASE with **no tag-triggered run** | replay #5 |
| B2 | B | 34282 | per-job token permissions in B1's logs | only `release`/`github-release` have write | B1 |
| B3 | B | 34282 | release without the PAT secret | RELEASE | optional; secret change (stop) |
| B4 | B | 34282 | caller ceiling below the job's request | REJECTED at startup | throwaway `test/*` |
| B5 | B | 34282 | A8 repeated (failure cleanup with `GITHUB_TOKEN`) | as A8 | placeholder package |
| B6 | B | 34282 | A10 repeated (re-run with a fresh `GITHUB_TOKEN`) | as A10 | a B release |
| B7 | B | 34282 | A4 repeated (forced release) | RELEASE, no tag-triggered run | – |

Version numbers in the cases assume the order above starting from S0 = {26.4.1}. Each case computes `N` from its own S0, so the order may change.

## 3.3 Phase A: consolidated flow, PAT tag push (baseline)

### A1: Push with nothing affected

- **Purpose:** a push to `BR` that changes no project creates no release.
- **Evidence so far:** runs `41088060031` and `41432167152`. Both log `No projects are affected since version/26.4.1 therefore no new Patch version is needed`, and `github-release` was skipped.
- **Trigger:** the S1 canary push counts as a third observation.
- **Expected:** NO-RELEASE (N1, N2). The release job log contains `Checking affected projects since version/<PREV>` and the "no new Patch version" line.

### A2: Release on a real change (core case)

- **Purpose:** one push → one run that publishes, tags, and creates the GitHub release. No second run is needed.
- **Trigger:**
  ```bash
  git -C "$WT" cherry-pick -m 1 2b5dc05cc61 && git -C "$WT" push origin HEAD:$BR
  SHA=$(git -C "$WT" rev-parse HEAD)
  ```
- **Expected:** RELEASE(26.4.2), E1–E8.
  - E7 in Phase A: one canary run for `version/26.4.2`, actor `squad-fe`. This is the PAT baseline for B1.
  - The release job log shows `Publish phase: publishing all publishable projects as 26.4.2` and then `Tag phase: pushing version/26.4.2`. Publish lines come before the tag line.
- **Also record:**
  - The publish order (the `+ @cplace-next/` lines in order). A8 uses the last package.
  - The total duration of the `release` job, used for the A9 timing.

### A3: Dispatch without force

- **Trigger:** `gh workflow run fe-release.yml -R $R --ref $BR -f force=false`
- **Expected:** NO-RELEASE.
  - `guard`, `install-deps` and `build` succeed.
  - `release` is **skipped** (its `if:` needs a push or `FORCE`). `github-release` is skipped.

### A4: Forced dispatch with nothing affected

- **Purpose:** `force` is the supported way to release without a change (it replaces hand-made tags).
- **Precondition:** nothing affected since `PREV`. True right after A2 or A3.
- **Trigger:** `gh workflow run fe-release.yml -R $R --ref $BR -f force=true`
- **Expected:** RELEASE(PREV+1), E1–E8.
  - The log contains `Force is set: skipping the affected check`.
  - E3: the tag sits on the dispatched branch head, and `RUN.head_sha` = the `BR` tip at dispatch.

### A5: Dispatch on a non-release branch

- **Trigger:**
  ```bash
  git -C "$WT" push origin $BR:refs/heads/test/fe-release-dispatch
  gh workflow run fe-release.yml -R $R --ref test/fe-release-dispatch -f force=true
  ```
  `test/*` is not a push trigger of the caller, so only the dispatch runs.
- **Expected:** REJECTED.
  - `guard` fails with `::error::The release flow can only be dispatched on the default branch or a release/* branch, not on refs/heads/test/fe-release-dispatch`.
  - No other job runs, and S1 = S0.
- **Cleanup:** delete the branch (`git push origin :test/fe-release-dispatch`).

### A6: Old caller left in the tree

- **Purpose:** the guard stops a run when an old tag-push caller exists. Otherwise a leftover file would double-publish with a PAT-pushed tag.
- **Setup:** branch `release/99.9` from the `BR` tip, plus one commit that adds `.github/workflows/zz-old-caller.yml`.
  - That file is `on: workflow_dispatch` only, with one job `uses: collaborationFactory/github-actions/.github/workflows/fe-tag.yml@test/PFM-ISSUE-34283-release-flow`, so it never runs by itself.
  - The commit subject is `[branch-off] live test: old caller`. If the guard missed the file, the tool would still skip tagging and publishing on the brand-new line `99.9` (A7 logic), so the test cannot release `99.9.1`.
- **Trigger:** `git -C "$WT" push origin HEAD:refs/heads/release/99.9`
- **Expected:** REJECTED.
  - `guard` fails with `Old release callers found: .github/workflows/zz-old-caller.yml`.
  - No tag `version/99.9.*` and no `*-99.9.*` tarball.
- **Cleanup:** delete `release/99.9`. Reset `WT` to `origin/$BR`.

### A7: `[branch-off]` tip commit

- **Trigger:**
  ```bash
  git -C "$WT" commit --allow-empty -m "[branch-off] live test" && git -C "$WT" push origin HEAD:$BR
  ```
- **Expected:** NO-RELEASE. The release job log contains `The subject of the tip commit is '[branch-off] live test'` and `Tip commit is marked with [branch-off], skipping tagging and publishing`.
- **Note:** the empty commit stays on `BR`. It changes no project, so it doesn't affect later cases.

### A8: Publish fails midway; cleanup; re-run releases the same version

- **Purpose:** live check of the "publish before tag" design.
  - A partial publish is unpublished.
  - No tag or release is left.
  - "Re-run failed jobs" releases the **same** `N`.
  - The JFrog identity may delete release versions.
- **Setup** (stop: show the planned upload). Let `N` = the next version and `LAST` = the last package in A2's publish order.
  - Build a placeholder tarball for `@cplace-next/LAST@N` and deploy it, so the real `npm publish` of `LAST` fails with "cannot publish over existing version" after the other packages are published:
    ```bash
    d="$OUT/A8/placeholder"; mkdir -p "$d/package"
    printf '{"name":"@cplace-next/%s","version":"%s","description":"live-test placeholder A8"}\n' "$LAST" "$N" > "$d/package/package.json"
    tar -C "$d" -czf "$d/$LAST-$N.tgz" package
    jf rt u $J "$d/$LAST-$N.tgz" "cplace-npm-test/@cplace-next/$LAST/-/@cplace-next/$LAST-$N.tgz"
    ```
  - Verify the placeholder is visible: `jf rt curl $J -s /api/npm/cplace-npm-test/@cplace-next%2F$LAST` lists `N`. Wait for metadata recalculation if not.
- **Trigger:** `gh workflow run fe-release.yml -R $R --ref $BR -f force=true`
- **Expected, attempt 1:**
  - Run `failure`. In the `release` job, "Publish to Jfrog NPM Registry and Tag" fails on `LAST`. The log shows at least one `+ @cplace-next/…@N` before it.
  - "Check for an incomplete release" logs `version/N was not pushed: unpublishing its artifacts`.
  - "Unpublish the incomplete release" runs and logs `Deleted artifact from Jfrog: …@N` for each published package and the placeholder.
  - `github-release` is skipped.
  - S1: no `version/N` tag and no release. The AQL for `*-N.tgz` under `@cplace-next` returns **0**, and dist-tags are unchanged from S0.
  - A `Deleted artifact` line missing for a published package, or a JFrog 403 on delete, is a FAIL: the JFrog user lacks delete rights. Record it.
- **Trigger 2:** capture attempt 1, then `gh run rerun $RUN -R $R --failed`.
- **Expected, attempt 2:** RELEASE(N), E1–E8 (E1 for attempt 2). The same `N` as attempt 1, not `N+1`.
- **If attempt 1 leaves residue** (tarballs at `N`): stop. Teardown must delete them (4.2) before anything else.

### A9: Cancel during publish; cleanup; re-run

- **Trigger:**
  1. `gh workflow run fe-release.yml -R $R --ref $BR -f force=true` and find `RUN`.
  2. Poll the jobs API until step "Publish to Jfrog NPM Registry and Tag" of `release` is `in_progress`.
  3. Then poll the AQL for `*-N.tgz` until **at least 3** tarballs exist.
  4. `gh run cancel $RUN -R $R`.
- **Expected after the cancel:**
  - Run `cancelled`. The "Check for an incomplete release" and "Unpublish the incomplete release" steps ran (`cancelled()` branch).
  - The AQL for `*-N.tgz` returns 0. No tag, no release.
- **If the cancel lands after the tag push**, the cleanup must log `version/N is already pushed, the release is complete: nothing to clean up`. Record which case occurred, and evaluate E3–E5 instead of the zero rows. The flow is correct either way, but only the first case tests the cleanup. Repeat once if it lands after the tag.
- **Trigger 2:** `gh run rerun $RUN -R $R --failed` (cancelled jobs count as failed).
- **Expected:** RELEASE(N) with the same `N`.

### A10: `github-release` re-run (recovery path)

- **Purpose:** check the README recovery step "Re-run failed jobs" for a failed `github-release`, and that the step is idempotent.
- **Precondition:** a successful RELEASE run `RUN` with tag `version/N` and a release (for example A4's run).
- **Steps:**
  1. Run `gh run rerun $RUN -R $R --job <github-release job id>`.
     - **Expected:** `success`, log `A GitHub release for version/N already exists, nothing to do`, and `releases.txt` unchanged.
  2. Delete only the release: `gh release delete version/N -R $R -y`. Keep the tag. Re-run the same job again.
     - **Expected:** `success`. The release `version/N` is recreated: author `github-actions[bot]`, same compare range as before, `latest` as before.
     - The release job is **not** re-run, so no new publish happens and E4 is unchanged.

### A11: Burst of three pushes (concurrency, affected base)

- **Purpose:**
  - A running release is never cancelled.
  - Only one run waits, and a newer push replaces the waiting run.
  - Because affected is computed against the previous **tag**, the replaced run's changes are not lost.
- **Trigger:** replays #2, #3 and #4, each pushed separately, about 15 s apart, so push 1's run is still in progress:
  ```bash
  for c in 9830623eecd 1df8cfc88e5 a1f33f048dc; do
    git -C "$WT" cherry-pick -m 1 $c 2>/dev/null || git -C "$WT" cherry-pick $c
    git -C "$WT" push origin HEAD:$BR; git -C "$WT" rev-parse HEAD >> "$OUT/A11/shas.txt"; sleep 15
  done
  ```
  Use `-m 1` for merges only. Check each commit's parent count first: `git rev-list --parents -n1 <c>`.
- **Expected:**
  - Run 1 (SHA1): RELEASE(N) with the tag on SHA1.
  - Run 2 (SHA2): `cancelled` while still waiting, never started (no job ran).
  - Run 3 (SHA3): starts only after run 1 completes. Compare the `run_started_at`/job timestamps.
  - Run 3's log: `Checking affected projects since version/N`.
  - If cf-editor-lib-e2e or other projects are affected: RELEASE(N+1), tag on **SHA3**, and the GitHub release range `version/N...version/N+1` covers SHA2 and SHA3. Otherwise NO-RELEASE, and the log's affected list explains why.
  - No run is in progress twice in the group at any time.
- **Evidence:** the three `run.json` files (`status`, `conclusion`, `run_started_at`, `updated_at`) and `jobs.tsv`.

### A12 (optional): Older line, not latest

- **Trigger:** `git -C "$WT" push origin $BR:refs/heads/release/26.3`. The line is new, so the tool releases its first version.
- **Expected:**
  - RELEASE(26.3.1): all publishable projects, dist-tag `release-26.3`.
  - E6 with `is_latest=false`: `latest-release.txt` is unchanged and still the newest `26.4.x`.
  - `release-26.4` is unchanged.
- **Caution:** run this after all 26.4 cases. It leaves a second line, and later teardown must remove it.

### A13 (optional): Forced dispatch on `main` (snapshot path)

- **Precondition:** S3 has been done.
- **Trigger:** `gh workflow run fe-release.yml -R $R --ref main -f force=true`
- **Expected:**
  - `release` runs and logs `Forced release flow on main: publishing a snapshot of all projects`.
  - Every publishable package gets a new `0.0.0-SNAPSHOT-…` version with dist-tag `snapshot` (and `latest` if that is the tool's snapshot behaviour; take S0 as reference).
  - **No** tag and **no** GitHub release. `github-release` is skipped.
  - Snapshot tarballs are filtered out of `npm-tgz.tsv`, so for this case search them with `-i snapshot` and the time window.

## 3.4 Phase B: `GITHUB_TOKEN` with job-scoped permissions (PFM-ISSUE-34282)

These cases run after the 34282 implementation exists. They assume the target state from the [34282 research](../2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/research.md):
- The `release` job checks out without `token:` and declares `contents: write`.
- `GIT_USER_TOKEN` is no longer declared in `fe-release-flow.yml`.
- The other jobs stay `contents: read`; `github-release` keeps `contents: write`.

**Align the expectations with the final 34282 design before running Phase B.** In particular: whether `checks`/`pull-requests` are added, and whether the `GIT_USER*` identity step is removed.

### B0: Switch and preflight

- Do S2 (stop).
- **Run P1–P11** with `TEST_BRANCH=test/PFM-ISSUE-34282-<slug>`.
- **Run a static check of the test branch:**
  - `fe-release-flow.yml` has no `GIT_USER_TOKEN`.
  - The `release` checkout has no `token:`.
  - The `release` job `permissions` = the design's set.
- **The S2 push itself is an A1-type run.** Expect NO-RELEASE. It must **not** fail at startup: the caller ceiling `contents: write` must cover every job request.

### B1: Release on a real change, tag pushed with `GITHUB_TOKEN`

- **Trigger:** replay #5: `git -C "$WT" cherry-pick e2d33835d4b && git -C "$WT" push origin HEAD:$BR`
- **Expected:** RELEASE(N), E1–E6 and E8 as in A2, plus:
  - **E7 (Phase B):** no canary run, and no run of any workflow with `head_branch == version/N`. This is the observable difference from A2, where the canary ran as `squad-fe`. Before evaluating, wait at least 3 minutes after the tag push so a late run would show up.
  - The tag exists and points at `SHA` (E3), so the push with `GITHUB_TOKEN` succeeded.
  - The `release` job log has no authentication error on `git push` or `git ls-remote`.
- **If the design removed the git identity step:** the tag is created (lightweight tags need no identity), and the log contains no `Please tell me who you are`.

### B2: Token permissions per job

- **Source:** B1's job logs. Each job log starts with a `GITHUB_TOKEN Permissions` group listing the effective scopes.
  ```bash
  for f in "$OUT/B1"/run-*/job-*.log; do echo "== $f"; sed -n '/GITHUB_TOKEN Permissions/,/##\[endgroup\]/p' "$f" | sed 's/^[0-9TZ:.-]* //'; done
  ```
- **Expected:**
  - `guard`, `install-deps`, `build (*)`: `Contents: read` and `Metadata: read` only.
  - `release`: `Contents: write` and `Metadata: read`, plus only the scopes the 34282 design adds.
  - `github-release`: `Contents: write` and `Metadata: read`.
  - **No job** has `Checks`, `PullRequests`, `Issues` or `Actions` unless the design lists them.
- **Phase A comparison:** A2's `release` job showed `Contents: read`, because the PAT carried the push. Record both side by side.

### B3 (optional, stop): Release without the PAT secret

- **Purpose:** the strongest proof that the PAT is out of the tag and release path.
- **Precondition:** the user confirms that the `GIT_USER_TOKEN` value can be restored, or is no longer needed in `R`. Phase A cannot run again without it, because the 34283 flow declares it as required.
- **Step:** `gh secret delete GIT_USER_TOKEN -R $R`, then run A4's trigger (forced dispatch).
- **Expected:** RELEASE, E1–E8 with E7 Phase B.
  - A startup error like `Secret GIT_USER_TOKEN is required, but not provided` is a FAIL: the declaration is still there.
- **Restore** (if wanted): `gh secret set GIT_USER_TOKEN -R $R` (the user supplies the value).

### B4: Caller ceiling below the job request (negative)

- **Purpose:** the release job's write scope comes from its own job-level block, inside the caller's ceiling. A caller that grants less is rejected before anything runs. This is the failure every consumer would see if the template ceiling were wrong.
- **Setup:** branch `test/ceiling` from `BR`, plus one commit that changes `fe-release.yml`'s top-level `permissions` to `contents: read`.
- **Trigger:** `gh workflow run fe-release.yml -R $R --ref test/ceiling -f force=false`
  - Using `test/*` plus a dispatch without force is safe: if the startup check passed, the guard would fail on the ref. If the guard also passed, nothing is published without force.
- **Expected:** REJECTED at startup.
  - No job started (`jobs.tsv` empty or no job with a `started_at`).
  - The run error says the nested job `release` (and `github-release`) requests `contents: write` but is only allowed `contents: read`.
  - **If instead `guard` runs and fails on the ref, the ceiling was not enforced: FAIL.**
- **Cleanup:** delete `test/ceiling`.

### B5: Failure cleanup with `GITHUB_TOKEN`

- Repeat A8 with `N` = the next version.
- **Additional check:** in attempt 1, "Check for an incomplete release" ran `git ls-remote` successfully with the checkout's persisted `GITHUB_TOKEN`. The log has the `was not pushed` line and no auth error.
- **Attempt 2** pushes the tag with `GITHUB_TOKEN`. E7 Phase B applies.

### B6: `github-release` re-run with a fresh token

- Repeat A10 on a Phase B release. **Expected:** as A10. The re-run job gets a new `GITHUB_TOKEN` and still has `contents: write`.

### B7: Forced release

- Repeat A4. **Expected:** as A4, with E7 Phase B (no tag-triggered run).

---

# Part 4: Cleanup and teardown

## 4.1 After each case

Throwaway branches (`test/fe-release-dispatch`, `release/99.9`, `test/ceiling`) are deleted inside their case. Cumulative release state on `BR` stays during the series: tags, releases, npm versions. Later cases compute `N` from it.

## 4.2 JFrog rule

`cplace-npm-test` is shared. Delete only our own versions:
1. **No wildcard in a delete.** Never a whole package or repo.
2. **The expected list comes from the ledger:** the versions our runs created, and the A8/B5 placeholders if any are left.
3. **Search first** with the exact repo, path and name, and the run's time window. Show the hit list (stop). It must equal the expected list.
4. **Generate the delete spec from the checked hits**, one exact path per file. Then run a wildcard guard and a `--dry-run` whose count equals the hits.
5. **The re-search decides success** (0 hits), not `jf rt del`'s exit code.
6. **Never delete npm package metadata** by hand, and never trigger a repo-wide reindex. A version still listed in metadata a few minutes after the delete is normal (asynchronous recalculation). A listing that persists is a stop.

Each npm version is a tarball `cplace-npm-test/@cplace-next/<p>/-/@cplace-next/<p>-<v>.tgz`. If present, it also has a metadata JSON under `cplace-npm-test/.npm/@cplace-next/<p>/`. Search both paths, as in the backend procedure's npm cleanup.

## 4.3 Teardown (end of the series, stop before each step)

1. **Decide with the user** what stays. By default the series' versions and tags can stay, because `clone-cplace-fe` and `cplace-npm-test` are test-only. Only residue from failed cases must go.
2. **Tags and releases** in the ledger: `gh release delete <t> -R $R -y`, then `git push origin :refs/tags/<t>`.
3. **npm versions** in the ledger: follow 4.2.
4. **Branches.**
   - Delete `release/26.3` (A12) and any leftover throwaway branches.
   - To make the replay queue reusable, force-push `BR` back to its pre-series tip from `$OUT/S0` (`dac8698d3`, or the canary commit if S1 should stay).
5. **Secrets:** restore `GIT_USER_TOKEN` if B3 removed it and Phase A must stay runnable.
6. **github-actions:** delete the test branches only after the user confirms. Pushing their deletion is a stop.

**Verify:**
- The tag and release lists equal the agreed end state.
- AQL for every deleted version returns 0.
- No run is in flight.
- `$OUT/results.md` lists every case with a verdict.

## 4.4 Report

`$OUT/results.md` holds:
- the case table (ID, run ids and attempts, verdict, note)
- the Phase A vs. Phase B comparison for A2/B1 (E7, the B2 permissions) and A8/B5 (cleanup)
- the deviations, each with the evidence file

Copy the Phase A table into the PR #183 description as the live-validation evidence, and tick the plan's "live validation done or consciously deferred" checkbox ([plan.md](./plan.md), line 716). The Phase B table goes into the PFM-ISSUE-34282 PR.
