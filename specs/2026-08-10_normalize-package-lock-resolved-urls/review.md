# Code Review: PFM-ISSUE-34453 — Normalize `package-lock.json` resolved URLs onto the JFrog npm proxy

## Iteration 1 — 2026-08-12

*Reviewed `origin/release/25.2...HEAD` (18 files, +4644/−173) against `plan.md`. Base is `release/25.2`, the PR's
actual base — the default `master` would have carried 23 unrelated files, since `master` is not downstream of the
release chain (research §8). Agents: plan-conformance, correctness, craft, test, security. `best-practices` did not
run (no `CLAUDE.md`, `.claude/rules/` or `best-practices/MAP.md` in the repo). 15 findings kept, 0 dropped in
verification, 0 merged. Four were fixed during the review and are marked resolved. The security finding arrived
`inferred` and was **upgraded** rather than downgraded, because it reproduced.*

### [1.1] 🚨 The advisory scan reproduces the `startswith($proxy)` bug already fixed elsewhere in this PR

- [x] Resolved — `4a160a7`

**File(s):**
- [warn-foreign-registry.sh:49](/tools/scripts/lockfile/warn-foreign-registry.sh)
- [lib.sh:44](/tools/scripts/lockfile/lib.sh#L44)

`warn-foreign-registry.sh` carried its own `startswith($proxy)` predicate — the exact bug `lib.sh:44-49` documents as
already found and fixed once in `count_foreign_entries`. An entry on the correct host with a stray path segment
(`.../cplace-npm/extra/beta/-/beta-2.0.0.tgz`) satisfies `startswith`, so the advisory stayed **silent** while
`check-lockfile.sh --prefix-only` correctly failed on the same input. This mattered more here than anywhere else:
these warnings are the inventory that decides when the `replace-registry-host=never` mitigation may be removed, so the
false negative could green-light removing it while lockfiles are still broken. Now sources `lib.sh` and uses the shared
`JQ_REGISTRY_ENTRIES` predicate, with three tests including one asserting the advisory and the guard agree.

### [1.2] 🚨 Fingerprint temp files leak on the fail-closed paths in `assert_graph_invariant`

- [x] Resolved — moved both `mktemp` calls into `main()` beside `baseline_file` and widened the existing EXIT trap to cover all three, so the `|| die` paths inside `assert_graph_invariant` no longer leak; the function now takes the two paths as arguments

**File(s):**
- [check-lockfile.sh:82](/tools/scripts/lockfile/check-lockfile.sh#L82)

`fp_base`/`fp_cand` are created with `mktemp` and removed only by the explicit `rm -f` at the end of the function, but
`die()` calls `exit 1`, so all three `|| die` guards between them bypass that cleanup — including the `fingerprint_of`
failure path the function's own comment calls out as the one that "must fail CLOSED", which a bats test exercises on
every run. `main()` registers an `EXIT` trap for `baseline_file` only, while `normalize-lockfile.sh:64` does trap its
equivalent `fp_before`/`fp_after`, so this is also an inconsistency with the pattern used elsewhere in the same change.

### [1.3] 🙏 An uppercase URL scheme bypasses the PR guard entirely

- [x] Resolved — made the scheme case-insensitive in both spellings (`test("^https?://"; "i")` in `JQ_REGISTRY_ENTRIES`, `^(?i:https?)://` in `RESOLVED_URL_RE`), keeping `\.tgz` case-sensitive; two bats cases now assert the guard rejects a `HTTPS://` entry and the normalizer rewrites it onto the proxy

**File(s):**
- [lib.sh:59](/tools/scripts/lockfile/lib.sh#L59)
- [check-lockfile.sh:131](/tools/scripts/lockfile/check-lockfile.sh#L131)
- [pr-checks.yml:40](/.github/workflows/pr-checks.yml#L40)

`JQ_REGISTRY_ENTRIES` selects entries with `test("^https?://")`, and jq's `test()` is case-sensitive without an `"i"`
flag, while npm treats the URI scheme case-insensitively. Reproduced — a lockfile whose only entry resolves to
`HTTPS://attacker.example.com/evil/-/evil-1.0.0.tgz` yields `OK: … resolves entirely via the cplace npm proxy`,
exit 0. `--prefix-only` is the sole automated guard on every pull request and deliberately skips `assert_resolvable`,
so nothing else in that path validates the scheme either; under the new `replace-registry-host=never` mitigation npm
would fetch that URL verbatim. The repository is public and the workflow runs on `pull_request` for any branch.

### [1.4] 🙏 The guard's invocation changed from `--baseline base.sha` to `--prefix-only`, unrecorded in the plan

- [x] Resolved — `plan.md`'s Phase 4 block now shows the shipped `--prefix-only` workflow with a note naming `604f95e` and its four consequences; Key Discovery 6, `plan.md`'s fetch-depth reference and `design.md:258` are struck through and annotated as superseded; Phase 5's CI evidence is kept verbatim but labelled as predating the switch

**File(s):**
- [pr-checks.yml:40](/.github/workflows/pr-checks.yml#L40)
- [pr-checks.yml:24](/.github/workflows/pr-checks.yml#L24)

`plan.md:846` still specifies `--baseline "${{ github.event.pull_request.base.sha }}"` with `fetch-depth: 0` at
`plan.md:840`, and Key Discovery 6 makes `base.sha` a load-bearing decision — yet Phase 4 is checked off throughout.
Phase 5's recorded CI evidence quotes `baseline: 967168…` and `PASS: dependency graph identical to baseline`, output
the current workflow cannot produce. `design.md:528` was updated to `--prefix-only`, but `design.md:259` still requires
`fetch-depth: 0` and `plan.md` was not updated at all. This should be reconciled **before** the tooling is replicated
to six more branches.

### [1.5] 🙏 The `:2:`/`:3:` merge-stage baseline the runbook depends on has no test

- [x] Resolved — added a bats case that drives a real merge conflict on `package-lock.json`, resolves it the way Flow 2 documents (`--ours`, re-normalize) and asserts `--baseline :2:` resolves to `:2:package-lock.json` and passes graph invariance

**File(s):**
- [check-lockfile.bats](/tools/scripts/lockfile/check-lockfile.bats)

`plan.md:1524` commits to bats coverage of "baseline resolution from a git ref, from `:2:`-style merge stages, and from
two explicit file paths". The suite has the git-ref and two-file cases; a grep for `:2:`/`:3:` returns **0**. The
untested branch is `resolve_baseline`'s `spec="${spec}${lockfile_path}"` arm — the specific code path the documented
Flow 2 conflict-resolution runbook depends on, and the case that runs when someone is mid-upmerge and least able to
debug it.

### [1.6] 🙏 The advisory script re-declared the proxy constant instead of sourcing `lib.sh`

- [x] Resolved — `4a160a7`

**File(s):**
- [warn-foreign-registry.sh:28](/tools/scripts/lockfile/warn-foreign-registry.sh)
- [lib.sh:20](/tools/scripts/lockfile/lib.sh#L20)

`warn-foreign-registry.sh` did not source `lib.sh` — unlike both sibling scripts — and re-declared the identical proxy
URL as `PROXY_PREFIX`, directly against `lib.sh`'s own comment that the constant is defined once so the tools "can
never drift apart". It is invoked from the same checked-out tree, so sourcing was available. Fixed together with
[1.1]; sourcing is guarded on both sides so an unreachable `lib.sh` still exits 0 silently, preserving the advisory
contract.

### [1.7] 🙏 Both spec documents forbade the `use-npmrc` change that Phase 4b made

- [x] Resolved — `2be5ef6`

**File(s):**
- [plan.md:116](/specs/2026-08-10_normalize-package-lock-resolved-urls/plan.md#L116)
- [design.md:540](/specs/2026-08-10_normalize-package-lock-resolved-urls/design.md#L540)

`plan.md`'s *What We're NOT Doing* listed "Modifying `use-npmrc`" and `design.md`'s Integration Points stated
"`use-npmrc/action.yml` is **not modified** — that is PFM-ISSUE-34454's territory", while Phase 4b / Dimension 9 in
the same two documents modify exactly that. A reader hitting the out-of-scope list first would conclude the change was
unauthorized. Both are now struck through and annotated with what superseded them and why; the still-true half — the
four composite actions really are unmodified — is preserved rather than deleted.

### [1.8] 🙏 The plan's record of Phases 1–4 verification was lost

- [x] Resolved — `2be5ef6`

**File(s):**
- [plan.md](/specs/2026-08-10_normalize-package-lock-resolved-urls/plan.md)

Phases 1–3 carried **zero** ticked success criteria and Phase 4 carried one, while Phases 5, 6, 4b and 6b were fully
ticked — despite all of them having been executed and checkpointed. `git log -S` on Phase 1's probe criterion returns
no commit, confirming the marks were never persisted rather than later removed; the most plausible cause is the
mid-session reformat that rewrote `plan.md`. Since the plan is the audit trail for what was actually verified, this
made four completed phases indistinguishable from skipped ones. Restored with the evidence each was verified against;
the four criteria that are reviewer judgement rather than machine-checkable are now labelled as such instead of ticked.

### [1.9] 💡 The new composite step spells `$GITHUB_ACTION_PATH` differently from all four siblings

- [x] Resolved — the step now uses the bash variable `$GITHUB_ACTION_PATH`, matching all four siblings; it is also the form quoted at runtime rather than interpolated into the command line, which is what the step's own comment worries about

**File(s):**
- [use-npmrc/action.yml:41](/.github/actions/use-npmrc/action.yml#L41)

`artifacts`, `snapshots`, `upmerge` and `run-many` all build the same "escape the action directory to repo root" path
with the bash variable `$GITHUB_ACTION_PATH`. The new step uses the Actions expression `${{ github.action_path }}`
instead, introducing a second spelling of the identical value in the same directory for no stated reason.

### [1.10] 💡 The README's "The two scripts" section contradicts itself

- [x] Resolved — section retitled "The scripts", "Both default" corrected to "All three default", and the invocation claim split: the normalizer and the check have no npm script and no wrapper, while the advisory is named as wrapped and run by `use-npmrc`

**File(s):**
- [README.md:31](/tools/scripts/lockfile/README.md#L31)
- [README.md:40](/tools/scripts/lockfile/README.md#L40)

The heading says "two scripts" over a table that now lists four rows, and the sentence below states "there is no npm
script and no composite action wrapper" — one line under a row whose own text reads "Run by `use-npmrc`", which is
exactly a composite action wrapper. A reader consulting the README to learn how these scripts are invoked is told two
incompatible things in the same paragraph.

### [1.11] 💡 The `missing lockfileVersion` arm is untested

- [x] Resolved — both suites now feed a lockfile omitting the key and assert exit 1 plus the arm's own "is it a package-lock.json?" message, which distinguishes it from the unsupported-version sibling

**File(s):**
- [lib.sh:111](/tools/scripts/lockfile/lib.sh#L111)

`assert_supported_lockfile` has a three-way `case`; both suites exercise only `{"lockfileVersion":1}`, the catch-all
arm. No test constructs a lockfile omitting the key entirely, which is what the `missing` arm and its distinct message
("is it a package-lock.json?") exist for. Low risk — a `die` either way — but it is added branching with no assertion
distinguishing it from its sibling.

### [1.12] ❓ `--prefix-only` skips `assert_resolvable`, so a `link:`/`git+ssh:` entry now passes CI silently

- [x] Resolved — the loosening was sanctioned in `604f95e`, which moved `assert_resolvable` behind the baseline path so the guard would stop hard-failing on the npm-workspace and `link:` entries `--prefix-only` exists to allow; `design.md`'s Dimension 2 implication is now struck through and annotated to say the hard failure holds on the baseline path and in the normalizer but not in CI, and the README's "no usable tarball URL" section carries the same caveat

**File(s):**
- [check-lockfile.sh:212](/tools/scripts/lockfile/check-lockfile.sh#L212)
- [lib.sh:59](/tools/scripts/lockfile/lib.sh#L59)

`design.md:261` states that a future `link:`/`file:`/`git+ssh:` dependency "requires a deliberate, visible loosening
rather than a silent pass". In `--prefix-only` mode `assert_resolvable` is deliberately not run and
`JQ_REGISTRY_ENTRIES` skips non-http values, so precisely that class now passes the only assertion CI makes. This was
a deliberate change — made so the guard would stop blocking npm workspaces — and it is covered by a test and code
comments, but neither `design.md` nor `plan.md` records it. Was the loosening sanctioned, or should Dimension 2's
implication be amended to match?

### [1.13] ℹ️ A third jq-embedding style now sits alongside the established one

- [x] Resolved — both programs in `assert_prefix_exactness` are now single-quoted fragments concatenated around `JQ_REGISTRY_ENTRIES`, so no jq `$var` sits inside a double-quoted bash string and the `\$tarball_re` / `\"\"` escaping is gone; the `--arg proxy` the `distinct` program never referenced was dropped at the same time

**File(s):**
- [check-lockfile.sh:131](/tools/scripts/lockfile/check-lockfile.sh#L131)
- [lib.sh:54](/tools/scripts/lockfile/lib.sh#L54)

To share the `JQ_REGISTRY_ENTRIES` predicate, `assert_prefix_exactness` and `count_foreign_entries` build their jq
program as a double-quoted bash string, which forces every jq `$var` in the spliced text to be backslash-escaped
(`\$tarball_re`, `\"\"`). Every other jq call in these files — and `fingerprint.jq` via `-f` — uses a single-quoted
literal with `--arg`. The sharing is what fixed [1.1]'s bug class, so the trade may well be worth it; noting only that
the more fragile style now lives next to the plainer one.

### [1.14] ℹ️ The tarball regex was tightened to require `.tgz`, diverging from Key Discovery 4

- [x] Resolved — `plan.md`'s Phase 1 constant and Key Discovery 4 are struck through and annotated with the shipped form `'(?<t>(?:@[^/]+/)?[^/]+/-/.+\.tgz)$'` and both changes that produced it: `\.tgz` required in review, then the tail widened on 2026-08-13 after the canary showed JFrog serves tarball paths containing slashes. Key Discovery 4's premise is corrected rather than deleted — the 542-entry measurement was right, but it was not a sample of what the tooling meets on consumer lockfiles

**File(s):**
- [lib.sh:35](/tools/scripts/lockfile/lib.sh#L35)

`plan.md:249` specifies `'(?<t>(?:@[^/]+/)?[^/]+/-/[^/]+)$'` and Key Discovery 4 states that regex is the one measured
against all 542 entries. The shipped `TARBALL_PATH_RE` and `RESOLVED_URL_RE` additionally require `\.tgz`, turning a
non-`.tgz` tarball URL into a hard `assert_resolvable` failure. The change was made in response to review, is
behaviour-neutral on real data (0 of 542 entries fail it, fingerprint unchanged) and is covered by a test — but
`plan.md` mentions `.tgz` nowhere, so the phase spec and the code disagree.

### [1.15] ℹ️ The mitigation widens the trust boundary for every consumer until 34454 lands

- [x] Resolved — no change: the widened boundary is accepted and documented in `design.md:484-486`, the README and the action's own comment, its removal is owned by PFM-ISSUE-34454, and the advisory warnings are the criteria that trigger it

**File(s):**
- [use-npmrc/action.yml:25](/.github/actions/use-npmrc/action.yml#L25)

`replace-registry-host=never` means any `resolved` entry still pointing at `registry.npmjs.org` — in this repo or any
consumer's — is fetched directly from public npm rather than through the proxy, bypassing whatever Xray/curation
policy the proxy enforces. This is consumed by seven reusable workflows across ~41 downstream repositories. Recorded
as information rather than an issue because it is explicitly named and accepted in `design.md:485-486` and paired with
the advisory inventory that governs its removal — but it is the single largest change in blast radius in this PR.
