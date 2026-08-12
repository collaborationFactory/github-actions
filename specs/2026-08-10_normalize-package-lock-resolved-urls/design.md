---
date: 2026-08-10
git_commit: 7661e9b
branch: fix/PFM-ISSUE-34453-normalize-package-lock-json/25.2
baseline_branch: release/25.2
topic: 'PFM-ISSUE-34453: Normalize package-lock.json resolved URLs onto the JFrog npm proxy'
tags: [design, package-lock, npm, jfrog, bash, jq, bats, ci, rollout]
status: complete
last_updated: 2026-08-10
---

# PFM-ISSUE-34453 — Normalize `package-lock.json` resolved URLs onto the JFrog npm proxy — Design Approach

## Overview

`collaborationFactory/github-actions` ships a **mixed** `package-lock.json`: 171 non-root entries resolve via
`https://registry.npmjs.org/` while the remainder resolve via `https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/`.
The shared composite actions run `npm ci` inside the action directory while the consumer's `~/.npmrc` is active, so npm
rewrites those 171 URLs onto the configured registry host and **drops the registry's path prefix**, producing `E404`.

This design delivers three things per branch, on all seven affected branches:

1. A **normalizer** that rewrites the 171 `resolved` prefixes and nothing else.
2. An **invariant check** that proves the dependency graph is unchanged and that every URL points at exactly the one
   correct proxy prefix.
3. A **PR guard** — this repo's first `on: pull_request` workflow — that fails when a lockfile containing
   `registry.npmjs.org` is proposed.

Both tools are **bash + jq**, deliberately runnable with nothing installed, because the developer who most needs them
is standing in front of a repository whose `npm ci` is broken.

## Problem Statement

npm's `pacote` computes `this.resolved = new URL(resolvedURL.pathname, this.registry).href`
(`node_modules/pacote/lib/remote.js:16`). Because `resolvedURL.pathname` starts with `/`, the registry's own path is
discarded under npm's default `replace-registry-host=npmjs`:

| | |
| --- | --- |
| lockfile | `https://registry.npmjs.org/update-browserslist-db/-/update-browserslist-db-1.0.10.tgz` |
| requested | `https://cplace.jfrog.io/update-browserslist-db/-/update-browserslist-db-1.0.10.tgz` → **404** |
| correct | `https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/update-browserslist-db/-/update-browserslist-db-1.0.10.tgz` → 200 |

The regression trigger was the Node 24 migration replacing `bduff9/use-npmrc@v1.1` (wrote `<workspace>/.npmrc`,
invisible to the action's own install) with the in-repo `.github/actions/use-npmrc` (writes `~/.npmrc`, active for every
npm invocation on the runner). The failure is hard to diagnose because the broken URL's prefix is the `JFROG_URL`
secret and therefore masked as `***` in logs.

### Requirements

- Rewrite all 171 `resolved` prefixes onto the JFrog npm proxy, changing **no** `version`, `integrity`, or graph edge.
- Provide a repeatable, idempotent normalizer — the operation runs at least seven times and again after every upmerge
  conflict.
- Provide a machine-checked invariant so correctness does not depend on reviewing a 262 KB diff.
- Provide an ongoing PR-level guard against reintroduction.
- Deliver to all seven branches: `release/25.2`, `25.3`, `25.4`, `26.1`, `26.2`, `26.3`, `master`.

### Constraints

- **The repo has no CI of its own.** All 13 `.github/workflows/fe-*.yml` are `workflow_call:`-only; the `pull_request`
  trigger exists only in the never-executed template `.github/workflow-templates/fe/fe-pr.yml:2-5`. `jest` and
  `prettier --check` are run by nothing ([research §6](./research.md)).
- **The "upmerge" is a Slack notifier, not an upmerge** — `tools/scripts/upmerge/upmerge.ts:22` runs a `--no-push` dry
  run and posts to `#frontend-upmerge`. Carrying commits upward is human-driven ([research §7](./research.md)).
- **`master` and `release/26.3` are not downstream of `release/26.2`.** The chain is `25.2 → 25.3 → 25.4 → 26.1 → 26.2`
  plus two independent tips; `master` received Node 24 via its own PR `#132`, and `26.3` branched off `master`
  ([research §8](./research.md)). `25.2 → 25.3` is already un-upmerged by 2 commits.
- **There is no npm config to tune in this repo** — `use-npmrc` writes the secret verbatim to `~/.npmrc` and sets
  nothing; `replace-registry-host` appears nowhere ([research §4](./research.md)). The lockfile is the only lever.
- **Secret masking**: any diagnostic containing the JFrog host is masked, so errors must name package paths.
- **Repo conventions**: `tools/scripts/<feature>/` with co-located tests; CommonJS TypeScript elsewhere; prettier
  `{ singleQuote: true }`; Node 18.19.1 tooling.

### Evidence gathered during this design session

Beyond [research.md](./research.md), the following was measured directly and drove three decisions:

