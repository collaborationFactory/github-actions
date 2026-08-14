---
date: 2026-08-10T15:26:55+02:00
git_commit: 967168ed1c896821e28a3ad343ddfcc6b07a4bcb
branch: fix/PFM-ISSUE-34453-normalize-package-lock-json/25.2
baseline_branch: release/25.2
baseline_commit: 967168ed1c896821e28a3ad343ddfcc6b07a4bcb
researched_from_working_tree: release/26.2 @ f79120d47a50d66d5960d94dd70c9237ac3f04c9
topic: 'PFM-ISSUE-34453: Normalize package-lock.json resolved URLs onto the JFrog npm proxy'
tags:
  [
    research,
    codebase,
    package-lock,
    npm,
    jfrog,
    artifactory,
    use-npmrc,
    composite-actions,
    upmerge,
    ci,
  ]
status: complete
last_updated: 2026-08-10
---

# Research: PFM-ISSUE-34453 — Normalize `package-lock.json` resolved URLs onto the JFrog npm proxy

**Date**: 2026-08-10T15:26:55+02:00
**Branch**: `fix/PFM-ISSUE-34453-normalize-package-lock-json/25.2`
**Git Commit**: `967168e` (`967168ed1c896821e28a3ad343ddfcc6b07a4bcb`) — branched off `origin/release/25.2`, the branch the fix must land on first
**Researched from**: the `release/26.2` working tree @ `f79120d`, analysing `origin/release/25.2` via a read-only worktree

## Research Question

Research the codebase for PFM-ISSUE-34453: the repo ships a mixed `package-lock.json` in which 171 entries still
resolve via `registry.npmjs.org`, which npm rewrites onto the JFrog host while dropping the registry's path prefix,
producing `E404` in consumer pipelines. Work must start on `release/25.2`, and branches follow the pattern
`fix/PFM-ISSUE-34453-normalize-package-lock-json/<RELEASE-BRANCH-VERSION>`.

## PFM Ticket Context

