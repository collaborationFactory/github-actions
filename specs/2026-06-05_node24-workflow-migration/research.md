---
date: 2026-06-05T11:40:01+02:00
git_commit: 5c4ba52cf4256afc3b8808b09748c55d46dd059e
branch: feature/PFM-TASK-7777-github-actions-Upgrade-GitHub-Actions-to-Support
topic: "Node 24 migration of all 13 reusable FE workflows (PFM-TASK-7777)"
tags: [research, codebase, github-actions, node24, workflows, composite-actions, sha-pinning]
status: complete
last_updated: 2026-06-05
---

# Research: Node 24 Migration of All 13 Reusable FE Workflows (PFM-TASK-7777)

**Date**: 2026-06-05T11:40:01+02:00
**Git Commit**: `5c4ba52cf4256afc3b8808b09748c55d46dd059e` (= tip of `origin/release/25.2`; feature branch has no own commits yet, working tree clean)
**Branch**: `feature/PFM-TASK-7777-github-actions-Upgrade-GitHub-Actions-to-Support`

## Research Question

Make all 13 reusable FE workflows (`.github/workflows/fe-*.yml`) Node 24 compatible before GitHub's default switch on **June 16, 2026** (hard deadline: fall 2026, Node 20 removal). This document captures the verified current-state inventory of the repo at `release/25.2` level, plus all scope decisions, replacement designs, and verified facts carried over from prior sessions — so design/plan steps are fully self-contained.

## Summary

- The repo contains exactly **13 workflow files, all `fe-*.yml`, all reusable** (`on: workflow_call`). No other workflows exist.
- **65 `uses:` occurrences** total. Four third-party "dead" actions confirmed: `bduff9/use-npmrc` (×7), `dawidd6/action-get-tag` (×1), `thollander/actions-comment-pull-request` (×1), `styfle/cancel-workflow-action@0.9.1` (×2). **Exhaustive scan confirms no other third-party actions exist.**
- 4 internal composite actions (`artifacts`, `run-many`, `snapshots`, `upmerge`), all referenced `@release/25.2` (×10 occurrences) — pure shell, Node-runtime-agnostic.
- No `.github/dependabot.yml` exists. `README.md` is exactly 1 line. No `specs/` or `.planning/` existed before this document.
- **Two corrections to the prior handoff**: `setup-node@v3` is ×11 (not ×10); `checkout@v4` is ×13 (plus ×1 `@v5` = 14 total). All other counts confirmed.
- **Two implementation-relevant discoveries**: fe-sonar's `use-npmrc` step carries an `if:` guard and `id:`; fe-release.yml already has a workflow-level `env:` block (test-branch FORCE var must merge into it).

## Detailed Findings

### Workflow file inventory (13 files, all reusable)

| Workflow | Job(s) | runs-on | Workflow-level `env:` |
|---|---|---|---|
| `fe-build.yml` | `build` | `ubuntu-latest` | no (job-level: `jobCount`, `NODE_OPTIONS`) |
| `fe-check-upmerge.yml` | `check-upmerge` | `ubuntu-latest` | no |
| `fe-cleanup-snapshots.yml` | `build` | `ubuntu-latest` | no |
| `fe-code-quality.yml` | `code-quality`, `check-sonar`, `sonar` | `ubuntu-latest` ×2, `${{ inputs.GITHUB_RUNNER }}` (sonar job, fe-code-quality.yml:113) | no (job-level on `code-quality`) |
| `fe-e2e.yml` | `e2e` | `ubuntu-latest` | no (job-level: `jobCount`) |
| `fe-install-deps.yml` | `install-deps` | `ubuntu-latest` | no |
| `fe-licenses.yml` | `check-licenses` | `ubuntu-latest` | no |
| `fe-pr-close.yml` | `remove-artifacts` | `ubuntu-latest` | no |
| `fe-pr-snapshot.yml` | `publish-pr-snapshot` | `ubuntu-latest` | no |
| `fe-release.yml` | `release-version` | `ubuntu-latest` | **YES** (lines 15–17: `NX_BRANCH`, `NX_RUN_GROUP`) |
| `fe-snapshot.yml` | `snapshot` | `ubuntu-latest` | no |
| `fe-sonar.yml` | `sonarqube-scan` | `${{ inputs.GITHUB_RUNNER }}` (fe-sonar.yml:33, default `'medium'`) | no |
| `fe-tag.yml` | `tag` | `ubuntu-latest` | no |