| measurement | result | consequence |
| --- | --- | --- |
| `jq .` round-trip on the real lockfile (jq 1.8.1) | **byte-identical** (262 063 → 262 063) | jq is byte-safe here |
| jq structured rewrite vs. raw textual rewrite | **byte-identical output** (+4788 both, 0 npmjs left) | no reason to prefer a textual rewrite |
| numeric literals in the lockfile | only `"lockfileVersion": 3` | jq cross-version number handling has no surface |
| fingerprint vs. changed tarball filename (t1) | **caught** | graph assertion works |
| fingerprint vs. changed dependency edge (t3) | **caught** | use the **full entry**, not the `version/integrity/tarball/link` subset |
| fingerprint vs. typo'd proxy repo name `cplace-nmp` (t2) | **MISSED** | a second, independent assertion is mandatory |
| fingerprint vs. an entry left on npmjs (t4) | **MISSED** | as above |
| `prettier --check` on the lockfile, before and after normalization | **passes both** | no lockfile formatting risk |
| `prettier --check .` repo-wide | **fails on 20 pre-existing files** | `check-prettier` cannot be enabled here |
| branch protection, all seven branches | six release branches **NOT protected**; `master` protected with `required_status_checks.contexts = []`; **no rulesets** | the guard cannot block; enforcement is a separate deliverable |
| local tooling | bats 1.13.0, shellcheck 0.11.0, jq 1.8.1 present | bash toolchain is viable locally today |
| developer `~/.npmrc` | points at `cplace.jfrog.io/artifactory/api/npm/cplace-npm/` | confirms the bootstrap problem for any node-based tool |

## Design Decisions Summary

1. **Normalizer in bash + jq, not TypeScript**: `tools/scripts/lockfile/normalize-lockfile.sh` performs a structured
   jq rewrite of `.packages[].resolved`, following the Google Shell Style Guide and kept shellcheck-clean.
   - The decisive factor is **bootstrap independence**: `npx ts-node` requires `node_modules`, which requires the
     `npm ci` that is broken — so a TypeScript normalizer cannot repair the lockfile it exists to repair.
   - jq's output was measured byte-identical to a raw textual rewrite, so the structured form costs no byte-safety.
   - Layout still follows the repo's `tools/scripts/<feature>/` convention with co-located tests.
2. **Invariant check with two independent assertions, both required to pass**: `check-lockfile.sh`.
   - **Graph invariance** — the whole document with every `resolved` reduced to a registry-independent tarball path
     must equal the baseline. Uses the **full entry**, which catches dependency-edge drift the research prototype's
     field subset missed (t3).
   - **Prefix exactness** — exactly one distinct `resolved` prefix, equal to the hard-coded constant; zero
     `registry.npmjs.org`; zero entries missing `resolved` outside the `""` root. This catches t2 and t4, which graph
     invariance provably cannot.
   - Failures are reported **by package path**, computed in jq rather than shelled out to `diff`, so they survive `***`
     masking.
3. **Baseline from a git ref, defaulting to `HEAD`, with two explicit file paths also accepted**: no committed baseline
   artifact.
   - Mid-conflict, `git show :2:package-lock.json` (ours) and `:3:` (theirs) are directly addressable.
   - The normalizer additionally self-asserts before/after in-process, so it is safe standalone.
   - The resolved ref is printed on every run, so a wrong baseline is visible rather than silent.
4. **The proxy prefix is a hard-coded `readonly` constant** in a shared `lib.sh`, not an env var.
   - Configurability would make the exactness assertion a tautology: a typo'd prefix supplied to both scripts would
     validate itself.
   - `JFROG_URL` must **not** be reused — it is the publish target `…/artifactory/cplace-npm-local`
     (`tools/scripts/artifacts/configuration.ts:2`), not the install proxy.
   - The value is not secret; it is already committed in plaintext in 371 lockfile entries.
5. **Direct script invocation for humans and CI** — no npm scripts, no composite action wrapper.
   - Preserves zero-install end to end and avoids adding a branch-pinned `@release/x.y` self-reference to maintain
     across seven long-lived branches.
   - `tools/scripts/lockfile/README.md` is the documented entry point; every failure message names both the README and
     the exact remediation command.
6. **New `.github/workflows/pr-checks.yml`** — this repo's first `on: pull_request` workflow, deliberately not prefixed
   `fe-` so that prefix keeps meaning "reusable workflow consumed by other repos."
   - Two zero-node jobs: `lockfile` (jq guard) and `scripts` (shellcheck + bats over `tools/scripts/lockfile/`).
   - bats and shellcheck are installed in the workflow (`bats-core/bats-action` or `apt-get`), **never** as npm
     devDependencies — adding them would mutate `package-lock.json` on all seven branches and break the very invariant
     this ticket establishes.
   - `on: pull_request: branches: ['**']` with **no `paths:` filter**: a path-filtered workflow reports as pending
     rather than success and would permanently block merges once it becomes a required check.
7. **Seven independent PRs, oldest → newest, two commits each** — no reliance on the upmerge.
   - Order: `25.2 → 25.3 → 25.4 → 26.1 → 26.2 → master → 26.3`.
   - Commit 1 = tooling only; commit 2 = the normalized lockfile alone, so verification is
     `check-lockfile.sh --baseline HEAD~1` and the invariant is proven by construction. PRs are squash-merged; the two
     commits exist for review.
   - Tooling files must be **byte-identical** across branches so future upmerges see a clean add/add; a cross-branch
     `sha256sum` comparison is the mitigation.
8. **Pre-merge canary in a consumer FE repo, one per lockfile state**: a PR in e.g. `cplace-remote-filesystem-fe` with
   its `uses:` ref temporarily pinned to the fix branch.
   - Validates before anything merges into `github-actions`, and creates no tags or releases.
   - Must use a `use-npmrc` path — the five workflows that run `npm ci` with no `~/.npmrc` cannot demonstrate the fix
     ([research §5](./research.md)).
