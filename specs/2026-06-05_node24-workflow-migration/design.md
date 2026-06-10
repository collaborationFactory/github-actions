# Node 24 Migration of All 13 Reusable FE Workflows - Design Approach

## Overview

Migrate all 13 reusable FE workflows (`.github/workflows/fe-*.yml`) in `collaborationFactory/github-actions` to be Node 24 compatible before GitHub's default runtime switch on **June 16, 2026** (hard deadline: fall 2026, Node 20 removal). This includes replacing 4 unmaintained third-party actions, unifying and SHA-pinning all official actions to their latest majors, and adding supporting infrastructure (own `use-npmrc` composite, Dependabot config, README section).

## Problem Statement

GitHub switches the default JavaScript action runtime to Node 24. Four third-party actions used in the workflows are dead (unmaintained, pinned to old Node runtimes) and several official actions are on outdated majors that internally pin Node 20. Without migration, all 13 reusable workflows — consumed by multiple FE repos — will start failing or emitting deprecation warnings.

### Requirements

- All 13 `fe-*.yml` workflows run cleanly on Node 24 (**zero Node deprecation warnings** in test runs)
- Replace all 4 dead third-party actions with maintained equivalents
- Unify official action versions to latest majors, identical across all workflows
- SHA-pin all external actions; own composites keep branch refs
- Consumer repos need **zero changes** (inputs/secrets interface untouched)

### Constraints

- Base branch: `release/25.2`; upmerge chain `25.3 → 25.4 → 26.1 → 26.2 → master`, one PR per branch
- Internal composite refs (`@release/X.Y`) must track each upmerge branch
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` exists only on a separate test branch, never merged
- Test repo `cplace-remote-filesystem-fe` covers 12/13 workflows (all except `fe-check-upmerge`)
- Self-hosted runner fleet is ≥ 2.327.1 (verified via fe-sonar green runs since 2026-04-01)

## Design Decisions Summary

1. **Reuse the existing feature branch**: `feature/PFM-TASK-7777-github-actions-Upgrade-GitHub-Actions-to-Support` (clean, at `release/25.2` tip) is used as the implementation branch.
   - No new branch is created; the carried-over name `feature/PFM-TASK-7777-node24-migration` is dropped
   - The separate test branch (with FORCE var) is created on top of this branch's final state
2. **Simple concurrency group key**: `styfle/cancel-workflow-action` is replaced by job-level `concurrency:` with `group: <workflow-name>-${{ github.ref }}` and `cancel-in-progress: true`.
   - Applied in `fe-licenses.yml` (`check-licenses`) and `fe-install-deps.yml` (`install-deps`)
   - Edge case accepted: two different caller workflows in the same repo on the same ref share a group — the old styfle behavior was even broader
3. **One commit per building block** inside the single implementation PR:
   - (a) unify + SHA-pin official actions across all 13 workflows, (b) `sonarqube-scan-action` → v8, (c) new `use-npmrc` composite + 7 call-site replacements, (d) `action-get-tag` → `github.ref_name`, (e) thollander → `github-script` upsert, (f) styfle → `concurrency:`, (g) `.github/dependabot.yml`, (h) README section
   - The mechanical SHA-pin commit is isolated from the 4 semantic replacement commits for reviewability
4. **Official actions → latest majors, unified and SHA-pinned** (binding, from research):
   - `checkout` v6.0.3, `cache` v5.0.5, `setup-node` v6.4.0, `upload-artifact` v7.0.1, `download-artifact` v8.0.1, `github-script` v9.0.0 (new), `SonarSource/sonarqube-scan-action` v8.1.0
   - SHA pins with `# vX.Y.Z` comment; resolve commit SHAs at implementation time via `gh api` (dereference annotated tags); re-verify latest patch releases then
5. **Dead-action replacements** (binding, designs agreed verbatim in research):
   - `bduff9/use-npmrc` ×7 → own composite `.github/actions/use-npmrc` (input name `dot-npmrc` kept; fe-sonar keeps its `if:`/`id:`)
   - `dawidd6/action-get-tag` → `TAG: ${{ github.ref_name }}` (sole consumer at fe-release.yml:58)
   - `thollander/actions-comment-pull-request` → `actions/github-script` marker-based upsert (`<!-- published-artifacts -->`)
   - `styfle/cancel-workflow-action` → job-level `concurrency:` (decision 2)
6. **Supporting infrastructure** (binding): `.github/dependabot.yml` (ecosystem `github-actions`, weekly, serves `master` only) and a short English README section (Node 24 compatible, action baseline, runners ≥ 2.327.1, `use-npmrc` composite).
7. **Validation strategy** (binding): separate test branch = implementation + workflow-level `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` in all 13 files (in `fe-release.yml` merged into the existing `env:` block at lines 15–17). Test against `cplace-remote-filesystem-fe` including a real patch release tag (harmless JFrog publish accepted).