⚠️ **For the test branch** (workflow-level `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` in all 13 files): in `fe-release.yml` the key must be **added to the existing `env:` block** (lines 15–17), not as a new block.

### Complete `uses:` inventory (65 occurrences)

#### Official actions — to be unified & SHA-pinned

| Action | Current versions | Occurrences (file:line) |
|---|---|---|
| `actions/checkout` | `@v4` ×13, `@v5` ×1 | v4: fe-build:29, fe-check-upmerge:18, fe-cleanup-snapshots:20, fe-code-quality:42 + 125, fe-e2e:27, fe-install-deps:22, fe-licenses:25, fe-pr-close:23, fe-pr-snapshot:25, fe-release:23, fe-snapshot:26, fe-tag:30 — v5: fe-sonar:40 |
| `actions/setup-node` | `@v3` ×11, `@v4` ×1, `@v6` ×1 | v3: fe-build:33, fe-check-upmerge:23, fe-cleanup-snapshots:25, fe-e2e:32, fe-install-deps:27, fe-licenses:30, fe-pr-close:28, fe-pr-snapshot:30, fe-release:28, fe-snapshot:31, fe-tag:35 — v4: fe-code-quality:47 — v6: fe-sonar:45 |
| `actions/cache` | `@v4` ×13 | fe-build:38, fe-check-upmerge:29, fe-cleanup-snapshots:31, fe-code-quality:52, fe-e2e:37, fe-install-deps:32, fe-licenses:35, fe-pr-close:33, fe-pr-snapshot:35, fe-release:34, fe-snapshot:36, fe-sonar:51, fe-tag:40 |
| `actions/upload-artifact` | `@v4` ×3 | fe-code-quality:79, fe-e2e:60, fe-e2e:68 |
| `actions/download-artifact` | `@v4` ×1 | fe-code-quality:142 |
| `SonarSource/sonarqube-scan-action` | `@v6` ×2 | fe-code-quality:180, fe-sonar:129 |

Note: `fe-sonar.yml` was independently updated earlier (checkout@v5, setup-node@v6, use-npmrc@v1.2) — only file already on Node-24-era actions. `fe-code-quality.yml` is a partial outlier (setup-node@v4).

#### Internal composite actions — keep branch refs (`@release/X.Y`)

| Composite | Occurrences (file:line) |
|---|---|
| `.github/actions/artifacts` `@release/25.2` ×5 | fe-pr-close:48, fe-pr-snapshot:50, fe-release:53, fe-snapshot:42, fe-tag:51 |
| `.github/actions/run-many` `@release/25.2` ×3 | fe-build:44, fe-code-quality:68, fe-e2e:46 |
| `.github/actions/upmerge` `@release/25.2` ×1 | fe-check-upmerge:35 |
| `.github/actions/snapshots` `@release/25.2` ×1 | fe-cleanup-snapshots:42 |

All 4 are pure shell composites → unaffected by Node runtime (verified previously). These `@release/25.2` refs are the pattern the new `use-npmrc` composite must follow.

#### Dead third-party actions — replacement sites (exhaustive; no others exist)

**1. `bduff9/use-npmrc` — 7 occurrences in 7 files** → replace with own composite `.github/actions/use-npmrc`

| File | Line | Version | Specialties |
|---|---|---|---|
| `fe-cleanup-snapshots.yml` | 37 | `@v1.1` | — |
| `fe-pr-snapshot.yml` | 41 | `@v1.1` | — |
| `fe-licenses.yml` | 41 | `@v1.1` | — |
| `fe-sonar.yml` | 59 | `@v1.2` | **`if: steps.npm-cache.outputs.cache-hit != 'true'`** + **`id: use-npmrc`** — only call site with guard/id; both stay, only `uses:` line changes |
| `fe-release.yml` | 40 | `@v1.1` | — |
| `fe-install-deps.yml` | 38 | `@v1.1` | — |
| `fe-pr-close.yml` | 39 | `@v1.1` | — |

Every call site passes exactly one input: `dot-npmrc: ${{ secrets.DOT_NPMRC }}` — the composite keeps that input name, so only the `uses:` line changes. `fe-snapshot.yml` does **not** use it.