- **Ticket**: [PFM-ISSUE-34453](https://base.cplace.io/pages/6lxohwjr2a51h39y5idjx6qj2/PFM-ISSUE-34453-github-actions-Normalize-package-lock.json-resolved-URLs-onto-the-JFrog-npm-proxy-release-25.2-master)
- **Title**: github-actions: Normalize package-lock.json resolved URLs onto the JFrog npm proxy (release/25.2 - master)
- **Type**: PFM-ISSUE, subtype `10.bug`
- **Target Release**: 25.2 (reported in 26.2)
- **Status / Priority**: `10.unqualified` / `20.high`
- **Assignee**: not set on the ticket (creator / requested by: Christian Kaltenbach) — *inferred, field empty*
- **Squad**: 01 - Build & Connect / Stratum · **Topic**: GitHub · **Reported By**: extern (Service Desk INC-019045)
- **Relations**: blocks PFM-ISSUE-34454 (Standardize `DOT_NPMRC` across FE consumer repos and pre-flight the JFrog anonymous-access shutdown)
- **Branch pattern (user-specified, overrides the ticket's `branchName` field)**:
  `fix/PFM-ISSUE-34453-normalize-package-lock-json/<RELEASE-BRANCH-VERSION>`
  → `…/25.2`, `…/25.3`, `…/25.4`, `…/26.1`, `…/26.2`, `…/26.3`, `…/master`
  (the ticket's own field reads `fix/PFM-ISSUE-34453-github-actions-Normalize-package-lock-json`)

### Description (condensed; full text in the ticket)

`collaborationFactory/github-actions` ships a **mixed** `package-lock.json`: 171 of its non-root entries resolve via
`https://registry.npmjs.org/` while the rest resolve via `https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/`.
The shared composite actions run `npm ci` inside the action directory while the consumer's user-level `~/.npmrc` is
active, so npm rewrites those 171 URLs onto the configured registry and **drops the registry's path prefix**,
producing a 404. The failure is hard to spot because the broken URL prefix is the `JFROG_URL` secret and therefore
masked as `***`.

npm root cause: `node_modules/pacote/lib/remote.js:16` — `this.resolved = new URL(resolvedURL.pathname, this.registry).href`.
Because `resolvedURL.pathname` starts with `/`, the registry's path is discarded under npm's default
`replace-registry-host=npmjs`:

| | |
| --- | --- |
| lockfile | `https://registry.npmjs.org/update-browserslist-db/-/update-browserslist-db-1.0.10.tgz` |
| requested | `https://cplace.jfrog.io/update-browserslist-db/-/update-browserslist-db-1.0.10.tgz` → **404** |
| correct | `https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/update-browserslist-db/-/update-browserslist-db-1.0.10.tgz` → 200 |

**Regression trigger**: the Node 24 migration replaced `bduff9/use-npmrc@v1.1` (wrote `<workspace>/.npmrc`, invisible
to the action's own install) with the in-repo `.github/actions/use-npmrc` (writes `~/.npmrc`, active for every npm
invocation on the runner).

**The fix**: a pure rewrite of the `resolved` field prefix (171 occurrences per branch) — no `version`, no `integrity`,
no graph change. Delivered as (1) a normalizer, (2) an invariant check, (3) an ongoing PR-pipeline guard. Rollout is
one PR per branch, oldest → newest; the lockfile change must not ride the upmerge. Normalizer + check land at
`release/25.2` so the upmerge carries them upward.

**Out of scope**: `DOT_NPMRC` standardization / JFrog anonymous-access shutdown (PFM-ISSUE-34454); branches ≤ 24.2
(latent — do not backport `use-npmrc` there before their lockfile is normalized); eliminating the runtime `npm ci`
(pre-bundling via esbuild/ncc — strategic follow-up).

## Summary

Every factual claim in the ticket that could be checked locally **was checked and holds**. Beyond confirming the
ticket, the research surfaced **four findings that materially change the implementation plan**:

1. **The transformation is provably safe, and both plausible implementations are byte-safe.** A prototype run against
   all three lockfile states rehosts exactly 171 entries, leaves the dependency graph identical, is idempotent, and
   changes only `"resolved"` lines (342 changed diff lines = 171 × 2, zero non-`resolved` lines). Critically,
   `JSON.parse` → `JSON.stringify(obj, null, 2) + '\n'` round-trips the real lockfiles **byte-identically**
   (262 063 → 262 063 bytes on 25.2; 270 244 → 270 244 on master), so a parse/mutate/serialize normalizer is just as
   safe as a textual regex — the formatting-drift risk usually associated with rewriting lockfiles does not exist here.
2. **There is no `pull_request`-triggered workflow in this repository at all.** All 13 `.github/workflows/fe-*.yml`
   files are `on: workflow_call:` only; the `pull_request` trigger lives in `.github/workflow-templates/fe/fe-pr.yml`,
   which GitHub *never executes* — it is template content offered to consumer repos. The repo's own `jest` tests and
   `prettier --check` are likewise **not run by any workflow**. The acceptance criterion "the PR pipeline rejects any
   `package-lock.json` containing `registry.npmjs.org`" therefore cannot be satisfied by editing an existing workflow;
   it requires creating the repo's **first** `on: pull_request` workflow.
3. **The upmerge is a Slack notifier, not an upmerge.** `tools/scripts/upmerge/upmerge.ts:22` runs
   `cplace-cli flow --upmerge --release 5.17 --no-push --show-files` — a dry run that only detects a pending upmerge
   and posts to `#frontend-upmerge`. No merge is performed or pushed by CI, and no branch chain is encoded in this
   repo. The "regular upmerge" that the ticket relies on to carry the normalizer upward is a **human-driven** process.
4. **`master` and `release/26.3` are NOT downstream of `release/26.2` in git ancestry**, so a commit made at
   `release/25.2` will *not* reach them by upmerging along the release chain. `master` is 17 commits behind `26.2` and
   received the Node 24 migration through a **separate** PR (`914a755 up master: PFM-TASK-7777 … (#132)`);
   `release/26.3` was branched off `master` (`b5869c7`, parent `53ea313`), not off `26.2`. The chain is
   `25.2 → 25.3 → 25.4 → 26.1 → 26.2` **plus two independent tips** (`master`, and `26.3` off `master`).

A fifth, softer finding: five reusable workflows invoke a composite whose internal `npm ci` runs with **no `~/.npmrc`
at all**, which is why they do not currently fail — and which ties this ticket to the linked PFM-ISSUE-34454.

## Detailed Findings

### 1. Lockfile state — measured, all seven branches

Measured with `jq` over `git show origin/<branch>:package-lock.json` (`lockfileVersion: 3` on every branch; no legacy
`dependencies` mirror section — top-level keys are exactly `lockfileVersion, name, packages, requires, version`):

| Branch | lockfile sha256[:10] | non-root entries | `registry.npmjs.org` | `cplace.jfrog.io` | no `resolved` | other protocol |
| --- | --- | --- | --- | --- | --- | --- |
| `release/25.2` | `21aead4730` | 542 | **171** | 371 | 0 | 0 |
| `release/25.3` | `012c07592f` | 542 | **171** | 371 | 0 | 0 |
| `release/25.4` | `012c07592f` | 542 | **171** | 371 | 0 | 0 |
| `release/26.1` | `d06efe2cba` | 558 | **171** | 387 | 0 | 0 |
| `release/26.2` | `d06efe2cba` | 558 | **171** | 387 | 0 | 0 |
| `release/26.3` | `d06efe2cba` | 558 | **171** | 387 | 0 | 0 |
| `master`       | `d06efe2cba` | 558 | **171** | 387 | 0 | 0 |

Confirms the ticket exactly:

- **Three distinct lockfile states**, grouped `25.2` | `25.3 = 25.4` | `26.1 = 26.2 = 26.3 = master`.
- `371 + 171 + 1 = 543` and `387 + 171 + 1 = 559` entries including root — **no `git+ssh:`, `file:` or `link: true`
  entries need special handling** (`other protocol = 0`, `no resolved = 0` on every branch).
- The **171 npmjs entries are byte-identical across all three states**: extracting
  `path \t version \t resolved \t integrity` for the npmjs subset and diffing gives `IDENTICAL` for 25.2 vs 25.4 and
  25.4 vs master, at exactly 171 lines. The inter-branch difference lies exclusively in the untouched JFrog entries
  (16 extra packages in 26.x).
- All 171 are standard `/<name>/-/<file>.tgz` tarball URLs (a regex filter for non-standard shapes returns nothing),
  so a single prefix rewrite is sufficient — there is no scoped/aliased/edge-case URL form to special-case.
- `grep -c 'registry.npmjs.org' package-lock.json` returns **171** on each state, and total occurrences also equal 171
  — i.e. one occurrence per line, no second occurrence hiding elsewhere in the file. The acceptance criterion's `grep -c`
  is therefore a faithful measure.

The ticket's own sha values (`d6898012d0` / `18277f9f84` / `499e0da7b9`) differ from the sha256 prefixes above because
a different hashing method was used; **the grouping is what matters and it matches exactly**.

### 2. The transformation and the invariant check — prototyped and proven

A research spike (`proto-normalize.mjs`, scratchpad only — not a deliverable) applied
`"resolved": "https://registry.npmjs.org/` → `…"https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/` and then
compared `path → (version, integrity, tarball path, link)` before/after. Results on all three states:

| state | entries rehosted | npmjs left | graph invariant | idempotent | byte delta | trailing newline |
| --- | --- | --- | --- | --- | --- | --- |
| 25.2 | 171 | 0 | **IDENTICAL** | yes | +4788 | preserved |
| 25.4 | 171 | 0 | **IDENTICAL** | yes | +4788 | preserved |
| master | 171 | 0 | **IDENTICAL** | yes | +4788 | preserved |

`+4788 = 171 × 28`, where 28 is the length difference between the two registry prefixes — an exact arithmetic check
that nothing else changed. Structural equality of the whole document with all `resolved` values stripped is `true`.
A line-level diff confirms **342 changed lines, of which 0 are non-`resolved` lines**.

**The invariant check has teeth.** Simulating the bad merge the ticket warns about — poisoning one entry's `version`
(`2.2.0` → `9.9.9`) and another's `integrity` (→ `sha512-POISONED==`), then normalizing and comparing against the
clean pre-fix baseline — the check **fails with exit 1** and names both drifts:

```
node_modules/@ampproject/remapping: version "2.2.0" -> "9.9.9"
node_modules/@ampproject/remapping/node_modules/@jridgewell/gen-mapping: integrity "sha512-sQXCas…" -> "sha512-POISONED=="
```

while the clean normalized file against the same baseline reports `PASS - graph identical` (exit 0). Note the check
must normalize the *tarball path* when comparing (strip the `/artifactory/api/npm/cplace-npm` prefix from
`URL.pathname`) so that a legitimately rehosted entry compares equal while a changed tarball filename does not.

**Implementation freedom (new finding).** The agent research recommended a parse → mutate → `JSON.stringify(obj, null, 2)`
round-trip but flagged formatting drift as a risk. Measured: the round-trip is **byte-identical** on the real
lockfiles (`identical=true`, `delta=0` on both 25.2 and master). npm's lockfile writer and `JSON.stringify(…, null, 2) + '\n'`
agree exactly. So either implementation is safe, and the choice can be made on readability/testability grounds rather
than on byte-safety.

### 3. Where the failure happens — the four composite actions

All four affected composites use the identical idiom, with no `working-directory:` key — the `cd` inside `run:` does
the work, walking out of `.github/actions/<name>/` to the repo root:

- [`.github/actions/artifacts/action.yml:8`](.github/actions/artifacts/action.yml) — `cd "$GITHUB_ACTION_PATH/../../.." && pwd && npm ci`, then `:10` `npx ts-node .../tools/scripts/artifacts/main.ts`
- [`.github/actions/snapshots/action.yml:8`](.github/actions/snapshots/action.yml) — same `npm ci`, then `:10` `.../tools/scripts/artifacts/main-snapshots.ts`
- [`.github/actions/upmerge/action.yml:8`](.github/actions/upmerge/action.yml) — same `npm ci`, then `:10` `npm install -g @cplace/cli`, then `:12` `.../tools/scripts/upmerge/main.ts`
- [`.github/actions/run-many/action.yml:22`](.github/actions/run-many/action.yml) — same `npm ci`, then `:24` `.../tools/scripts/run-many/run-many.ts`

All four `npm ci` steps run **unconditionally** — unlike the top-level `npm ci` steps in the calling workflows, they
carry no `if: steps.npm-cache.outputs.cache-hit != 'true'` guard, so they execute on every run regardless of cache.

The `npm ci` is needed only to make `npx ts-node` and the `tools/scripts/**` sources runnable — which is exactly why
the ticket lists pre-bundling as the strategic follow-up.

### 4. `use-npmrc` — the whole file, and what it does not do

[`.github/actions/use-npmrc/action.yml`](.github/actions/use-npmrc/action.yml), lines 10-14:

```yaml
- name: Write ~/.npmrc
  shell: bash
  env:
    DOT_NPMRC: ${{ inputs.dot-npmrc }}
  run: echo "$DOT_NPMRC" > ~/.npmrc
```

- Writes **`~/.npmrc`** (runner home), not `$GITHUB_WORKSPACE/.npmrc` — this is precisely the regression the ticket
  identifies, since `~/.npmrc` is active for *every* npm invocation on the runner, including the composites' own `npm ci`.
- Fed by input `dot-npmrc` ← `secrets.DOT_NPMRC` at all seven call sites (`fe-cleanup-snapshots.yml:39`,
  `fe-install-deps.yml:38`, `fe-licenses.yml:41`, `fe-pr-close.yml:41`, `fe-pr-snapshot.yml:43`, `fe-release.yml:42`,
  `fe-sonar.yml:61`).
- Sets **no** npm config of its own: no `npm config set`, no `registry=`, and **no `replace-registry-host`** anywhere
  in the repo (verified by `git grep` on `origin/release/25.2` — the only non-lockfile hits for registry-ish terms are
  `DOT_NPMRC` plumbing and `JFROG_URL` in `tools/scripts/artifacts/`). Registry and auth configuration is entirely
  opaque, embedded in the secret's text.
- **No cleanup**: no `post:` step, nothing removes `~/.npmrc`. It persists for the rest of the job.
- No root `.npmrc` exists in the repo.

Consequently, the fix cannot be achieved by tuning npm config in this repo — there is nothing to tune here. The
lockfile is the only lever inside `github-actions`, which supports the ticket's chosen approach.

### 5. Why only some pipelines fail — and the link to PFM-ISSUE-34454

Ordering in the workflows that *do* call `use-npmrc`: it always precedes both the workflow's own `npm ci` and any
composite invoked later in the same job. So `fe-pr-snapshot`, `fe-release`, `fe-pr-close` (→ `artifacts`) and
`fe-cleanup-snapshots` (→ `snapshots`) run the composite's internal `npm ci` **with `~/.npmrc` active** → these are
the failing paths, matching the ticket's two reported failures (a tag pipeline and Cleanup Snapshots).

But five workflows invoke a composite containing an internal `npm ci` with **no `use-npmrc` step anywhere in that
job**: `fe-check-upmerge.yml` (→ `upmerge`), `fe-snapshot.yml` (→ `artifacts`), and `fe-build.yml` /
`fe-code-quality.yml` / `fe-e2e.yml` (→ `run-many`). With no `~/.npmrc`, npm uses its default registry, the 171 npmjs
URLs resolve normally, and the ~69 % absolute JFrog URLs are fetched **anonymously** — which works only because JFrog
anonymous read is currently open (the ticket's own probe: 166 × 200, 5 × 302).

Two consequences for the plan:

- These five workflows are *not* currently broken, so they are poor canaries for this fix. The canary runs must use a
  `use-npmrc` path (tag/release/cleanup-snapshots), as the ticket's testing section already specifies.
- After normalization these jobs resolve **100 %** of packages from JFrog anonymously instead of ~69 %. This does not
  create a new dependency — the ~69 % already existed — but it does increase the blast radius of the anonymous-access
  shutdown tracked in **PFM-ISSUE-34454**, which is the ticket this one blocks. Worth stating explicitly in the design
  as an accepted, understood consequence, and it also *helps* the acceptance criterion "no consumer pipeline resolves
  npm packages outside the `cplace-npm` proxy."

### 6. The PR-guard acceptance criterion has no place to live yet

Every one of the 13 files in `.github/workflows/` declares `on: workflow_call:` and nothing else — verified
individually: `fe-build.yml:3-11`, `fe-check-upmerge.yml:3-11`, `fe-cleanup-snapshots.yml:3-13`,
`fe-code-quality.yml:3-28`, `fe-e2e.yml:3-14`, `fe-install-deps.yml:3-11`, `fe-licenses.yml:3-14`,
`fe-pr-close.yml:3-17`, `fe-pr-snapshot.yml:3-17`, `fe-release.yml:3-13`, `fe-snapshot.yml:3-20`,
`fe-sonar.yml:4-28`, `fe-tag.yml:3-24`. **No `pull_request`, `push`, `schedule` or `workflow_dispatch` trigger exists
in `.github/workflows/`.**

The real triggers live in `.github/workflow-templates/fe/` — e.g. `fe-pr.yml:2-5` (`on: pull_request: branches: ['**']`),
`fe-main.yml:2-6` (`on: push`), `fe-check-upmerge.yml:2-5` (`on: schedule: cron '0 18 * * *'`). Files under
`workflow-templates/` are **never executed by GitHub Actions**; they are template content surfaced in the "New
workflow" UI for consumer repos to copy. Editing a template affects neither this repo's CI nor any consumer that has
already copied it.

Corroborating this: `git grep` for `npm run test`, `npm test`, `check-prettier` or `jest` under `.github/` on
`release/25.2` returns **nothing** — the repo's own jest suite (`package.json` `"test": "jest --config=./jest.config.js"`)
and `prettier --check .` are not run by any workflow. This repo has no self-CI.

So the guard needs a **new** file directly under `.github/workflows/` with an explicit `on: pull_request` trigger — the
first of its kind here. Two distinct scopes should not be conflated in the design:

- **Guarding this repo's own lockfile** (what the acceptance criterion asks for) → new `on: pull_request` workflow in
  `.github/workflows/`. This is also the natural home for finally running `npm test` / `prettier --check`.
- **Guarding consumer repos' lockfiles** (not asked for by this ticket) → would mean a step inside a reusable workflow
  such as `fe-install-deps.yml`, and/or a new template. Out of scope unless explicitly widened.

### 7. The upmerge is a notifier — the "carry it upward" assumption needs care

`.github/workflows/fe-check-upmerge.yml` (job steps 14-40): checkout `fetch-depth: 0` → `setup-node` (18.19.1) →
`actions/cache` for `node_modules` keyed on `hashFiles('**/package-lock.json')` (line 32 — the **only**
`package-lock.json` reference in the entire upmerge path, and purely a cache key) → the `upmerge` composite (34-39)
with `SLACK_TOKEN_UPMERGE`, `GIT_USER_EMAIL`, `GIT_USER`.

`tools/scripts/upmerge/upmerge.ts`:

- `checkUpmergeAndNotifiy()` (12-17): sets git identity from env, calls `isUpmergeNeeded()`, then `postToSlack()`.
- `isUpmergeNeeded()` (19-38) line 22: `execSync('cplace-cli flow --upmerge --release 5.17 --no-push --show-files')`
  — **`--no-push`, i.e. a dry run**. It greps stdout for `"have been merged"`, derives the source release from the
  preceding `Merging … release X into …` line, and returns
  `Please upmerge from release ${releaseThatNeedsUpmerge} in repo ${repo}`.
- On a thrown `execSync` (merge conflict or CLI error) it catches and posts an error plus a link to the failed run as a
  Slack thread reply (25-30). No file is inspected or resolved by this repo's code.
- `postToSlack()` (40-61) posts to `#frontend-upmerge` via `@slack/web-api`.

So: **no branch chain is encoded in this repo**, no merge is ever pushed by CI, and there is **no per-file conflict
strategy and no `.gitattributes`** (confirmed absent, repo-wide) — hence no merge driver for `package-lock.json`.
The hard-coded `--release 5.17` looks stale and is worth a glance during implementation. The chain-like branch
sequence in `tools/scripts/upmerge/upmerge.test.ts:7-18` is mocked `cplace-cli` output, not configuration.

The ticket's mechanical conflict rule (`git checkout --ours -- package-lock.json`, then re-run the idempotent
normalizer, never `--theirs`, never hand-edit) is therefore a **human runbook instruction**, not something CI can
enforce. Since the invariant check is proven to catch exactly the drift a bad merge introduces (§2), the design should
make that check runnable on demand so a human resolving a conflict can verify their resolution.

### 8. Branch topology — the rollout assumption that does not hold

Measured with `git merge-base --is-ancestor` on freshly fetched refs:

| edge | state |
| --- | --- |
| `25.2` → `25.3` | NOT merged — 2 commits of 25.2 not in 25.3 |
| `25.3` → `25.4` | MERGED |
| `25.4` → `26.1` | MERGED |
| `26.1` → `26.2` | MERGED |
| `26.2` → `26.3` | **NOT merged — 17 commits of 26.2 not in 26.3** |
| `26.3` → `master` | NOT merged — 1 commit of 26.3 not in master |

Containment in `master`: `25.2` +5, `25.3` +8, `25.4` +12, `26.1` +16, `26.2` +17 commits ahead — **none of the release
branches is contained in `master`**.

The cause is visible in the history: `master` received the Node 24 migration via its **own** PR,
`914a755 up master: PFM-TASK-7777 - github-actions: Upgrade GitHub Actions to Support Node.js 24 (#132)`, separate
from the `#130` PR that went into the release chain. And `release/26.3` (`b5869c7 Branch off: Release 26.3`) has parent
`53ea313` = `master`'s tip, with `merge-base(26.2, 26.3) = e164c022 "Branch off: Release 26.2"`. `master` **is** an
ancestor of `26.3`.

So the effective topology is:

```
25.2 → 25.3 → 25.4 → 26.1 → 26.2        (linear upmerge chain)
master  ─────────────────────→ 26.3     (26.3 branched off master; master fed by separate PRs)
```

Despite the divergent history, all of `26.1`, `26.2`, `26.3`, `master` carry the **same lockfile** (`d06efe2cba`) and
all seven branches have `.github/actions/use-npmrc/action.yml` — so the affected-branch matrix in the ticket is
correct even though the ancestry is not linear.

**Implication for the plan**: the ticket states "add the normalizer plus the check at `release/25.2` so the upmerge
carries them upward to every branch." That holds for `25.3 → 25.4 → 26.1 → 26.2`. It does **not** hold for `master` or
`release/26.3`, which are not downstream of `26.2`. Those two need the normalizer and check delivered by their own PRs
— which the per-branch PR plan already provides, but the design must say so explicitly rather than relying on the
upmerge. This also means "once all seven branches are normalized the 171 lines are identical across branches again"
is true, while "the next scheduled upmerge sees no one-sided diff" only describes the 25.2→26.2 chain.

### 9. Repo conventions for the new scripts

- **Layout**: `tools/scripts/<feature>/` with a thin `main.ts` entrypoint, a logic module, a co-located
  `<name>.test.ts`, and optionally a shared `test-data.ts`. Existing features: `artifacts/`, `run-many/`, `upmerge/`.
  All TypeScript; no `.js` under `tools/`.
- **Invocation**: never via an npm script — always `npx ts-node "$GITHUB_ACTION_PATH/../../../tools/scripts/<f>/main.ts"`
  from a composite action. `package.json` exposes only `test`, `check-prettier`, `write-prettier`.
- **Module system**: CommonJS (no `"type"` field; `tsconfig.json` `module: commonjs`, `target: es5`, `types: [node, jest]`,
  **no `strict`**). Node `18.19.1` per `.nvmrc` and `.tool-versions` — note this is the *repo tooling* version and is
  unrelated to the Node 24 *runner* migration.
- **Tests**: `jest.config.js` uses `ts-jest`; files are co-located and named `*.test.ts` (never `.spec.ts`).
  `babel.config.js` exists but is vestigial — the jest transform is `ts-jest`. Existing file tests **mock `fs` with
  `jest.spyOn(fs, 'readFileSync' | 'writeFileSync' | 'existsSync')`** and feed inline JSON *string* fixtures from
  `test-data.ts`; no tmp dirs, no real disk I/O anywhere in `tools/`.
- **Model to copy for JSON read/mutate/write**: `tools/scripts/artifacts/nx-project.ts:235-271`
  (`setVersionOrGeneratePackageJsonInDist`) reads a `package.json`, mutates fields, and writes it back via
  `getPrettyPackageJson()` = `JSON.stringify(this.packageJsonContent, null, 2)`. For a fail-loudly validator, follow
  `Utils.parseScopeFromPackageJson` (`tools/scripts/artifacts/utils.ts:309-328`), which `process.exit(1)`s on invalid
  state.
- **Formatting**: `.prettierrc.json` is `{ "singleQuote": true }`; `.prettierignore` contains only `node_modules` and
  `.idea` — it does **not** exclude `package-lock.json`, and `check-prettier` runs `prettier --check .` over
  everything. No ESLint config exists anywhere. Since prettier is not run in CI (§6), this is latent rather than
  active, but adding `package-lock.json` to `.prettierignore` is cheap insurance — especially if the new
  `on: pull_request` workflow starts running `check-prettier`.
- **Two distinct JFrog paths are in play** and must not be confused: the install **proxy**
  `https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/` (what this fix writes into `resolved`) versus the publish
  **target** `https://cplace.jfrog.io/artifactory/cplace-npm-local` (the `JFROG_URL` default in
  `tools/scripts/artifacts/configuration.ts:2`, also asserted in `nx-project.test.ts:31,34`).

### 10. Reintroduction risk

`.github/dependabot.yml` on `release/25.2` declares **only** `package-ecosystem: "github-actions"` — six entries: the
default branch plus `target-branch:` for `release/25.2`, `25.3`, `25.4`, `26.1`, `26.2` (comment: "Active release
branches (release/25.2 → release/26.2)"). **Zero `npm` ecosystem entries**, confirming the ticket's statement that
npm Dependabot is not enabled and the realistic reintroduction path is a developer running `npm install` with an
npmjs-default `.npmrc`. Note `release/26.3` is not covered by any dependabot `target-branch` either — a small
pre-existing gap, out of scope here but worth mentioning to whoever owns that file.

## Code References

- `.github/actions/artifacts/action.yml:8` — `cd "$GITHUB_ACTION_PATH/../../.." && pwd && npm ci` (unconditional)
- `.github/actions/artifacts/action.yml:10` — `npx ts-node .../tools/scripts/artifacts/main.ts`
- `.github/actions/snapshots/action.yml:8,10` — same `npm ci`, then `main-snapshots.ts`
- `.github/actions/upmerge/action.yml:8,10,12` — `npm ci`, `npm install -g @cplace/cli`, `upmerge/main.ts`
- `.github/actions/run-many/action.yml:22,24` — `npm ci`, then `run-many.ts` with argv
- `.github/actions/use-npmrc/action.yml:10-14` — `echo "$DOT_NPMRC" > ~/.npmrc`; the regression's mechanism
- `.github/workflows/fe-install-deps.yml:38`, `fe-cleanup-snapshots.yml:39`, `fe-licenses.yml:41`, `fe-pr-close.yml:41`, `fe-pr-snapshot.yml:43`, `fe-release.yml:42`, `fe-sonar.yml:61` — the seven `use-npmrc` call sites
- `.github/workflows/fe-check-upmerge.yml:32` — `hashFiles('**/package-lock.json')`, the only lockfile reference in the upmerge path
- `.github/workflows/fe-check-upmerge.yml:34-39` — invokes the `upmerge` composite
- `.github/workflow-templates/fe/fe-pr.yml:2-5` — the only `pull_request` trigger in the repo, in a **non-executing** template
- `tools/scripts/upmerge/upmerge.ts:19-38` — `isUpmergeNeeded()`; line 22 is the `--no-push` dry run with hard-coded `--release 5.17`
- `tools/scripts/upmerge/upmerge.ts:40-61` — `postToSlack()` → `#frontend-upmerge`
- `tools/scripts/upmerge/upmerge.test.ts:7-18` — mocked chain output (not configuration)
- `tools/scripts/artifacts/nx-project.ts:235-271` — the JSON read/mutate/write pattern to model the normalizer on
- `tools/scripts/artifacts/nx-project.ts:42-61` — paired `existsSync` + `readFileSync` + `JSON.parse` idiom
- `tools/scripts/artifacts/utils.ts:309-328` — fail-loudly validator pattern (`process.exit(1)`)
- `tools/scripts/artifacts/nx-project.test.ts:1-36` — `jest.spyOn(fs, …)` + inline fixture test pattern
- `tools/scripts/artifacts/configuration.ts:2` — `JFROG_URL` default `…/artifactory/cplace-npm-local` (publish target, *not* the proxy)
- `tools/scripts/artifacts/jfrog-credentials.ts:6-13` — `JFROG_URL`/`JFROG_USER`/`JFROG_BASE64_TOKEN` from `process.env`, not `.npmrc`
- `.github/dependabot.yml:4,18-81` — `github-actions` ecosystem only; release branches 25.2 → 26.2
- `package.json` — `test`, `check-prettier`, `write-prettier`; CommonJS; no `engines`
- `jest.config.js`, `tsconfig.json`, `.prettierrc.json`, `.prettierignore` — tooling baseline (§9)
- `package-lock.json` — the artifact under change; 171 `resolved` prefixes per branch

## Architecture Insights

- **This repo is a library of reusable workflows and composite actions, with no CI of its own.** Everything under
  `.github/workflows/` is `workflow_call`-only; triggers live in consumer repos (seeded from
  `.github/workflow-templates/fe/`). Any self-validation — this ticket's PR guard, and arguably the existing jest and
  prettier scripts — is greenfield here.
- **Branch-pinned self-reference.** Composites and workflows reference each other by branch
  (`collaborationFactory/github-actions/.github/actions/upmerge@release/25.2`), which is why release branches are
  long-lived and why a fix must be applied per branch rather than once at a tip. The Node 24 design doc already
  recorded the need to update these internal refs after each upmerge.
- **The runtime `npm ci` inside a composite action is the structural fault.** Because the action installs its own
  dependencies on the consumer's runner, it inherits the consumer's npm environment (`~/.npmrc`) — coupling this
  repo's lockfile to every consumer's registry configuration. The lockfile normalization removes the symptom by
  making all URLs absolute-and-correct; the architectural fix (pre-bundling `tools/scripts/*`, or shipping them as a
  published package / container action) is the tracked follow-up.
- **Secret masking as a diagnosability hazard.** The 404 URL's prefix is `JFROG_URL`, so logs show `***` and the error
  is far harder to read than it should be. Any error surfaced by the new check or guard should print the *offending
  lockfile path and package name* rather than a reconstructed URL, so the message survives masking.
- **Invariants over review discipline.** The ticket's framing — guarantee correctness with a machine-checked
  invariant rather than careful reviewing — is well matched to a lockfile, where the risk is a silent version or
  integrity change buried in a 262 KB diff. The prototype confirms the invariant is both satisfiable and violation-detecting.

## Historical Context (from specs/)

`specs/` contains exactly one topic, identical on `release/25.2` and `release/26.2`:
`specs/2026-06-05_node24-workflow-migration/` — `research.md`, `design.md`, `plan.md`, `sha-pins.md`, `validation-log.md`
(topic: "Node 24 migration of all 13 reusable FE workflows (PFM-TASK-7777)", dated 2026-06-05).

- `specs/2026-06-05_node24-workflow-migration/design.md` — the migration that **caused** this bug: replaces four
  unmaintained third-party actions, including `bduff9/use-npmrc` → the in-repo `.github/actions/use-npmrc` composite.
  Documents the upmerge chain as `25.3 → 25.4 → 26.1 → 26.2 → master` and the need to update internal composite refs
  after each upmerge. Note this recorded chain **includes `master` as downstream of `26.2` and omits `26.3`**, which
  §8 shows does not match the actual git ancestry — `master` was fed by a separate PR (`#132`) and `26.3` branched off
  `master`. `design.md:139` explicitly reasoned that consumer impact was unchanged because "`DOT_NPMRC` flows into the
  new composite exactly as it did into `bduff9/use-npmrc`" — true of the *input*, but not of the *write target*
  (`~/.npmrc` vs `<workspace>/.npmrc`), which is the gap this ticket closes.
- `specs/2026-06-05_node24-workflow-migration/plan.md:220-221` — the verbatim `echo "$DOT_NPMRC" > ~/.npmrc` step as
  planned. Scoped the five upmerge PRs (25.3 → master) as follow-on work in "Migration Notes", not executed in that plan.
- `specs/2026-06-05_node24-workflow-migration/research.md:92,198-202` — every call site passes exactly one input
  (`dot-npmrc`); `fe-snapshot.yml` does **not** use it (consistent with §5, where `fe-snapshot` is one of the five
  workflows running `npm ci` without `~/.npmrc`).
- `specs/2026-06-05_node24-workflow-migration/validation-log.md:78-94` — validation was thorough on the Node-24 runtime
  question (actionlint + 7/13 live runs) but scoped to GHA-runtime deprecations, so an npm *resolution* regression was
  outside what it looked for. Its one "side finding" (line 78) concerns `kentaro-m/auto-assign-action` in cplace-fe and
  is **unrelated** to this bug — checked explicitly. Verdict line 94 confirms that migration's PR went
  `feature → release/25.2`, the same entry point this ticket prescribes.

**No prior spec covers lockfile / registry-URL normalization** — a targeted grep for `package-lock`, `registry.npmjs`,
`resolved.*npmjs`, `npm ci` inside the Node 24 topic returns zero matches. This research document is the first on the topic.

## Related Research

- `specs/2026-06-05_node24-workflow-migration/` (research / design / plan / sha-pins / validation-log) — the direct
  upstream cause; see Historical Context.
- PFM-ISSUE-34454 (linked, blocked by this ticket) — `DOT_NPMRC` standardization across FE consumer repos and the
  JFrog anonymous-access shutdown. §5 shows this fix increases those five workflows' reliance on anonymous JFrog reads
  from ~69 % to 100 % of packages, so the two tickets should be sequenced with that in mind.
- PFM-ISSUE-33179 (`83ea625`) and PFM-TASK-7528 (`916fe05`) — recent workflow fixes in the same release chain; no
  spec documents exist for either.

## Open Questions

1. **Where does the new `on: pull_request` workflow belong, and how much should it do?** The guard needs the repo's
   first self-CI workflow (§6). Decide whether it only greps the lockfile, or also finally runs `npm test` and
   `check-prettier` — and whether it must be added to all seven branches (a `pull_request` workflow only runs from the
   version on the PR's *base* branch, so per-branch delivery is required for the guard to protect every branch).
2. **Should the guard also protect consumer repos?** Adding the check to a reusable workflow such as
   `fe-install-deps.yml` would catch npmjs URLs in *consumers'* lockfiles. Not requested by this ticket; needs an
   explicit decision, since it could break consumer pipelines that are currently green.
3. **`master` and `release/26.3` delivery.** Confirmed not downstream of `26.2` (§8), so they need their own
   normalizer + check commits rather than inheriting them via upmerge. Confirm the intended PR order for these two
   relative to the linear chain — and whether `26.3` should be treated as branching from `master` (matching git) or
   from `26.2` (matching the ticket's table).
4. **Does `prettier --check .` currently pass on `package-lock.json`?** Unverified — `node_modules` is absent from the
   working tree, so prettier could not be run. Low risk today because prettier is not in CI (§6), but it becomes
   relevant the moment the new PR workflow runs `check-prettier`. Cheap mitigation: add `package-lock.json` to
   `.prettierignore`.
5. **Is the hard-coded `--release 5.17` in `tools/scripts/upmerge/upmerge.ts:22` still correct?** It looks stale next
   to a 25.x/26.x branch set. Out of scope for this ticket, but it is in the file family being touched and affects
   whether the upmerge notification the ticket relies on actually fires.
6. **Proxy availability was not re-probed here.** The ticket's probe (166 × 200, 5 × 302 for the 171 tarballs through
   `cplace-npm`) is taken as given; no network requests were made during this research. Worth one re-probe at
   implementation time, since a curated/Xray policy change would invalidate the whole approach.
7. **Post-fix canary selection.** Per §5 the five `npm ci`-without-`~/.npmrc` workflows cannot demonstrate the fix.
   Confirm the three canary runs (one per lockfile state: 25.2 | 25.4 | 26.2) all use a `use-npmrc` path such as
   tag/release/cleanup-snapshots.
8. **Assignee is unset on the ticket.** Recorded above as Christian Kaltenbach (creator), marked inferred — worth
   filling in on the cplace page.