This means:

- Consumer repos keep calling the workflows `@master`/`@release/X.Y` with unchanged inputs/secrets — the migration is invisible to them
- Dependabot keeps the SHA pins fresh on `master` going forward; release branches rely on manual backports
- The new `use-npmrc` composite follows the exact pattern of the 4 existing composites (pure shell, branch-ref'd) — after each upmerge, `git grep "use-npmrc@"` must show that branch's ref
- Reviewers can skim the mechanical SHA-pin commit and focus on the 4 semantic replacement commits
- The test branch proves Node 24 compatibility *before* the June 16 default switch, with zero deprecation warnings as the acceptance gate

Major trade-offs we're accepting:

1. **One-time duplicate PR comment**: open PRs with an old thollander comment get one duplicate on the first run of the new `github-script` upsert (markers differ) — cosmetic, self-healing on subsequent runs.
2. **Concurrency replacement is narrower than a caller-level solution**: runs already past the `install-deps`/`check-licenses` job keep running (minutes only); the cleaner caller-level `concurrency:` belongs in consumer repos (separate ticket if wanted).
3. **SHA pins trade readability for supply-chain safety**: `uses: actions/checkout@<40-char-sha> # v6.0.3` is harder to read than `@v6`, and Dependabot only maintains `master` — release branches accumulate pin drift until manually backported.
4. **`fe-check-upmerge.yml` is not covered by the test repo** — residual risk accepted; validated by the first real run after merge (it uses only `checkout`, `setup-node`, `cache` and the shell-only `upmerge` composite, all covered elsewhere).
5. **download-artifact v8 fails hard on hash mismatch** (new behavior) — accepted; surfaces real corruption instead of hiding it.

What we're NOT doing (out of scope):

- Consumer repo changes of any kind (incl. caller-level `concurrency:`)
- Build Node version unification (`node-version: 22.15.0` hardcoded in fe-install-deps vs. `node-version-file: .nvmrc` in fe-sonar)
- Dependabot for release branches (accepted gap, manual backport path exists)
- BE workflows / `hmarr/debug-action` (handled elsewhere)

## Design Decisions - Details

### Branch Strategy

**Chosen Approach:** Reuse existing branch `feature/PFM-TASK-7777-github-actions-Upgrade-GitHub-Actions-to-Support`

**Rationale:** The branch already exists, is clean, and sits exactly at the `origin/release/25.2` tip — recreating it under the carried-over name `feature/PFM-TASK-7777-node24-migration` would add zero value.

**Alternatives Considered:**
- **New branch `feature/PFM-TASK-7777-node24-migration`**: Rejected — identical starting point, only renames for cosmetics.

**Implications:**
- The test branch (with FORCE var) branches off this branch's final implementation state.
- The PR into `release/25.2` comes from this branch.

---

### Concurrency Group Key

**Chosen Approach:** Simple key — `group: <workflow-name>-${{ github.ref }}`, `cancel-in-progress: true`, at job level

**Rationale:** Concurrency groups are repo-scoped, so different consumer repos can never collide. The only theoretical collision — one repo calling the same reusable workflow from two different caller workflows on the same ref — is acceptable: the replaced styfle action cancelled even more broadly, so this is a strict improvement.

**Alternatives Considered:**
- **Extended key including `${{ github.workflow }}`**: Rejected — solves a collision no consumer currently exhibits, at the cost of a less predictable group name; can be added later without breaking anything if a consumer ever hits it.

**Implications:**
- `fe-licenses.yml`: delete styfle step (lines 20–23), add `concurrency: { group: fe-licenses-${{ github.ref }}, cancel-in-progress: true }` to the `check-licenses` job.
- `fe-install-deps.yml`: delete styfle step (lines 17–20), add `concurrency: { group: fe-install-deps-${{ github.ref }}, cancel-in-progress: true }` to the `install-deps` job.
- No token needed (styfle required `access_token`).

---

### Commit Structure

**Chosen Approach:** One commit per building block (8 commits, see Design Decisions Summary item 3)

**Rationale:** The building blocks are orthogonal — the SHA-pin commit touches only `uses:` lines mechanically, while each replacement commit isolates one logical change. Reviewers can verify the mechanical commit by pattern and focus attention on the semantic ones.

**Alternatives Considered:**
- **Single commit**: Rejected — ~65 `uses:` changes + 3 new files in one diff buries the 4 semantic replacements.
- **One commit per workflow file**: Rejected — spreads each logical change (e.g. the use-npmrc replacement) across up to 13 commits, making it impossible to review a building block in one place.

**Implications:**
- Commit order matters slightly: the `use-npmrc` composite must exist before its call sites reference it (same commit, block c).
- The PR description lists the building blocks → maps 1:1 to commits.

---

### Binding Decisions (carried over from research — not reopened)

All replacement designs, target versions, SHA-pin format, Dependabot config, README scope, and the test strategy were confirmed in prior sessions and are recorded verbatim in [research.md](./research.md) (sections "Scope Decisions", "Target Versions", "Replacement Designs"). This design document treats them as fixed inputs.

## Overall Architecture

The migration consists of six independent building blocks applied across 13 workflow files, plus two supporting files:

### Key Components

1. **Unified official actions (SHA-pinned)**: every `actions/*` and `SonarSource/*` reference becomes `@<commit-sha> # vX.Y.Z`, identical version everywhere.
2. **`.github/actions/use-npmrc/action.yml`** (new): pure-shell composite writing `~/.npmrc` from the `dot-npmrc` input; referenced `@release/25.2` on this branch, ref updated per upmerge — exactly like the 4 existing composites.
3. **Inline replacements**: `github.ref_name` (fe-release), `github-script` upsert (fe-pr-snapshot), job-level `concurrency:` (fe-licenses, fe-install-deps).
4. **`.github/dependabot.yml`** (new): `github-actions` ecosystem, weekly, master only.
5. **README section** (new): documents Node 24 baseline, action versions, runner requirement, composite usage.

### Data Flow

Unchanged. Consumer repos call the reusable workflows with the same inputs/secrets; `DOT_NPMRC` flows into the new composite exactly as it did into `bduff9/use-npmrc`; `githubCommentsForPR.txt` is still produced by the `artifacts` composite and consumed by the (new) comment step.

### Integration Points

- Consumer repos: `uses: collaborationFactory/github-actions/.github/workflows/fe-*.yml@<branch>` — interface unchanged
- Test repo `cplace-remote-filesystem-fe`: callers temporarily pointed `@<test-branch>` for validation, reverted afterwards
- Upmerge chain: after each upmerge PR, internal composite refs (incl. `use-npmrc`) must point to that branch — verify with `git grep "use-npmrc@"`

## Technology Choices

**Action versions** (latest as of 2026-06-05; re-verify + resolve SHAs at implementation time via `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, dereferencing annotated tags):

| Action | To |
|---|---|
| `actions/checkout` | v6.0.3 |
| `actions/cache` | v5.0.5 |
| `actions/setup-node` | v6.4.0 |
| `actions/upload-artifact` | v7.0.1 |
| `actions/download-artifact` | v8.0.1 |
| `actions/github-script` | v9.0.0 |
| `SonarSource/sonarqube-scan-action` | v8.1.0 (SHA already resolved: `7006c4492b2e0ee0f816d36501671557c97f5995`, lightweight tag) |

**Replacement mechanics:** see "Replacement Designs" in [research.md](./research.md) — composite YAML, github-script upsert script, and concurrency blocks are agreed verbatim there.

## Trade-offs & Risks

### Accepted Trade-offs

(See "Major trade-offs we're accepting" above — duplicate PR comment, narrower cancel scope, SHA-pin readability/maintenance, fe-check-upmerge coverage gap, download-artifact v8 hard failures.)

### Known Risks

1. **checkout v6 credential handling change** (separate cred file): Mitigated — TS scripts use plain `git push`/`git config`, no `extraheader` tricks (verified in research).
2. **sonarqube-scan v8 signature verification** (`skipSignatureVerification` defaults to false): Mitigated — self-hosted runners have internet access.
3. **Target versions drift before implementation**: Mitigated — versions re-verified when SHAs are resolved (explicit implementation step).
4. **Upmerge composite-ref mistakes**: Mitigated — `git grep "use-npmrc@"` check after each upmerge is part of the process.

## Out of Scope

- Consumer repo changes (incl. caller-level `concurrency:` — separate ticket if wanted)
- Build Node version mix (`node-version: 22.15.0` vs `.nvmrc`)
- Dependabot for release branches
- BE workflows / `hmarr/debug-action`

## Success Criteria

- Test branch runs in `cplace-remote-filesystem-fe` complete the full matrix (PR open → PR close → push/snapshot → real patch release tag → `workflow_dispatch` sonar-scan) with **zero Node deprecation warnings**
- All 12 covered workflows green; `fe-check-upmerge` validated by first real run after merge
- `git grep` confirms: no `bduff9/`, `dawidd6/`, `thollander/`, `styfle/` references remain; all external actions SHA-pinned with `# vX.Y.Z` comments; unified versions
- Consumer repos run unchanged against the merged workflows
- After each upmerge PR: composite refs (incl. `use-npmrc@`) point to the correct branch

## Next Steps

1. Review this design document
2. Refine if needed based on feedback
3. Proceed to implementation planning: `/spec-driven-development:create_plan specs/2026-06-05_node24-workflow-migration/design.md`

## References

- Related research: [research.md](./research.md)
- Ticket: PFM-TASK-7777
- Related context: PFM-TASK-7528 (`fe-sonar.yml` fix, commit 916fe05 — proof-of-concept for Node-24-era actions on self-hosted runners)