**2. `dawidd6/action-get-tag@v1` — fe-release.yml:48–50** → delete, use `github.ref_name`

```yaml
      - name: Get tag
        id: tag
        uses: dawidd6/action-get-tag@v1
```
Output consumed **exactly once**, at fe-release.yml:58: `TAG: ${{ steps.tag.outputs.tag }}` (env of the "Build and Push to Jfrog NPM Registry" step). No other consumer, no job-`outputs:` propagation. → change to `TAG: ${{ github.ref_name }}` (caller only triggers on `push: tags: ['*/*']` — verified).

**3. `thollander/actions-comment-pull-request@v3` — fe-pr-snapshot.yml:59–66** → replace with `actions/github-script` upsert

```yaml
      - name: comment published Artifacts on PR
        uses: thollander/actions-comment-pull-request@v3
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          file-path: githubCommentsForPR.txt
          comment-tag: published-artifacts
          mode: upsert
```
- Last step in the job; `githubCommentsForPR.txt` is written by the preceding `artifacts` composite step (fe-pr-snapshot.yml:49–57) into `$GITHUB_WORKSPACE` root (no `working-directory:` anywhere).
- Existing comment-tag is `published-artifacts` → the new marker `<!-- published-artifacts -->` matches semantically (thollander internally uses `<!-- thollander/actions-comment-pull-request "published-artifacts" -->`, hence the accepted one-time duplicate on open PRs).

**4. `styfle/cancel-workflow-action@0.9.1` — ×2** → replace with job-level `concurrency:`

| File | Lines | Job | Notes |
|---|---|---|---|
| `fe-licenses.yml` | 20–23 | `check-licenses` | First step of the job; `with: access_token: ${{ github.token }}`; **no `concurrency:` anywhere in file** |
| `fe-install-deps.yml` | 17–20 | `install-deps` | Identical shape; **no `concurrency:` anywhere in file** |

### Supporting repo state