9. **Enforcement is out of scope and becomes its own follow-up PFM issue, implemented with GitHub Rule Sets.**
   - Measured today: six release branches unprotected, `master` protected with no required checks, zero rulesets.
   - One ruleset targeting `release/*` + `master` replaces seven per-branch configurations.
   - Until it lands, this ticket's guard is honestly described as **"visibly fails the PR"**, not "rejects."

This means:

- A developer with a JFrog `~/.npmrc` and a fresh clone can repair a broken lockfile immediately — no install, no
  network beyond git, no chicken-and-egg.
- Each PR carries its own proof: 342 changed lines, +4788 bytes, dependency graph identical to its parent commit, one
  distinct registry prefix.
- Every branch is guarded the moment its own PR merges, rather than whenever a human next performs an upmerge.
- The bats suite actually runs in CI, which is more than the repo's existing jest suite gets today.
- A conflict during a future upmerge has a mechanical resolution: `git checkout --ours -- package-lock.json`, re-run
  the idempotent normalizer, then run the check against `:2:` or `:3:` to prove the resolution.

Major trade-offs we're accepting:

1. **Bash + bats instead of TypeScript + jest**: we give up type checking and the repo's established test tooling to
   gain independence from the broken `npm ci`. Partially bought back by shellcheck and bats running in CI.
