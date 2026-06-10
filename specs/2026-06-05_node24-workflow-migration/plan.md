# Node 24 Migration of All 13 Reusable FE Workflows — Implementation Plan

## Overview

Migrate all 13 reusable FE workflows (`.github/workflows/fe-*.yml`) to Node 24 compatibility before GitHub's default runtime switch on **June 16, 2026**: replace 4 dead third-party actions, unify + SHA-pin all official actions to latest majors, add an own `use-npmrc` composite, Dependabot config, and a README section. Validate via a separate FORCE-var test branch against `cplace-remote-filesystem-fe`, then open the PR into `release/25.2`.

**Scope of this plan:** ends when the implementation PR into `release/25.2` is opened and cleanup is done. The 5 upmerge PRs (`25.3 → 25.4 → 26.1 → 26.2 → master`) are documented in [Migration Notes](#migration-notes) only.

## Current State Analysis

Verified against HEAD `5c4ba52` (= `origin/release/25.2` tip) on branch `feature/PFM-TASK-7777-github-actions-Upgrade-GitHub-Actions-to-Support` (clean except untracked `specs/`):

- 13 workflow files, all reusable (`on: workflow_call`); consumed by FE repos `@master`/`@release/X.Y`
- Official actions on mixed outdated majors: `checkout@v4` ×13 / `@v5` ×1, `setup-node@v3` ×11 / `@v4` ×1 / `@v6` ×1, `cache@v4` ×13, `upload-artifact@v4` ×3, `download-artifact@v4` ×1, `SonarSource/sonarqube-scan-action@v6` ×2
- 4 dead third-party actions: `bduff9/use-npmrc` ×7, `dawidd6/action-get-tag` ×1, `thollander/actions-comment-pull-request` ×1, `styfle/cancel-workflow-action@0.9.1` ×2 — exhaustive, no others exist
- 4 internal pure-shell composites (`artifacts`, `run-many`, `snapshots`, `upmerge`), all `@release/25.2` — Node-runtime-agnostic, untouched
- No `.github/dependabot.yml`; `README.md` is 1 line
- Test repo `cplace-remote-filesystem-fe` is **not** checked out locally (clone in Phase 5); covers 12/13 workflows (all except `fe-check-upmerge`)
- `gh` CLI authenticated (account Benno42); `actionlint` not installed (installed in Phase 1)

## Desired End State

- All 13 workflows run cleanly under Node 24 (**zero Node deprecation warnings** in test-repo runs)
- `git grep -E "bduff9/|dawidd6/|thollander/|styfle/"` → no matches
- Every external action reference is `uses: <owner>/<repo>@<40-char-sha> # vX.Y.Z`, version-unified across all files
- Own composites still referenced by branch ref (`@release/25.2` on this branch)
- New files exist: `.github/actions/use-npmrc/action.yml`, `.github/dependabot.yml`, README Node-24 section
- Implementation PR open against `release/25.2` with 8 reviewable commits; test branches cleaned up
- Consumer repos need **zero changes** (inputs/secrets interface untouched)

### Key Discoveries:

- All file:line references below verified against live code at `5c4ba52` (full re-verification done at planning time)
- `fe-sonar.yml:56-61` — the only `use-npmrc` call site with `if: steps.npm-cache.outputs.cache-hit != 'true'` and `id: use-npmrc`; both **stay**, only the `uses:` line changes
- `fe-release.yml:15-17` — existing workflow-level `env:` block (`NX_BRANCH`, `NX_RUN_GROUP`); the test-branch FORCE var must be **merged into it**, not added as a second block
- `fe-sonar.yml:35` — job-level `if:` only runs for `master`/`main`/`release/*` refs → the test-repo caller branch must be named `release/...` so the sonar job actually executes (see Phase 5)
- The 4 existing composites (e.g. `.github/actions/snapshots/action.yml`) are the style pattern for the new `use-npmrc` composite: pure shell, minimal
- Pre-existing quirk, **do not touch**: `fe-licenses.yml:1` carries the copy-paste `name: Frontend Install Dependencies Workflow`
- Commit-message convention from git log: `PFM-TASK-7777 <description>`

## What We're NOT Doing

- Consumer repo changes of any kind (incl. caller-level `concurrency:` — separate ticket if wanted)
- Build Node version unification (`node-version: 18.19.1` / `22.15.0` hardcodes vs `.nvmrc` in fe-sonar)
- Dependabot for release branches (accepted gap; manual backport path exists)
- BE workflows / `hmarr/debug-action` (handled elsewhere)
- The 5 upmerge PRs (documented in Migration Notes, executed after this plan)
- Fixing the `fe-licenses.yml` workflow `name:` copy-paste quirk (unrelated to this task)

## Implementation Approach

8 commits on the existing branch `feature/PFM-TASK-7777-github-actions-Upgrade-GitHub-Actions-to-Support`, one per building block (mechanical SHA-pin commit isolated from the 4 semantic replacement commits for reviewability). All replacement designs are **binding and verbatim** from [research.md](./research.md) — no design freedom during implementation. Validation runs on a separate test branch (implementation + FORCE var, never merged) against `cplace-remote-filesystem-fe`.

**Line-number stability:** Phases 2–3 replace `uses:` lines 1:1 (same line count), so the file:line references below stay valid across commits a–c. Commits d–f delete lines — their references are given relative to the still-unshifted state and each names the anchor text, so use the anchor text, not blind line numbers.

**Patterns established:**
- Composite style: `.github/actions/snapshots/action.yml` (pure shell, `shell: bash` per step)
- Replacement YAML/JS: verbatim blocks in research.md sections "Replacement Designs"
- No test framework exists in this repo; the "test pattern" is the real-run validation matrix in Phase 5

---

## Phase 1: Preflight & SHA Resolution

### Overview

De-risk everything downstream: tooling baseline, branch state check, re-verify target versions, resolve all 7 commit SHAs. Produces `sha-pins.md` — the single source of truth for Phases 2–3. **No commits to the repo in this phase.**

### Changes Required:

#### 1. Tooling & baseline

```bash
brew install actionlint
cd /Users/heiko.bensch/cplace-dev/repos-dev/PFM-TASK-7777/repos/github-actions
actionlint -color=never > /tmp/actionlint-baseline.txt 2>&1 || true
wc -l /tmp/actionlint-baseline.txt   # baseline findings are pre-existing — NOT ours to fix
```

#### 2. Branch state

```bash
git branch --show-current   # must be: feature/PFM-TASK-7777-github-actions-Upgrade-GitHub-Actions-to-Support
git fetch origin release/25.2
git log --oneline -1 origin/release/25.2
# If origin/release/25.2 moved past 5c4ba52: fast-forward the feature branch onto its tip first.
git status --porcelain      # only "?? specs/" expected; specs/ stays untracked (do NOT commit it)
```

#### 3. Re-verify latest versions (within the same majors)

For each action check the latest release; **expected** values from design (2026-06-05):

| Action | Expected | Rule |
|---|---|---|
| `actions/checkout` | v6.0.3 | newer **patch/minor within v6** → take it |
| `actions/cache` | v5.0.5 | within v5 |
| `actions/setup-node` | v6.4.0 | within v6 |
| `actions/upload-artifact` | v7.0.1 | within v7 |
| `actions/download-artifact` | v8.0.1 | within v8 |
| `actions/github-script` | v9.0.0 | within v9 |
| `SonarSource/sonarqube-scan-action` | v8.1.0 | within v8 |

```bash
gh api repos/actions/checkout/releases/latest --jq .tag_name   # etc. for all 7
```

**Decision rule:** a newer patch/minor inside the same major → use it (update all `# vX.Y.Z` comments accordingly). A **new major** appeared → STOP and ask the user (breaking-change review from research only covers the listed majors).

#### 4. Resolve commit SHAs (dereference annotated tags!)

```bash
# per action/tag:
gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq '{sha: .object.sha, type: .object.type}'
# if type == "tag" (annotated): dereference to the commit:
gh api repos/<owner>/<repo>/git/tags/<tag-object-sha> --jq .object.sha
# if type == "commit" (lightweight): use the sha directly
```

Sanity check: if `sonarqube-scan-action` is still v8.1.0, its SHA must equal `7006c4492b2e0ee0f816d36501671557c97f5995` (pre-resolved in research).

#### 5. Record results

**File**: `specs/2026-06-05_node24-workflow-migration/sha-pins.md` (new)
**Changes**: table `action | version | commit-sha | tag-type`, one row per the 7 actions. Phases 2–3 copy SHAs only from this file.

### Success Criteria:

#### Automated Verification:
- [x] `actionlint --version` succeeds; `/tmp/actionlint-baseline.txt` exists
- [x] Current branch is `feature/PFM-TASK-7777-github-actions-Upgrade-GitHub-Actions-to-Support`, in sync with `origin/release/25.2` tip
- [x] `sha-pins.md` contains 7 rows, every SHA matches `^[0-9a-f]{40}$`
- [x] Each SHA verifies: `gh api repos/<owner>/<repo>/commits/<sha> --jq .sha` returns the same SHA
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 1 complete. Summary: actionlint installed (N baseline findings), branch verified at release/25.2 tip, 7 SHAs resolved (list versions; flag any that changed vs design). Please review sha-pins.md and reply 'yes' to continue to Phase 2." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [x] User reviews `sha-pins.md`: versions match expectations, no surprise major bumps

---

## Phase 2: Unify + SHA-pin Official Actions (commits a, b)

### Overview

Two mechanical commits. Commit a: every `actions/*` reference → unified latest major, SHA-pinned with `# vX.Y.Z` comment (~31 lines across 13 files). Commit b: `SonarSource/sonarqube-scan-action` → v8 (×2). All `with:`/`env:` blocks stay untouched (verified compatible: only stable params like `ref`, `fetch-depth`, `token`, `node-version`, `path`, `key`, `name`, `retention-days`, `pattern`, `merge-multiple` are used).

### Changes Required:

#### 1. Commit a — `PFM-TASK-7777 unify and SHA-pin official actions across all FE workflows`

**Files**: all 13 `.github/workflows/fe-*.yml`
**Changes**: 1:1 line substitutions (SHAs from `sha-pins.md`; versions in comments = re-verified Phase 1 values):

```bash
cd .github/workflows
sed -i '' \
  -e "s|uses: actions/checkout@v[0-9.]*|uses: actions/checkout@${SHA_CHECKOUT} # v6.0.3|" \
  -e "s|uses: actions/setup-node@v[0-9.]*|uses: actions/setup-node@${SHA_SETUP_NODE} # v6.4.0|" \
  -e "s|uses: actions/cache@v[0-9.]*|uses: actions/cache@${SHA_CACHE} # v5.0.5|" \
  -e "s|uses: actions/upload-artifact@v[0-9.]*|uses: actions/upload-artifact@${SHA_UPLOAD} # v7.0.1|" \
  -e "s|uses: actions/download-artifact@v[0-9.]*|uses: actions/download-artifact@${SHA_DOWNLOAD} # v8.0.1|" \
  fe-*.yml
```

Expected replacement counts (verify post-sed): checkout **14**, setup-node **13**, cache **13**, upload-artifact **3**, download-artifact **1**.

#### 2. Commit b — `PFM-TASK-7777 bump SonarSource/sonarqube-scan-action to v8`

**Files**: `fe-code-quality.yml:180`, `fe-sonar.yml:129`
**Changes**:

```bash
sed -i '' "s|uses: SonarSource/sonarqube-scan-action@v6|uses: SonarSource/sonarqube-scan-action@${SHA_SONAR} # v8.1.0|" \
  fe-code-quality.yml fe-sonar.yml
```

Note (accepted in design): v8 verifies scanner signatures by default (`skipSignatureVerification: false`) — fine, self-hosted runners have internet access.

### Success Criteria:

#### Automated Verification:
- [x] No unpinned external action remains: `grep -rEn "uses: (actions|SonarSource)/[^@]+@v[0-9]" .github/workflows/` → empty
- [x] Counts match: `grep -rc "actions/checkout@" .github/workflows/ | awk -F: '{s+=$2} END {print s}'` = 14; setup-node = 13; cache = 13; upload-artifact = 3; download-artifact = 1; sonarqube-scan = 2
- [x] Every pin carries a version comment: `grep -rE "uses: (actions|SonarSource)/" .github/workflows/ | grep -vc "# v"` = 0
- [x] Internal composite refs untouched: `grep -rc "github-actions/.github/actions/.*@release/25.2" .github/workflows/ | awk -F: '{s+=$2} END {print s}'` = 10
- [x] No new actionlint findings: `actionlint -color=never > /tmp/actionlint-now.txt 2>&1 || true; diff /tmp/actionlint-baseline.txt /tmp/actionlint-now.txt` shows no added lines
- [x] Exactly 2 commits created, diff stats touch only `.github/workflows/` (`git diff origin/release/25.2 --stat`)
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 2 complete. Summary: commits a+b created — all official actions unified/SHA-pinned (counts: 14/13/13/3/1), sonarqube-scan → v8 (×2), actionlint clean vs baseline. Please review the diff (`git diff origin/release/25.2`) and reply 'yes' to continue to Phase 3." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [x] Spot-check 2–3 pinned lines: SHA on github.com really is the tagged release commit

---

## Phase 3: Dead-Action Replacements (commits c, d, e, f)

### Overview

Four semantic commits, one per dead action. Designs are verbatim from research.md — copy, don't redesign.

### Changes Required:

#### 1. Commit c — `PFM-TASK-7777 replace bduff9/use-npmrc with own composite action`

**File (new)**: `.github/actions/use-npmrc/action.yml` — verbatim:

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

**Files (7 call sites)**: `fe-cleanup-snapshots.yml:37`, `fe-pr-snapshot.yml:41`, `fe-licenses.yml:41`, `fe-sonar.yml:59`, `fe-release.yml:40`, `fe-install-deps.yml:38`, `fe-pr-close.yml:39`
**Changes**: only the `uses:` line; `with: dot-npmrc: ${{ secrets.DOT_NPMRC }}` stays everywhere; **fe-sonar keeps its `if:` (line 57) and `id:` (line 58)**:

```bash
sed -i '' "s|uses: bduff9/use-npmrc@v1\.[12]|uses: collaborationFactory/github-actions/.github/actions/use-npmrc@release/25.2|" \
  fe-cleanup-snapshots.yml fe-pr-snapshot.yml fe-licenses.yml fe-sonar.yml fe-release.yml fe-install-deps.yml fe-pr-close.yml
```

#### 2. Commit d — `PFM-TASK-7777 replace dawidd6/action-get-tag with github.ref_name`

**File**: `fe-release.yml`
**Changes**:
- Delete the `Get tag` step (anchor: `- name: Get tag` with `id: tag` and `uses: dawidd6/action-get-tag@v1`; currently lines 48–50) **plus one adjacent blank line** (keep exactly one blank line between the `Install Modules` and `Build and Push` steps)
- Anchor `TAG: ${{ steps.tag.outputs.tag }}` (currently line 58) → `TAG: ${{ github.ref_name }}`

(Safe because the sole caller triggers fe-release on `push: tags: ['*/*']` — verified in research.)

#### 3. Commit e — `PFM-TASK-7777 replace thollander comment action with github-script upsert`

**File**: `fe-pr-snapshot.yml`
**Changes**: replace the whole final step (anchor: `- name: comment published Artifacts on PR`, currently lines 59–66, including its `env: GITHUB_TOKEN` and `with:` block) with — verbatim, SHA from `sha-pins.md`:

```yaml
      - name: comment published Artifacts on PR
        uses: actions/github-script@${SHA_GITHUB_SCRIPT} # v9.0.0
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

Notes: no explicit token needed — `github-script` defaults to `${{ github.token }}` (same token thollander used). Accepted cosmetic edge: open PRs with an old thollander comment get one duplicate on first run.

#### 4. Commit f — `PFM-TASK-7777 replace styfle cancel action with job-level concurrency`

**File**: `fe-licenses.yml`
**Changes**: delete the `Cancel Previous Runs` step (anchor: `uses: styfle/cancel-workflow-action@0.9.1`; currently lines 20–23 + trailing blank line 24, making checkout the first step); insert between `runs-on: ubuntu-latest` and `steps:` of the `check-licenses` job:

```yaml
    concurrency:
      group: fe-licenses-${{ github.ref }}
      cancel-in-progress: true
```

**File**: `fe-install-deps.yml`
**Changes**: same — delete styfle step (currently lines 17–20 + blank line 21); insert into the `install-deps` job:

```yaml
    concurrency:
      group: fe-install-deps-${{ github.ref }}
      cancel-in-progress: true
```

(No token needed — styfle required `access_token`, `concurrency:` is declarative. Accepted gap: runs already past this job keep running.)

### Success Criteria:

#### Automated Verification:
- [x] No dead actions remain: `git grep -En "bduff9/|dawidd6/|thollander/|styfle/" -- .github/` → empty
- [x] Composite exists & call sites: `test -f .github/actions/use-npmrc/action.yml`; `grep -rc "use-npmrc@release/25.2" .github/workflows/ | awk -F: '{s+=$2} END {print s}'` = 7
- [x] fe-sonar guard intact: `grep -A1 "cache-hit != 'true'" .github/workflows/fe-sonar.yml | grep -q "id: use-npmrc"`
- [x] fe-release: `grep -q 'TAG: ${{ github.ref_name }}' .github/workflows/fe-release.yml` and `! grep -q "steps.tag" .github/workflows/fe-release.yml`
- [x] Concurrency blocks: `grep -q "group: fe-licenses-" .github/workflows/fe-licenses.yml` and `grep -q "group: fe-install-deps-" .github/workflows/fe-install-deps.yml`, both with `cancel-in-progress: true`
- [x] No new actionlint findings vs baseline (same diff method as Phase 2 — also validates the embedded JS step syntax)
- [x] 4 new commits (c–f), each touching only its building block (`git show --stat <sha>`)
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 3 complete. Summary: commits c–f created — use-npmrc composite + 7 call sites, ref_name in fe-release, github-script upsert in fe-pr-snapshot, concurrency in fe-licenses/fe-install-deps; zero dead-action refs remain; actionlint clean. Please review and reply 'yes' to continue to Phase 4." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [x] Read the github-script step diff side-by-side with research.md — byte-identical apart from the resolved SHA

---

## Phase 4: Supporting Infrastructure (commits g, h)

### Overview

Two small additive commits: Dependabot config and README section.

### Changes Required:

#### 1. Commit g — `PFM-TASK-7777 add dependabot config for github-actions ecosystem`

**File (new)**: `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

Notes: Dependabot only acts on the **default branch** (`master`) — the "master only" decision is inherent, no `target-branch` needed. The config reaches master via the upmerge chain. Branch refs (`@release/X.Y` composites) are ignored by Dependabot — only the SHA pins get update PRs.

#### 2. Commit h — `PFM-TASK-7777 document Node 24 baseline in README`

**File**: `README.md` (currently 1 line)
**Changes**: append:

```markdown

## Node 24 Compatibility

All reusable FE workflows (`.github/workflows/fe-*.yml`) are Node 24 compatible (GitHub's default
JavaScript action runtime since June 2026).

- All external actions are pinned to commit SHAs (`uses: owner/repo@<sha> # vX.Y.Z`) and unified to
  the latest majors: checkout v6, cache v5, setup-node v6, upload-artifact v7, download-artifact v8,
  github-script v9, sonarqube-scan-action v8.
- Self-hosted runners must run GitHub Actions Runner **>= 2.327.1**.
- `.npmrc` provisioning uses the in-repo composite `.github/actions/use-npmrc` (input `dot-npmrc`),
  referenced per release branch like all internal composites.
- `.github/dependabot.yml` keeps the SHA pins current on `master`; release branches are backported
  manually.
```

### Success Criteria:

#### Automated Verification:
- [x] `actionlint` accepts the repo incl. dependabot file presence (no new findings vs baseline)
- [x] `test -f .github/dependabot.yml` and `grep -q "package-ecosystem" .github/dependabot.yml`
- [x] README contains the section: `grep -q "Node 24 Compatibility" README.md`
- [x] 2 new commits (g, h); full branch now has exactly 8 commits over `origin/release/25.2`: `git rev-list --count origin/release/25.2..HEAD` = 8
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 4 complete. Summary: dependabot.yml + README section added; branch has all 8 building-block commits. Implementation is code-complete. Please review and reply 'yes' to continue to Phase 5 (test branch + validation — involves pushes to GitHub)." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked. *(User approved; user executes all pushes themselves.)*

#### Manual Verification:
- [x] README wording reads well and matches what was actually done

---

## Phase 5: Test Branch & Validation in cplace-remote-filesystem-fe

### Overview

Prove Node 24 compatibility **before** the default switch: a test branch forces the Node 24 runtime, the test repo's callers point at it, and the full workflow matrix must complete with **zero Node deprecation warnings**. ⚠️ Every step marked **[OUTWARD]** pushes to GitHub or triggers real runs — get explicit user approval per step (the user pre-approved the *approach*, not each push).

### Changes Required:

#### 1. Test branch in this repo — `test/PFM-TASK-7777-github-actions-Upgrade-GitHub-Actions-to-Support`

> **AMENDED 2026-06-05 (user decision):** The test branch is created by the user's `~/bin/push-test-branch` script (anchor extended to also match `github-actions` refs), NOT manually as `feature/...-force-test`. The script derives `test/<suffix>` from the feature branch and **rewrites all internal `collaborationFactory/github-actions/.github/...@<ref>` refs to `@test/...`** — this also fixes a gap in the original plan: the new `use-npmrc` composite does not exist on `release/25.2` until merge, so `@release/25.2` refs would not resolve in test runs. The FORCE commit is added on top of the script-created branch. **All pushes are executed by the user.**

On the script-created test branch, add **single commit** `PFM-TASK-7777 TEST ONLY force Node 24 runtime (never merge)`:

- 12 files: insert a new workflow-level block between the `on:`/`name:` header and `jobs:`:
  ```yaml
  env:
    FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
  ```
- **`fe-release.yml`: merge into the EXISTING `env:` block (lines 15–17)** as a third key — do not create a second block:
  ```yaml
  env:
    NX_BRANCH: ${{ github.event.number }}
    NX_RUN_GROUP: ${{ github.run_id }}
    FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
  ```
- Verify: `grep -c "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24" .github/workflows/fe-*.yml` → 1 per file, 13 total; `grep -c "^env:" .github/workflows/fe-release.yml` = 1
- **[OUTWARD]** push both branches: implementation branch (needed as merge target reference) and test branch

#### 2. Test repo caller branch

```bash
gh repo clone collaborationFactory/cplace-remote-filesystem-fe \
  /Users/heiko.bensch/cplace-dev/repos-dev/PFM-TASK-7777/repos/cplace-remote-filesystem-fe
```

- **Inventory first**: list `.github/workflows/*` in the test repo; map which caller triggers exist (`pull_request`, `push` + branch filters, `tags: ['*/*']`, `schedule`, `workflow_dispatch`) and which `fe-*.yml@<ref>` each calls
- Create caller branch **`release/node24-migration-test`** — the `release/*` name is **required** so `fe-sonar.yml:35`'s job guard (`startsWith(github.ref_name, 'release/')`) passes for push/dispatch-triggered sonar runs. Contingency: if the test repo blocks pushing `release/*` branches (protection rules), STOP and ask the user before improvising
- On that branch, point every `collaborationFactory/github-actions/.github/workflows/fe-*.yml@<ref>` to `@feature/PFM-TASK-7777-node24-force-test`
- If push-triggered callers (snapshot) restrict branches and don't match `release/*`: extend the trigger's branch list on this test branch only (test-only change, lives and dies with the branch)
- If the cleanup-snapshots/sonar callers lack `workflow_dispatch`: add it on this test branch only
- **[OUTWARD]** push the caller branch

#### 3. Execute validation matrix (each step **[OUTWARD]**, user-approved)

| # | Trigger | Workflows exercised |
|---|---|---|
| 1 | Open PR from `release/node24-migration-test` (add label `snapshot`) | fe-licenses, fe-install-deps, fe-code-quality, fe-build, fe-e2e, fe-pr-snapshot |
| 2 | Push a second trivial commit to the PR | concurrency check: previous in-progress `install-deps`/`check-licenses` runs get **cancelled** |
| 3 | Close the PR (without merging) | fe-pr-close |
| 4 | Push to the caller branch (snapshot trigger) | fe-snapshot |
| 5 | Push a **real patch release tag** (next patch per existing `<scope>/<x.y.z>` scheme — inspect `git tag` first; harmless JFrog publish accepted by design) | fe-release, fe-tag |
| 6 | `workflow_dispatch` (or push, given `release/*` ref) | fe-sonar, fe-cleanup-snapshots |

Not covered (accepted): `fe-check-upmerge` — validated by first real run after merge.

#### 4. Log analysis (the acceptance gate)

For **every** run above:

```bash
gh run list --repo collaborationFactory/cplace-remote-filesystem-fe --branch <ref> --json databaseId,name,conclusion
gh run view <id> --repo collaborationFactory/cplace-remote-filesystem-fe --log 2>/dev/null | grep -iE "deprecat|node ?20" || echo "CLEAN"
```

Also check run annotations (`gh api repos/collaborationFactory/cplace-remote-filesystem-fe/actions/runs/<id> --jq .` / the run's web UI) for deprecation annotations. Record results per workflow in `specs/2026-06-05_node24-workflow-migration/validation-log.md` (new file: workflow, run URL, conclusion, deprecation grep result).

### Success Criteria:

#### Automated Verification:
- [x] Test branch: 13/13 files contain `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` at workflow level; fe-release has exactly one `env:` block
- [ ] All 12 covered workflows have a run with `conclusion: success` (fe-pr-snapshot's comment visible on the test PR; upsert verified — second push updates, doesn't duplicate)
- [ ] Deprecation grep over every run log returns empty (zero Node deprecation warnings)
- [ ] Concurrency: run list shows a `cancelled` conclusion for the superseded `install-deps`/`check-licenses` runs after step 2
- [ ] `validation-log.md` covers all 12 workflows
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 5 complete. Summary: full matrix executed in cplace-remote-filesystem-fe — 12/12 workflows green, zero deprecation warnings (see validation-log.md), concurrency cancel + comment upsert verified. Please review validation-log.md and reply 'yes' to continue to Phase 6 (open the PR)." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] Spot-check the PR comment on the test PR: content matches old thollander format expectations
- [ ] JFrog: the patch release published from the test tag looks normal (correct version, no junk)
- [ ] SonarCloud: scan for the test ref completed (branch entry can be deleted afterwards)

---

## Phase 6: PR into release/25.2 & Cleanup

### Overview

Self-review, open the implementation PR (⚠️ target **`release/25.2`**, NOT master — default detection will guess wrong), then remove all test artifacts.

### Changes Required:

#### 1. Self-review

Run the `code-review` skill (or `review:branch-merge`) over `origin/release/25.2..HEAD` before pushing the final state. Fix only findings caused by this migration.

#### 2. **[OUTWARD]** Create the PR (use the `create-pr` skill)

- Base: `release/25.2` (explicit — verify in `gh pr view --json baseRefName` afterwards)
- Title: `PFM-TASK-7777 Node 24 migration of all FE reusable workflows`
- Body must include: building-block list mapping 1:1 to the 8 commits; link to PFM-TASK-7777; validation summary (test repo, 12/12 green, zero deprecation warnings, link to test PR/runs); the "Deliberately NOT in scope" list (build Node version mix, caller-level concurrency, Dependabot for release branches); note that upmerge PRs follow after merge

#### 3. **[OUTWARD]** Cleanup

- Test repo: close the test PR (if not already), delete branch `release/node24-migration-test` (local + remote). The release tag and JFrog publish **stay** (accepted by design)
- This repo: delete `feature/PFM-TASK-7777-node24-force-test` (local + remote) — **after** the user confirms validation evidence is no longer needed live (logs are persisted in validation-log.md)
- Local clone of the test repo may be deleted or kept — user's choice at checkpoint

### Success Criteria:

#### Automated Verification:
- [ ] `gh pr view --json baseRefName --jq .baseRefName` = `release/25.2`
- [ ] PR contains 8 commits: `gh pr view --json commits --jq '.commits | length'` = 8
- [ ] Final state greps (on the PR branch): no dead actions, all external `uses:` SHA-pinned with `# v` comment, 7× `use-npmrc@release/25.2`, 10× existing composites `@release/25.2`
- [ ] Test branches gone: `git ls-remote origin "refs/heads/*node24-force-test*"` → empty; same for the test repo branch
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 6 complete. Summary: PR #<n> open against release/25.2 (8 commits, validation linked), test branches deleted. Plan finished — upmerge chain (see Migration Notes) starts after merge. Please review the PR and reply 'yes' to close out." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] PR description reads well; reviewer can skim commit a and focus on c–f
- [ ] No `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` anywhere in the PR diff

---

## Testing Strategy

### Unit Tests:
None — this repo has no test framework; workflow YAML is not unit-testable. Static safety nets: actionlint baseline-diff per phase, grep assertions, yamllint available as fallback syntax check.

### Integration Tests:
The Phase 5 real-run matrix in `cplace-remote-filesystem-fe` is the integration test: 12/13 workflows across all trigger types (PR open/update/close, push, release tag, dispatch) under forced Node 24 runtime. Acceptance gate: all green + zero Node deprecation warnings in logs/annotations.

### Manual Testing Steps:
1. Verify the upserted PR comment on the test PR (content + no duplicate after second run)
2. Verify the cancelled run appears for the concurrency check
3. Verify the JFrog publish from the test tag
4. After merge (outside this plan): watch the first real `fe-check-upmerge` run

## Performance Considerations

None negative. The `concurrency:` replacement slightly reduces CI usage (cancels superseded runs declaratively). SHA-pinned actions resolve identically to tag refs at runtime.

## Migration Notes

**Upmerge chain (after the release/25.2 PR merges — outside this plan's phases):**

1. One upmerge PR per branch: `25.3 → 25.4 → 26.1 → 26.2 → master`
2. In **each** upmerge PR, internal composite refs must be switched to that branch: all `collaborationFactory/github-actions/.github/actions/*@release/X.Y` occurrences — **including the new `use-npmrc`** (7 call sites) — must point to the target branch (`@release/25.3`, …, `@master`)
3. Verification per upmerge: `git grep "use-npmrc@"` shows only the current branch's ref; `git grep "actions/.*@release/"` consistent
4. SHA pins are branch-identical — no conflicts expected
5. `dev:pr-check-status` can track the open upmerge PRs
6. Dependabot becomes active once the config reaches `master`; release branches accumulate pin drift until manually backported (accepted)
7. The FORCE test branch is **never** merged anywhere

## References

- Research: [research.md](./research.md) — binding inventory + verbatim replacement designs
- Design: [design.md](./design.md) — decisions incl. branch strategy, concurrency key, commit structure
- Ticket: PFM-TASK-7777
- Prior art: PFM-TASK-7528 / commit `916fe05` — fe-sonar.yml already on Node-24-era actions (proof-of-concept for self-hosted runners)
- Composite pattern: `.github/actions/snapshots/action.yml`
- SHA pins (created in Phase 1): [sha-pins.md](./sha-pins.md)
- Validation log (created in Phase 5): [validation-log.md](./validation-log.md)