- **`README.md`**: exactly 1 line (`# GitHub actions for collaboration Factory`) → new English Node-24 section goes here (decision #13).
- **`.github/dependabot.yml`**: does not exist → to be created (ecosystem `github-actions`, weekly; serves `master` only — decision #16).
- **`tools/scripts/`**: 3 TS subprojects (`artifacts/` 17 files, `run-many/` 2, `upmerge/` 3). No shell scripts. Plain `git push`/`git config`, no `extraheader` tricks → `checkout@v6` credential-file change is safe (verified previously).

## Code References

- `.github/workflows/fe-sonar.yml:56-61` — guarded `use-npmrc` step (`if:` + `id:`), version `@v1.2`
- `.github/workflows/fe-release.yml:15-17` — existing workflow-level `env:` (merge FORCE var here on test branch)
- `.github/workflows/fe-release.yml:48-50` — `dawidd6/action-get-tag` step to delete
- `.github/workflows/fe-release.yml:58` — sole consumer `TAG: ${{ steps.tag.outputs.tag }}`
- `.github/workflows/fe-pr-snapshot.yml:59-66` — thollander step to replace
- `.github/workflows/fe-pr-snapshot.yml:49-57` — producer of `githubCommentsForPR.txt`
- `.github/workflows/fe-licenses.yml:20-23` / `fe-install-deps.yml:17-20` — styfle steps to delete
- `.github/workflows/fe-code-quality.yml:113`, `fe-sonar.yml:33` — `runs-on: ${{ inputs.GITHUB_RUNNER }}` (self-hosted, default `'medium'`)
- `.github/actions/{artifacts,run-many,snapshots,upmerge}/action.yml` — existing composites (pattern for new `use-npmrc`)

## Architecture Insights

- **All 13 workflows are reusable** (`workflow_call`); consumer repos call them `@master`/`@release/X.Y`. Inputs/secrets interface is untouched by this migration → consumer repos need no changes.
- **Branch-off model**: internal composites are referenced `@release/25.2` on this branch; after each upmerge the ref must point to the respective branch (`@release/25.3`, …, `@master`). The new `use-npmrc` composite inherits this rule — verify with `git grep "use-npmrc@"` after each upmerge.
- **fe-sonar.yml is the proof-of-concept**: already on checkout@v5 (Node 24 runtime) since 2026-03-02, ran green on self-hosted runners on 2026-04-01 → fleet is ≥ 2.327.1.
- The `styfle` action predates GitHub's native `concurrency:` feature — replacement is strictly simpler (declarative, no token).

## Scope Decisions (confirmed by user — carried over, binding)

| # | Decision |
|---|---|
| 1 | **Only this repo.** Consumer repos untouched. BE `hmarr/debug-action` done elsewhere — ignore. |
| 2 | **Base: `release/25.2`**, upmerge chain `25.3 → 25.4 → 26.1 → 26.2 → master`, one PR per branch. Branches near-identical in action usage (verified). |
| 3 | `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` only on test branch (workflow-level `env:`, all 13 files), never merged. |
| 4 | Official actions → latest majors, unified everywhere. |
| 5 | `sonarqube-scan-action` → v8 (SonarCloud in use; v6 internally pins Node 20). |
| 6 | `bduff9/use-npmrc` → own composite `.github/actions/use-npmrc`, input name `dot-npmrc` kept. |
| 7 | `dawidd6/action-get-tag` → `TAG: ${{ github.ref_name }}`. |
| 8 | `thollander` → `actions/github-script` marker-based upsert. |
| 9 | `styfle` → job-level `concurrency:` + `cancel-in-progress: true`. |
| 10 | Release test = real patch release tag on test repo (harmless JFrog publish accepted). |
| 13 | README: short English section (Node 24 compatible, action baseline, runners ≥ 2.327.1, `use-npmrc` composite). |
| 16 | **SHA-pin ALL external actions** (incl. `actions/*`) with `# vX.Y.Z` comment; own composites keep branch refs. Add `.github/dependabot.yml` (github-actions, weekly, master only). |

## Target Versions (latest as of 2026-06-05 — resolve commit SHAs at implementation time)

| Action | From (verified today) | To |
|---|---|---|
| `actions/checkout` | v4 ×13, v5 ×1 | **v6.0.3** |
| `actions/cache` | v4 ×13 | **v5.0.5** |
| `actions/setup-node` | v3 ×11, v4 ×1, v6 ×1 | **v6.4.0** |
| `actions/upload-artifact` | v4 ×3 | **v7.0.1** |
| `actions/download-artifact` | v4 ×1 | **v8.0.1** |
| `actions/github-script` | (new) | **v9.0.0** |
| `SonarSource/sonarqube-scan-action` | v6 ×2 | **v8.1.0** — SHA resolved: `7006c4492b2e0ee0f816d36501671557c97f5995` (lightweight tag) |

SHA resolution: `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` — **dereference annotated tags to commit SHAs**.

## Replacement Designs (agreed verbatim)

### use-npmrc composite (`.github/actions/use-npmrc/action.yml`)

```yaml
name: 'Use .npmrc'
description: 'Writes the given .npmrc content to ~/.npmrc'
inputs:
  dot-npmrc:
    description: 'Content of the .npmrc file'
    required: true
runs:
  using: 'composite'
  steps:
    - name: Write ~/.npmrc
      shell: bash
      env:
        DOT_NPMRC: ${{ inputs.dot-npmrc }}
      run: echo "$DOT_NPMRC" > ~/.npmrc
```

Reference branch-specific: `collaborationFactory/github-actions/.github/actions/use-npmrc@release/25.2` etc. Call sites keep `with: dot-npmrc: ${{ secrets.DOT_NPMRC }}`; fe-sonar keeps its `if:`/`id:`.

### PR comment upsert (fe-pr-snapshot.yml)

```yaml
- name: comment published Artifacts on PR
  uses: actions/github-script@<sha> # v9.0.0
  with:
    script: |
      const fs = require('fs');
      const marker = '<!-- published-artifacts -->';
      const body = marker + '\n' + fs.readFileSync('githubCommentsForPR.txt', 'utf8');
      const { data: comments } = await github.rest.issues.listComments({
        ...context.repo, issue_number: context.issue.number });
      const existing = comments.find(c => c.body.includes(marker));
      if (existing) {
        await github.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body });
      } else {
        await github.rest.issues.createComment({ ...context.repo, issue_number: context.issue.number, body });
      }
```

Accepted cosmetic edge: open PRs with an old thollander comment get one duplicate on first run.

### Cancel previous runs (fe-licenses `check-licenses`, fe-install-deps `install-deps`)

Delete styfle step; add at job level (group name per workflow):

```yaml
    concurrency:
      group: fe-install-deps-${{ github.ref }}
      cancel-in-progress: true
```

Accepted gap: runs already past this job keep running (minutes only).

### fe-release.yml tag

Delete `Get tag` step (fe-release.yml:48–50); fe-release.yml:58 → `TAG: ${{ github.ref_name }}`.

## Verified Facts (prior sessions — do not re-research)

- All 4 existing composites are pure shell → Node-runtime-agnostic.
- TS scripts: plain `git push`/`git config`, no `extraheader` → checkout@v6 safe.
- Self-hosted fleet ≥ 2.327.1 (fe-sonar on checkout@v5 since 2026-03-02, green 2026-04-01; red runs 2026-05-05 were caller-side, PFM-TASK-7524 territory).
- Breaking changes reviewed: upload-artifact v7 (opt-in only), download-artifact v8 (hash mismatch errors — accepted), checkout v6 (separate cred file — safe), sonarqube-scan v8 (`skipSignatureVerification` default false — runners have internet).
- `fe-check-upmerge.yml` not covered by test repo → accepted residual risk, validated by first real run after merge.
- Test repo `cplace-remote-filesystem-fe` calls 12/13 workflows (all except fe-check-upmerge); all 4 dead actions are in covered workflows.

## Implementation Plan (carried over)

1. Branch `feature/PFM-TASK-7777-node24-migration` off `origin/release/25.2`. *(Note: current branch `feature/PFM-TASK-7777-github-actions-Upgrade-GitHub-Actions-to-Support` already sits at the `release/25.2` tip with a clean tree — may be reused.)*
2. Resolve commit SHAs via `gh api` (dereference annotated tags).
3. Apply 6 building blocks + SHA pinning across all 13 workflows; add `.github/actions/use-npmrc/action.yml` (`@release/25.2` on this branch), `.github/dependabot.yml`, README section.
4. Separate test branch = implementation + `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` (all 13 files; in fe-release.yml merge into existing `env:`).
5. Test in `cplace-remote-filesystem-fe` (callers `@<test-branch>`): PR open (licenses, pr-snapshot, code-quality, install-deps, build, e2e) → PR close → push (snapshot) → real patch release tag (fe-release + fe-tag) → `workflow_dispatch` (sonar-scan). **Zero Node deprecation warnings.**
6. PR into `release/25.2` (without FORCE var), then upmerge PRs per branch. After each: `git grep "use-npmrc@"` must show that branch's ref. SHA pins branch-identical — no conflicts expected.
7. Revert test-repo branch; delete test branches.

## Deliberately NOT in Scope (mention in PR description)

- Build Node version mix (`node-version: 22.15.0` hardcoded in fe-install-deps vs. `node-version-file: .nvmrc` in fe-sonar).
- Caller-level `concurrency:` in consumer repos (cleaner cancel solution) — separate ticket if wanted.
- Dependabot for release branches — accepted gap, manual backport path exists.

## Historical Context (from specs/)

None — this is the first document in `specs/`; no `.planning/` directory exists in this repo.

## Related Research

None in this repo. External context: PFM-TASK-7777 (this task), PFM-TASK-7524 (caller-side sonar workflow issues, unrelated), PFM-TASK-7528 (`fe-sonar.yml` fix, commit 916fe05).

## Open Questions

1. **Branch naming**: plan says `feature/PFM-TASK-7777-node24-migration`, but the existing clean branch `feature/PFM-TASK-7777-github-actions-Upgrade-GitHub-Actions-to-Support` already sits at the `release/25.2` tip — reuse or recreate?
2. **Concurrency group uniqueness**: reusable workflows run in the caller's context; with `group: fe-install-deps-${{ github.ref }}` two *different* consumer repos can't collide (concurrency is repo-scoped), but if one repo calls the same reusable workflow from two different caller workflows on the same ref, they'd share a group. Verify whether that matters for any consumer (likely not — accepted styfle behavior was even broader).
3. **Target versions are "latest as of 2026-06-05"** — re-verify latest patch releases at implementation time when resolving SHAs.
