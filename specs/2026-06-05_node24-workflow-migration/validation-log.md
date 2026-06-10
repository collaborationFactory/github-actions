# Validation Log — Node 24 Workflow Migration (PFM-TASK-7777)

**Acceptance gate:** every exercised workflow finishes with `conclusion: success` **and** produces
**zero GitHub-Actions-runtime deprecation warnings** (Node.js 16/20 action runtime) in logs and run
annotations, across all 13 reusable `fe-*.yml` workflows.

Node 24 runtime forced on the test branch via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` (all 13
files), previewing GitHub's default switch on **2026-06-16**.

> **Grep methodology note:** the raw acceptance grep `deprecat|node ?20` produces false positives.
> Exclude: `npm WARN deprecated <pkg>` (npm package deprecations), `* [new branch|tag]` / `-> origin/`
> (git fetch noise), AG-Grid API deprecations and `Buffer() DEP0005` (application/dependency code
> deprecations). The criterion is the **GitHub Actions runtime-version** deprecation only — best read
> from **run annotations**.

---

## Phase A — Static Pre-Flight ✅ (2026-06-08)

- **actionlint Pre vs Post** (`5c4ba52` → `eb7eb39`): 24 → 13 findings, **0 new, 11 removed**. All 11
  removed were `the runner of "actions/setup-node@v…" … too old [action]` (the node-runtime
  deprecations). → lint-neutral **and** statically resolves the deprecations.
- **SHA pins:** 7/7 resolve to the tags documented in `sha-pins.md`.
- **Test-branch integrity (github-actions):** only expected TEST-ONLY changes; FORCE 13/13.
- **Step 0:** `origin/test/…` pushed to `998579f` (sonar-guard).
- **`github.ref_name` replacement (static):** feature branch `fe-release.yml:54` `TAG: ${{ github.ref_name }}`
  — in the on_tag_pushed context = tag name, equivalent to `dawidd6/action-get-tag`.

**Gate A: ✅ passed.**

---

## Incident (2026-06-08) — resolved, no release cut

Two TEST-ONLY commits had been pushed directly onto `origin/release/25.2`, triggering "Frontend
Release CI" (run `27021063948`). Investigation: the `tag` job ended with *"no new Minor/Patch version
is needed"* → **no new `version/25.2.x` tag** (highest stays `25.2.67`) → no `fe-release` → **no
release/artifact published** (the version-bump guard held). Remediated by reverts on `release/25.2`
(file state clean; history keeps the noise — accepted). Root cause: test setup shared the
`release/25.2` tip instead of a separate `test/*` branch. **Rule:** never push to `release/25.2`;
validate via PR only.

---

## Phase B — Live + static validation results

### Live under Node 24 (FORCE confirmed in each run) — all clean, 0 GHA-runtime deprecations

| Workflow | Source run | Result |
|----------|-----------|--------|
| fe-install-deps | `27021063948` (push) + `27187274908` (PR) | ✅ success, clean |
| fe-build | `27021063948` + `27187274908` | ✅ success, clean |
| fe-e2e | `27021063948` + `27187274908` | ✅ success, clean |
| fe-tag | `27021063948` | ✅ success ("no new version needed"), clean |
| **use-npmrc** composite (replaces `bduff9/use-npmrc`) | `27021063948` install-deps | ✅ executed, clean |
| fe-licenses | `27187274927` (PR) | ✅ success, clean |
| **fe-code-quality → sonarqube-scan v8** | `27187274908` SonarCloud job | ✅ success; v8 SHA `7006c449…` executed; clean |
| **fe-pr-snapshot → github-script v9** | `27187274989` + `27151050096` | ✅ success; v9 SHA `3a2844b…` executed; clean |

**github-script v9 upsert (replaces `thollander`) validated:** PR #2718 comment `id=4651018089`
created `2026-06-08 16:16`, **updated** `2026-06-09 06:12` → same comment edited, **exactly 1** comment
with marker `<!-- published-artifacts -->` (no duplicate). Both content variants observed:
- empty: `No snapshots of projects have been published …`
- published: `:tada: Snapshots … @cplace-next/cf-platform@0.0.0-test-…-2718` (safe `0.0.0-*` PR snapshot).

→ **7/13 workflows live-validated** under Node 24, all clean.

### Static-verified (same SHA-pinned, node24-capable action set as the 7 above; actionlint: no node20 runner)

fe-pr-close · fe-sonar · fe-cleanup-snapshots · fe-check-upmerge · fe-snapshot · fe-release
(decision: no live release-pipeline runs — `release/*` must not be touched). `github.ref_name`
replacement in fe-release additionally checked statically (see Phase A).

→ **6/13 static-verified.**

---

## ⚠️ Side finding (out of PFM-TASK-7777 scope)

cplace-fe's own **"Auto Assign"** workflow uses `kentaro-m/auto-assign-action@v1.1.2`, which still runs
on **Node.js 20** → run annotation warns it will be forced to Node 24 on 2026-06-16. This is **not** one
of the 13 `fe-*` reusable workflows; it lives in cplace-fe. Recommend the cplace-fe owners bump that
action before 2026-06-16. (Tracked separately, not part of this migration.)

---

## Verdict

**✅ ACCEPTED.** All 13 `fe-*` reusable workflows are Node-24-ready: actionlint proves the node20
runners are gone (11 removed, 0 new) for all 13; 7/13 confirmed live under forced Node 24 with zero
GHA-runtime deprecations (including the two new JS actions `github-script v9` and `sonarqube-scan v8`
and the new `use-npmrc` composite); the remaining 6 share the identical SHA-pinned action set and are
static-verified. → **HUMAN CHECKPOINT → Phase 6** (cleanup of cplace-fe test PR #2718 / test commits;
PR feature → `release/25.2`).