2. **The guard complains but cannot block** until the Rule Sets follow-up lands. We state this rather than claiming
   enforcement we do not have — the same failure mode as PFM-ISSUE-33179 ("Does Not Block PRs Despite Missing
   Licenses"), now named up front.
3. **Seven PRs instead of three**: the upmerge reaches only five branches, and a `pull_request` workflow protects only
   the branch it already lives on. We pay review effort for deterministic delivery.
4. **The five `npm ci`-without-`~/.npmrc` workflows go from ~69 % to 100 % anonymous JFrog resolution.** No new
   dependency is created, but the blast radius of the anonymous-access shutdown grows; handed explicitly to
   PFM-ISSUE-34454.
5. **This fixes the symptom, not the structure.** The runtime `npm ci` inside a composite action remains the root
   fault; pre-bundling `tools/scripts/*` stays a strategic follow-up.
6. **First `.sh` files in a repo that is otherwise 100 % TypeScript under `tools/`** — a real convention deviation,
   mitigated by the style guide, shellcheck, and bats.

What we're NOT doing (out of scope):

- **Consumer-repo lockfile guarding.** No step is added to `fe-install-deps.yml` or any reusable workflow; a failing
  check there would break currently-green consumer pipelines with no migration window. Deferred to PFM-ISSUE-34454,
  with an out-of-band survey (clone the FE repos, `grep -c registry.npmjs.org`) noted as prep so 34454 starts knowing
  its blast radius.
- **Branch protection / required status checks.** Its own follow-up issue, using GitHub Rule Sets.
- **Enabling `jest` in CI.** Whether the suite passes on any branch is unmeasured; making a time-sensitive lockfile fix
  contingent on unrelated debt is the wrong coupling.
- **Enabling `check-prettier` in CI.** Blocked behind 20 pre-existing failures (9 `tools/` sources, 6 `specs/` docs,
  3 workflow YAMLs, `.github/pull_request_template.md`, and one more). Belongs to the same follow-up family.
- **`DOT_NPMRC` standardization and the JFrog anonymous-access shutdown** (PFM-ISSUE-34454).
- **Branches ≤ 24.2** — latent; do not backport `use-npmrc` there before their lockfiles are normalized.
- **Eliminating the runtime `npm ci`** (pre-bundling via esbuild/ncc, or publishing `tools/scripts/*` as a package).
- **Fixing the stale hard-coded `--release 5.17`** in `tools/scripts/upmerge/upmerge.ts:22` — noticed, not touched.

## Design Decisions — Details

### Dimension 1 — Normalizer: transformation mechanism and code shape

**Chosen Approach:** Bash + jq under `tools/scripts/lockfile/`, Google Shell Style Guide, shellcheck-clean.

**Rationale:** Every node-based option has a bootstrap dependency on the bug it fixes. `npx ts-node` needs
`node_modules`, which needs `npm ci`, which is exactly what fails when the lockfile carries npmjs URLs and `~/.npmrc`
points at JFrog — confirmed to be this developer's actual configuration. Bash + jq runs on a fresh clone with nothing
installed. The usual objection to jq — whole-file reformatting — was measured away: `jq .` round-trips the real
lockfile byte-identically, and the jq rewrite's output is byte-identical to a raw textual rewrite. The only numeric
literal in the file is `"lockfileVersion": 3`, so jq's cross-version number handling has no surface here. jq is
pre-installed on GitHub-hosted ubuntu runners, so the guard needs no setup step at all.

**Alternatives Considered:**

- **Structured TypeScript (`JSON.parse` → mutate → `JSON.stringify(obj, null, 2)`)**: rejected for the bootstrap
  dependency, and because its byte-identity is an empirical property of today's files — a future npm writing different
  formatting would silently reformat 262 KB while still passing the grep-level guard. It was the closest match to
  `tools/scripts/artifacts/nx-project.ts:235-271`.
- **Textual TypeScript rewrite**: same bootstrap dependency; its one advantage over jq (reformatting impossible by
  construction) turned out to be moot once jq's output was measured identical.
- **`sed -i` one-liner**: rejected — GNU vs BSD `sed -i` divergence breaks the macOS developer who is the primary user,
  and it leaves the invariant check nowhere to live.

**Implications:**

- First `.sh` files under `tools/`; needs shellcheck and bats in CI to recover static and behavioural safety.
- The scripts must stay byte-identical across seven branches (see Dimension 7).
- jq must be installed locally by developers on macOS (`brew install jq`); it is present on CI runners.

---

### Dimension 2 — Invariant check: baseline source and comparison strength

**Chosen Approach:** `check-lockfile.sh [--baseline <ref>|<baseline-file>] [<candidate-file>]`, defaulting to
`HEAD:package-lock.json` vs. `./package-lock.json`; plus an in-process self-assertion inside the normalizer. Two
independent assertions, both required.

**Rationale:** A git-ref baseline has nothing to maintain and cannot go stale, and it is addressable exactly where the
check matters most — mid-conflict, against `:2:` (ours) or `:3:` (theirs). Accepting two explicit paths additionally
serves bats fixtures and manual cross-branch comparison. `HEAD` is the right default because the primary flow is
"normalize into the working tree, then prove only prefixes changed."

The two-assertion structure is not belt-and-braces; it is forced by measurement. A fingerprint that strips host and
proxy path — necessary so a legitimately rehosted entry compares equal — is **structurally blind** to which host the
entry was rehosted onto. Injected drift confirmed this: a changed tarball filename (t1) and a changed dependency edge
(t3) are caught, while a typo'd proxy repo name (t2) and an entry left on npmjs (t4) pass silently. Prefix exactness
covers precisely what graph invariance cannot.

The fingerprint uses the **full entry** rather than the research prototype's `version / integrity / tarball / link`
subset, because the subset misses t3 and the full form is a shorter filter.

**Alternatives Considered:**

- **Committed baseline fingerprint artifact**: rejected — a second source of truth that must be regenerated on every
  legitimate dependency change, on seven branches, conflicting on exactly the upmerges this ticket is about.
- **In-process before/after only**: rejected as the primary mechanism — in a bad merge the drift arrives *before* the
  normalizer runs, so a self-comparison happily confirms "I changed only prefixes." Retained as a secondary
  self-assertion.

**Implications:**

- ~~The guard job needs `fetch-depth` sufficient to reach the base commit; `fe-check-upmerge.yml:14` already establishes
  the `fetch-depth: 0` idiom.~~ **Superseded 2026-08-11 (`604f95e`):** the PR guard runs `--prefix-only` and compares
  against no baseline, so the default shallow checkout suffices. The requirement stands for the by-hand `--baseline`
  runs (Flows 1 and 2), which happen on a developer's full clone. See the Deployment section below.
- Entries missing `resolved` outside the `""` root are a hard failure, so a future legitimate `link:`/`file:`/`git+ssh:`
  dependency requires a deliberate, visible loosening rather than a silent pass. Measured safe today:
  `no resolved = 0`, `other protocol = 0` on all seven branches.

---

### Dimension 3 — Registry prefix: hard-coded vs configurable

**Chosen Approach:** One `readonly JFROG_NPM_PROXY='https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/'` in a
shared `lib.sh`, sourced by both scripts. The check additionally asserts that **exactly one** distinct prefix occurs
across all entries.

**Rationale:** The constant *is* the invariant. If the prefix were an input, the check would validate the lockfile
against whatever the caller supplied, so the t2 typo class becomes unfalsifiable. The value is not secret — it is
already committed in plaintext 371 times — so there is no masking argument for parameterizing it. It must also be
byte-identical across seven branches, which a constant makes structural rather than operational.

**Alternatives Considered:**

- **Env var with default (`NPM_PROXY_URL`)**: matches `configuration.ts:2`'s idiom most literally, but weakens the
  invariant and adds a silent-misconfiguration path where a workflow-level override rewrites 171 URLs onto the wrong
  host and still passes its own check.
- **Derive from `JFROG_URL` or `~/.npmrc`**: wrong by construction. `JFROG_URL` is the publish target
  (`…/cplace-npm-local`); `~/.npmrc` is opaque secret text with no guaranteed `registry=` line.

**Implications:**

- A future proxy rename means editing the scripts on all seven branches — but the 171 URLs would need rewriting anyway,
  so this adds no real cost.
- Error text must avoid echoing the host (masked as `***`) and name package paths instead.

---

### Dimension 4 — Invocation surface

**Chosen Approach:** Direct script paths for both humans and CI:
`./tools/scripts/lockfile/normalize-lockfile.sh`, `./tools/scripts/lockfile/check-lockfile.sh`. No npm scripts, no
composite action. `tools/scripts/lockfile/README.md` documents the three flows (per-branch rollout, conflict
resolution, interpreting a guard failure), and every failure message names both the README and the remediation command.

**Rationale:** The repo's convention — always `npx ts-node …` from a composite — exists because those scripts are
TypeScript needing a `ts-node` bootstrap; the rationale does not transfer to bash. Calling a path inside its own
checkout keeps the zero-install property in CI as well as locally and, importantly, adds **no branch-pinned
`@release/x.y` self-reference**, avoiding the internal-ref-update chore the Node 24 design doc recorded across seven
long-lived branches.

**Alternatives Considered:**

- **Composite action wrapper for CI**: matches the dominant idiom but buys indirection with exactly one caller, since
  consumer-side guarding is out of scope. Promoting the script into a composite later is mechanical, so deferring costs
  nothing.
- **npm scripts as the front door**: best discoverability and it does not break the bootstrap property (`npm run` works
  without `node_modules`), but it contradicts the documented convention, adds a `package.json` edit to seven branches
  for a pure alias, and creates two ways to invoke the same thing.

**Implications:**

- Discoverability is solved by documentation, not by an alias — so the README and the failure messages carry real
  weight and must be written, not stubbed.

---

### Dimension 5 — The PR guard

**Chosen Approach:** New `.github/workflows/pr-checks.yml`, `on: pull_request: branches: ['**']`, no `paths:` filter,
two jobs:

- `lockfile` — checkout, run `check-lockfile.sh`. jq only; no `setup-node`, no `npm ci`.
- `scripts` — shellcheck + bats over `tools/scripts/lockfile/`, installed via `bats-core/bats-action` or `apt-get`.

**Rationale:** The acceptance criterion cannot be satisfied by editing an existing workflow — every file in
`.github/workflows/` is `workflow_call`-only, and the `pull_request` trigger lives in a template GitHub never executes.
Running shellcheck and bats alongside the guard means the new shell scripts are actually protected against a bad
upmerge of themselves, instead of repeating the repo's existing "tests exist but run nowhere" pattern. Both jobs stay
node-free, so the workflow that must be trustworthy when the lockfile is broken never depends on installing it.

Naming avoids the `fe-` prefix, which in this repo denotes a reusable workflow consumed by other repositories.

**Alternatives Considered:**

- **Lockfile guard only**: smallest diff, but leaves the new shell scripts untested in CI on all seven branches.
- **Also enabling `jest` and `check-prettier`**: rejected on measurement. `prettier --check .` fails on 20 pre-existing
  files, and whether `npm test` passes is unmeasured — either would convert a red ✗ into a rollout blocker for a fix
  that itself blocks PFM-ISSUE-34454. `prettier --check` on the lockfile is measured safe both before and after
  normalization, so the lockfile is not the obstacle; the other 20 files are.

**Implications:**

- One third-party action to pin by SHA, following the convention in
  `specs/2026-06-05_node24-workflow-migration/sha-pins.md`.
- `.prettierignore` gains `package-lock.json` as **forward-looking insurance only** — prettier currently leaves the
  file byte-unchanged both before and after normalization, so this protects against a future npm writing differently
  formatted JSON once prettier eventually runs in CI.
- The guard's failure message names `./tools/scripts/lockfile/normalize-lockfile.sh` and the check command, so a
  developer never has to find the README first.

---

### Dimension 6 — Rollout

**Chosen Approach:** Seven independent PRs, oldest → newest
(`25.2 → 25.3 → 25.4 → 26.1 → 26.2 → master → 26.3`), two commits each (tooling, then the normalized lockfile alone),
squash-merged. Byte-identical tooling files across branches. A pre-merge canary per lockfile state.

**Rationale:** The ticket's "land it at 25.2 and let the upmerge carry it" holds for at most five branches: `master` and
`26.3` are not downstream of `26.2`, and the upmerge itself is a human process that the Node 24 migration shows can
stall (its five follow-on PRs were scoped as "Migration Notes" and not executed). More decisively, a `pull_request`
workflow runs from the **base branch's** copy, so a branch is unguarded until the file exists on it — waiting on
upmerges leaves an unbounded window during which the lockfiles stay broken while this ticket blocks 34454. Independent
PRs also make the procedure uniform across all seven branches instead of two procedures for two topologies, and
identical tooling blobs merge cleanly (git treats add/add of identical content as no conflict), so the extra PRs create
no upmerge debt.

The two-commit split makes the invariant provable by construction: the lockfile commit's parent *is* the baseline, so
verification is exactly `check-lockfile.sh --baseline HEAD~1`, with no remembered ref to get wrong.

**Alternatives Considered:**

- **The ticket's plan, corrected (three PRs plus four human upmerges)**: fewest PRs and matches convention, but
  delivery time is unbounded and the work per branch is identical — the same conflict resolution, done later, by
  someone with less context.
- **Gating each lockfile state on a canary**: adopted, but as a sequencing rule layered on this option rather than as
  an alternative delivery model.

**Implications:**

- Tooling drift across branches would reintroduce upmerge conflicts; mitigate with a cross-branch `sha256sum`
  comparison of `tools/scripts/lockfile/*` and `pr-checks.yml` before each PR.
- The already-pending `25.2 → 25.3` upmerge (2 commits) is unaffected — normalizing 25.3 directly does not depend on it.
- Re-probe the proxy for all 171 tarballs before the first PR ([research OQ6](./research.md)): the ticket's
  166 × 200 / 5 × 302 result was taken on faith, and a curated-repo or Xray policy change would invalidate the
  approach.

---

### Dimension 7 — Canary validation

**Chosen Approach:** For each of the three lockfile states (`25.2` | `25.4` | `26.x`), open a PR in a consumer FE repo
(e.g. `cplace-remote-filesystem-fe`) against the branch pinned to the matching `github-actions` branch, with the
`uses:` ref temporarily pointed at the fix branch. Confirm the composite's internal `npm ci` resolves.

**Rationale:** A consumer pins the shared workflow by branch, which resolves to that branch's tip — so a canary using
the normal pin could only run *after* merging. Temporarily re-pinning the consumer PR's `uses:` ref validates before
anything lands in `github-actions`. This creates no tags and no release. The canary must use a `use-npmrc` path,
because the five workflows that run `npm ci` with no `~/.npmrc` resolve npmjs URLs normally today and therefore cannot
demonstrate the fix.

**Alternatives Considered:**

- **Tag/release pipeline canary**: rejected by explicit preference — no tags are to be created for validation.
- **Post-merge canary on the normal pin**: rejected; it inverts prove-then-merge into merge-then-hope.

**Implications:**

- `fe-pr-snapshot` publishes a `latest-pr-snapshot` package to JFrog (cleaned up by `fe-pr-close`). Not a tag or
  release, but a real publish — called out so it is not a surprise.
- The specific consumer repo and branches are an implementation-planning detail.

---

### Dimension 8 — Consumer-repo lockfiles

**Chosen Approach:** Out of scope. No change to `fe-install-deps.yml` or any reusable workflow.

**Rationale:** A failing check in a reusable workflow fires in **every** consumer repo at once, across all seven pinned
branches, breaking pipelines that are green today with no migration window and no consumer-side normalizer available.
It would also invert the dependency with PFM-ISSUE-34454, which already owns consumer-side `DOT_NPMRC` standardization.

**Alternatives Considered:**

- **Warning-only reconnaissance step**: zero risk of breakage and would feed 34454 real exposure data, but it modifies
  a workflow every FE repo depends on, on seven branches, and unowned warnings get ignored. The same data is available
  out-of-band.
- **Failing check in `fe-install-deps.yml`**: would genuinely enforce the broader criterion, at the cost of breaking
  currently-green consumer pipelines immediately.

**Implications:**

- An **out-of-band consumer lockfile survey** (clone the FE repos, `grep -c registry.npmjs.org` per repo and branch) is
  noted as prep work for PFM-ISSUE-34454, so it begins with a known blast radius.
- After normalization, the five `npm ci`-without-`~/.npmrc` workflows resolve 100 % of packages anonymously from JFrog
  instead of ~69 %. No new dependency, larger exposure — 34454's concern, recorded here as understood and accepted.

---

### Dimension 9 — Interim mitigation (added 2026-08-11, after implementation)

**Chosen Approach:** `.github/actions/use-npmrc` appends `replace-registry-host=never` to the `~/.npmrc` it writes, and
additionally runs an advisory `warn-foreign-registry.sh` against the **consumer's** lockfile.

**Rationale:** Dimension 8 declared consumer-repo lockfiles out of scope on the reasoning that a failing check in a
reusable workflow would break currently-green pipelines. Implementation found that reasoning rested on a false premise:
**`cplace-paw-fe` `release/25.2` and `release/25.3` are not green — they are broken today**, each carrying 14
`registry.npmjs.org` entries in their own lockfile. Verified with a cold cache and the real secret:
`E404 GET https://cplace.jfrog.io/readdirp/-/readdirp-3.6.0.tgz`. Nothing masks it: that repo has zero caches on those
branches, and the cache key is `hashFiles('**/package-lock.json')`, so a cross-branch hit is impossible by
construction.

That splits the problem into **two failure surfaces**, which this design had treated as one:

| surface | where `npm ci` runs | whose lockfile | fixed by |
| --- | --- | --- | --- |
| composite | the action's own checkout, outside the workspace | *this* repo's | normalization (Dimensions 1–3) |
| consumer | the workspace | the *consumer's* | **only** the mitigation, or normalizing that consumer |

`replace-registry-host=never` makes npm fetch each `resolved` URL verbatim rather than rewriting its host, which fixes
both surfaces at once and needs no lockfile change anywhere. Measured against real lockfiles with the real secret:
github-actions un-normalized → `added 542 packages`; `cplace-paw-fe release/25.2` → `added 2576 packages`.

**Alternatives Considered:**

- **Revert `use-npmrc` to a workspace-level `.npmrc`** (the pre-Node-24 behaviour). Rejected on measurement: it fixes
  only the composite surface, because a consumer's own `npm ci` runs *in* the workspace where that file lives — so
  `cplace-paw-fe` stays broken. It also makes the composite's install issue **730 anonymous JFrog requests per run**,
  creating exactly the dependency PFM-ISSUE-34454 exists to remove.
- **`--replace-registry-host=never` on the four composites' `npm ci` only.** Smallest blast radius and no
  consumer-visible change, but likewise leaves every consumer lockfile broken.
- **Conditional application** — set the flag only when a scan finds foreign URLs. Rejected: it makes behaviour
  branch-dependent and harder to reason about, for no gain. The flag is a **no-op** on a clean lockfile, so applying it
  unconditionally is deterministic; the *warning* carries the signal instead.

**Implications:**

- **This is a mitigation, not the fix.** Under it, entries still on npmjs are fetched directly from npmjs, bypassing
  Xray and curation. Removal is owned by PFM-ISSUE-34454.
- **The warnings are the removal criteria.** `warn-foreign-registry.sh` emits a `::warning` annotation plus a job
  summary naming offending package paths; when no pipeline reports one, the line comes out. The mitigation thus
  inventories its own obsolescence.
- **The two compose safely in either order** — on a normalized lockfile the flag is a no-op — so removal is lazy and
  per-branch rather than a coordinated switchover.
- **The check must never fail a build.** It runs in every consumer's pipeline; missing lockfile, missing `jq` and
  invalid JSON all exit 0 silently, and local-path `resolved` values (present in 4 of 41 FE repos) are ignored rather
  than reported as false positives.
- **A clean JFrog access log no longer proves everything resolves through the proxy** while this is in place, because
  npmjs-direct requests never reach JFrog at all. Recorded on PFM-ISSUE-34454, whose shutdown criteria depend on it.

---

## Overall Architecture

### Key Components

1. **`tools/scripts/lockfile/lib.sh`** — shared constants (the one proxy prefix) and helpers. Sourced by both scripts.
2. **`tools/scripts/lockfile/normalize-lockfile.sh`** — rewrites `.packages[].resolved` prefixes via jq; self-asserts
   before/after; idempotent; prints the count rewritten and the byte delta.
3. **`tools/scripts/lockfile/fingerprint.jq`** — reduces a lockfile to a registry-independent, comparable form
   (every `resolved` → its tarball path).
4. **`tools/scripts/lockfile/check-lockfile.sh`** — runs both assertions (graph invariance vs. baseline; prefix
   exactness) and reports drift by package path. Exit 0 / 1.
5. **`tools/scripts/lockfile/warn-foreign-registry.sh`** — advisory scan of the **consumer's** lockfile, run by
   `use-npmrc`. Emits a `::warning` plus job summary; never fails a build. Added by Dimension 9.
6. **`tools/scripts/lockfile/*.bats`** — behavioural tests over small JSON fixtures, including the six injected-drift
   cases (t1–t6) that motivated the two-assertion design.
7. **`tools/scripts/lockfile/README.md`** — the documented entry point: rollout flow, conflict-resolution runbook,
   guard-failure interpretation.
8. **`.github/workflows/pr-checks.yml`** — `lockfile` and `scripts` jobs.
9. **`package-lock.json`** — the artifact under change: 171 `resolved` prefixes per branch.

### Data Flow

**Rollout (per branch):** developer runs `normalize-lockfile.sh` → 171 prefixes rewritten, +4788 bytes → commit the
lockfile alone → `check-lockfile.sh --baseline HEAD~1` → graph identical, one distinct prefix, zero npmjs → push →
`pr-checks.yml` re-runs the same check on the PR → canary PR in a consumer repo proves `npm ci` resolves → merge.

**Conflict resolution (future upmerge):** conflict on `package-lock.json` → `git checkout --ours -- package-lock.json`
→ re-run the idempotent normalizer → `check-lockfile.sh --baseline :2:` (or `:3:`) → proceed only on exit 0. Never
`--theirs`, never a hand edit.

**Guard (every PR):** `pr-checks.yml` → `lockfile` job runs `check-lockfile.sh --prefix-only` → on failure, prints
offending package paths plus the remediation command; `scripts` job runs shellcheck + bats. **It asserts prefix
exactness only.** Graph invariance forbids any dependency change, so gating pull requests on it would fail every
legitimate `npm install`; it is run by hand with `--baseline` to verify a normalization commit. A green PR is therefore
not evidence that a lockfile diff changed only prefixes.

### Integration Points

- `.github/workflows/pr-checks.yml` is self-contained — it calls scripts in its own checkout, with no composite action
  and no branch-pinned reference.
- The four affected composites (`artifacts`, `snapshots`, `upmerge`, `run-many`) are **not modified**; they simply stop
  failing once the lockfile they `npm ci` is internally consistent.
- ~~`.github/actions/use-npmrc/action.yml` is **not modified** — that is PFM-ISSUE-34454's territory.~~
  **Superseded by [Dimension 9](#dimension-9--interim-mitigation-added-2026-08-11-after-implementation).** It *is*
  modified: it appends `replace-registry-host=never` and runs the advisory `warn-foreign-registry.sh`. The reasoning
  that put it out of scope assumed consumer pipelines were green; two are not. **Removal** remains
  PFM-ISSUE-34454's territory, and that issue now carries the removal criteria.

## Technology Choices

**Normalizer / check language:**

- Choice: bash (Google Shell Style Guide) + jq
- Why: the only option runnable when `npm ci` is broken; jq output measured byte-identical to a textual rewrite; jq
  pre-installed on CI runners.

**Test framework:**

- Choice: bats, installed in the workflow via action or `apt-get`
- Why: the only realistic test framework for shell here. Explicitly **not** an npm devDependency, because that would
  mutate `package-lock.json` on all seven branches and contradict the invariant this ticket establishes.

**Static analysis:**

- Choice: shellcheck in the `scripts` job
- Why: recovers part of the type-checking safety lost by leaving TypeScript; already available locally (0.11.0).

**Guard trigger:**

- Choice: `on: pull_request: branches: ['**']`, no `paths:` filter
- Why: mirrors `.github/workflow-templates/fe/fe-pr.yml:2-5`; a path filter would report pending and permanently block
  merges once the check becomes required.

## Trade-offs & Risks

### Accepted Trade-offs

1. **Bash + bats over TypeScript + jest**: accepting weaker static guarantees and a convention deviation to gain
   independence from the broken `npm ci`.
2. **A guard that reports but cannot block**: accepting a visibility-only guard now to keep enforcement (Rule Sets) as
   a separately owned, correctly scoped change.
3. **Seven PRs**: accepting review overhead to gain deterministic, upmerge-independent delivery.
4. **100 % anonymous JFrog resolution in five workflows**: accepting a larger blast radius for the anonymous-access
   shutdown, explicitly handed to PFM-ISSUE-34454.
5. **Symptom over structure**: accepting that the runtime `npm ci` inside a composite remains the root fault.

### Known Risks

1. **Proxy availability was never re-probed.** If a curated-repo or Xray policy blocks any of the 171 tarballs through
   `cplace-npm`, the entire approach fails. — *Mitigation:* re-probe all 171 URLs before the first PR; treat a
   non-200/302 as a stop-the-line finding.
2. **Tooling drift across the seven branches** would reintroduce upmerge conflicts on files meant to be identical. —
   *Mitigation:* `sha256sum` comparison of `tools/scripts/lockfile/*` and `pr-checks.yml` across branches before each
   PR.
3. **The guard is unenforced until the Rule Sets follow-up lands**, so a determined merge can still reintroduce npmjs
   URLs on six unprotected branches. — *Mitigation:* file the follow-up issue immediately, in parallel with this
   rollout, not after it.
4. **jq absent on a developer's macOS machine** blocks local use. — *Mitigation:* the README states the one-line
   install; CI runners have it pre-installed.
5. **A future lockfile with `link:`/`file:`/`git+ssh:` entries** would fail the "every entry has `resolved`" assertion. —
   *Mitigation:* intentional. The failure names the package path, so loosening is a deliberate, reviewed edit.
6. **A bad merge could alter the scripts themselves**, and the lockfile invariant does not cover them. — *Mitigation:*
   bats + shellcheck run on every PR; risk 2's checksum comparison catches divergence.

## Out of Scope

- Consumer-repo lockfile guarding (→ PFM-ISSUE-34454; out-of-band survey noted as prep).
- Branch protection / required status checks (→ own follow-up issue, GitHub Rule Sets).
- Enabling `jest` in CI (unmeasured), and `check-prettier` in CI (20 pre-existing failures).
- `DOT_NPMRC` standardization and the JFrog anonymous-access shutdown (PFM-ISSUE-34454).
- Branches ≤ 24.2 (latent; do not backport `use-npmrc` before normalizing their lockfiles).
- Eliminating the runtime `npm ci` via pre-bundling or publishing `tools/scripts/*`.
- The stale `--release 5.17` in `tools/scripts/upmerge/upmerge.ts:22`.
- Modifying `use-npmrc` or any of the four affected composite actions.

## Success Criteria

- `grep -c 'registry.npmjs.org' package-lock.json` returns **0** on all seven branches.
- On each branch, `check-lockfile.sh --baseline HEAD~1` exits 0: dependency graph identical, exactly one distinct
  `resolved` prefix, zero entries missing `resolved` outside root.
- Each lockfile commit shows exactly **342 changed lines** and **+4788 bytes**, with no non-`resolved` line changed.
- The normalizer is idempotent: a second run rewrites 0 entries and changes 0 bytes.
- The invariant check **fails** on injected drift — poisoned `version`, poisoned `integrity`, changed tarball filename,
  typo'd proxy prefix, an entry left on npmjs — naming the offending package path in each case.
- A consumer-repo canary PR per lockfile state completes the composite's internal `npm ci` successfully on a
  `use-npmrc` path.
- `pr-checks.yml` fails a PR that reintroduces `registry.npmjs.org`, and its message names the remediation command.
- bats and shellcheck pass in CI on all seven branches.
- `tools/scripts/lockfile/*` and `pr-checks.yml` are byte-identical across all seven branches.

## Next Steps

1. Review this design document.
2. Refine if needed based on feedback.
3. Proceed to implementation planning:
   `/spec-driven-development:create_plan specs/2026-08-10_normalize-package-lock-resolved-urls/design.md`

Also to be filed alongside the plan:

- Follow-up PFM issue: **enforcement via GitHub Rule Sets** for `release/*` + `master` (and, in the same family,
  enabling `jest` / `check-prettier` once the 20 pre-existing prettier failures are cleaned up).
- Prep note on PFM-ISSUE-34454: out-of-band consumer lockfile survey.

## References

- Original ticket: [PFM-ISSUE-34453](https://base.cplace.io/pages/6lxohwjr2a51h39y5idjx6qj2/PFM-ISSUE-34453-github-actions-Normalize-package-lock.json-resolved-URLs-onto-the-JFrog-npm-proxy-release-25.2-master)
- Related research: [research.md](./research.md)
- Upstream cause: [`specs/2026-06-05_node24-workflow-migration/design.md`](../2026-06-05_node24-workflow-migration/design.md)
  (replaced `bduff9/use-npmrc` with the in-repo composite writing `~/.npmrc`)
- SHA-pinning convention: [`specs/2026-06-05_node24-workflow-migration/sha-pins.md`](../2026-06-05_node24-workflow-migration/sha-pins.md)
- Blocked ticket: PFM-ISSUE-34454 (`DOT_NPMRC` standardization; JFrog anonymous-access shutdown)
- Prior "check does not block" precedent: PFM-ISSUE-33179 (`5c4ba52`)
- JSON read/mutate/write pattern: `tools/scripts/artifacts/nx-project.ts:235-271`
- Fail-loudly validator pattern: `tools/scripts/artifacts/utils.ts:309-328`
- Publish target vs. install proxy: `tools/scripts/artifacts/configuration.ts:2`
- The regression's mechanism: `.github/actions/use-npmrc/action.yml:10-14`
- Affected composites: `.github/actions/{artifacts,snapshots,upmerge,run-many}/action.yml`
- Non-executing PR template: `.github/workflow-templates/fe/fe-pr.yml:2-5`
