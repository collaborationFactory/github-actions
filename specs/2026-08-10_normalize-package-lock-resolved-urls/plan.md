---
date: 2026-08-10
git_commit: 7661e9b
branch: fix/PFM-ISSUE-34453-normalize-package-lock-json/25.2
baseline_branch: release/25.2
topic: 'PFM-ISSUE-34453: Normalize package-lock.json resolved URLs onto the JFrog npm proxy'
tags: [plan, package-lock, npm, jfrog, bash, jq, bats, shellcheck, ci, rollout]
status: ready
last_updated: 2026-08-10
---

# PFM-ISSUE-34453 — Normalize `package-lock.json` resolved URLs onto the JFrog npm proxy — Implementation Plan

## Overview

Deliver, to all seven long-lived branches, a bash + jq **normalizer** that rewrites the 171 `registry.npmjs.org`
`resolved` prefixes in `package-lock.json` onto the JFrog npm proxy, a two-assertion **invariant check** that proves
nothing but those prefixes changed, and this repository's **first `on: pull_request` workflow** to guard against
reintroduction — then normalize the lockfile on each branch.

Architecture is fixed by [design.md](./design.md); this plan is about *how* to build it.

## Current State Analysis

Measured directly against the working tree at `7661e9b` (`release/25.2` lineage), jq 1.8.1:

| fact | value |
| --- | --- |
| `.packages` entries | 543 (1 root + 542 non-root) |
| non-root entries with a string `resolved` | 542 (**zero** missing) |
| `registry.npmjs.org` entries | **171** |
| `cplace.jfrog.io/artifactory/api/npm/cplace-npm/` entries | 371 |
| distinct `resolved` prefixes | exactly 2 |
| entries whose `resolved` is not a standard `<name>/-/<file>.tgz` URL | **0** |
| occurrences of `/-/` per `resolved` | exactly 1, on all 542 |
| scoped (`@scope/name`) entries | 155 |
| lockfile size | 262 063 bytes |

**What exists:** nothing. `tools/scripts/` contains `artifacts/`, `run-many/`, `upmerge/` — all TypeScript. There is no
`lockfile/` directory, no `.sh` file anywhere under `tools/`, and no `on: pull_request` workflow in
`.github/workflows/` (all 13 are `workflow_call`-only). `.prettierignore` contains only `node_modules` and `.idea`.

**Local toolchain:** jq 1.8.1, bats 1.13.0, shellcheck 0.11.0 all present. `shfmt` is **absent** — so no shfmt step
anywhere.

**Repository is public** (`collaborationFactory/github-actions`, `isPrivate: false`), so CI needs no extra token.

## Desired End State

On each of the seven branches:

- `tools/scripts/lockfile/{lib.sh,fingerprint.jq,normalize-lockfile.sh,check-lockfile.sh,warn-foreign-registry.sh,test-helper.bash,*.bats,README.md}`
  exist and are **byte-identical across all seven branches**.
- `.github/workflows/pr-checks.yml` and `.github/actions/use-npmrc/action.yml` are byte-identical across all seven
  branches; `pr-checks.yml` runs two node-free jobs on every PR. (`use-npmrc` joined the set in Phase 4b.)
- `package-lock.json` contains **zero** `registry.npmjs.org` occurrences and exactly one distinct `resolved` prefix.
- `./tools/scripts/lockfile/check-lockfile.sh --baseline HEAD~1` exits 0.

Verified by the automated criteria in each phase plus the cross-branch `sha256sum` comparison in Phase 7.

### Key Discoveries

These were measured during planning and change what gets written:

1. **The jq rewrite is byte-identical to a raw `sed` prefix rewrite.** Verified on the real lockfile:
   262 063 → 266 851 (**+4788**), **342 changed diff lines, 0 of them non-`resolved`**, trailing newline preserved,
   and a second run is a no-op. So the structured form costs nothing in byte-safety. (`design.md` claimed this; it now
   holds for the exact jq program in this plan, not just for a prototype.)
2. **Both assertions are load-bearing, confirmed by injected drift:**

   | injected drift | graph invariance | prefix exactness |
   | --- | --- | --- |
   | t1 changed tarball filename | **catches** | misses |
   | t3 changed dependency edge | **catches** | misses |
   | t5 poisoned `integrity` | **catches** | misses |
   | t2 typo'd proxy repo (`cplace-nmp`) | misses | **catches** |
   | t4 entry left on npmjs | misses | **catches** |

3. **`jq`'s `capture` raises an error on a non-tarball URL** — it does not return null. So both scripts need a
   **pre-validation pass** that names offending package paths *before* any `capture` runs, or a future `link:`/`git+ssh:`
   entry produces an unreadable jq stack trace instead of `design.md`'s promised "names the package path". Verified: the
   pre-validation filter catches an injected `link: true` entry and returns zero offenders on the real lockfile.
4. **The tarball-path regex is unambiguous here.** Every `resolved` contains exactly one `/-/`, so
   ~~`(?:@[^/]+/)?[^/]+/-/[^/]+$`~~ extracts `@scope/name/-/file.tgz` or `name/-/file.tgz` correctly for all 542
   entries, scoped and unscoped alike. It is defined **once**, in `lib.sh`, and passed to jq via `--arg` so the
   normalizer and the fingerprint cannot drift apart.
   **Amended:** the shipped constant is `(?:@[^/]+/)?[^/]+/-/.+\.tgz$` — `\.tgz` required in review, the tail widened
   on 2026-08-13 (`8cb5d67`). "Exactly one `/-/`, and nothing after it but a filename" holds for this repository's own
   lockfiles but **not** for consumer ones: JFrog serves `…/-/@scope/name-1.2.3.tgz` and `…/-/<version>/name.tgz`,
   measured on cplace-paw-fe `release/25.2`. The 542-entry measurement is still correct; it was simply not a sample of
   what the tooling would meet downstream.
5. **The introducing PR guards itself.** For `pull_request` (unlike `pull_request_target`), the workflow runs from the
   merge commit, which contains both the base branch's tree and the PR's changes. Because `design.md` puts the tooling
   commit and the lockfile commit in the *same* PR, the new `lockfile` job runs on the PR that introduces it and passes
   — the candidate is already normalized, and the fingerprint strips the registry so it compares equal to the
   un-normalized base. A tooling-only PR with an un-normalized lockfile would fail its own guard; the two-commit /
   one-PR structure is therefore mandatory, not cosmetic.
6. ~~**The guard baseline must be `github.event.pull_request.base.sha`, not `origin/${{ github.base_ref }}`.**
   `base.sha` is a parent of the checked-out merge commit and is guaranteed present with `fetch-depth: 0`, with no
   dependence on which remote refs `actions/checkout` happened to fetch.~~
   **Superseded 2026-08-11 (`604f95e`): the guard takes no baseline at all.** It runs `--prefix-only`, so there is no
   base commit to reach, no `fetch-depth: 0`, and this choice no longer arises — see the note under Phase 4's workflow
   block. The finding itself still holds for any *future* baseline comparison run inside a `pull_request` workflow, and
   is kept for that reason.
7. **`shellcheck` is preinstalled on GitHub's `ubuntu-24.04` image but `bats` is not.** Both are installed via
   `apt-get` anyway, so the job does not silently depend on image contents.

## What We're NOT Doing

Carried verbatim from [design.md](./design.md) — out of scope, and not to be added during implementation:

- **A git submodule for the tooling.** Considered and rejected during planning: `.github/workflows/pr-checks.yml`
  cannot live in one (GitHub only executes workflows physically present in the repo's own tree), so the duplication it
  would remove is only partial, while it adds a new repo, a pinned gitlink to bump on seven branches, and an untested
  interaction between submodules and `cplace-cli flow --upmerge`. The `sha256sum` comparison in Phase 7 gives the same
  guarantee at near-zero cost.
- Consumer-repo lockfile guarding — no change to `fe-install-deps.yml` or any reusable workflow (→ PFM-ISSUE-34454).
- Branch protection / required status checks (→ own follow-up, GitHub Rule Sets). The guard **reports**, it does not
  **block**.
- Enabling `jest` in CI (unmeasured) or `check-prettier` in CI (20 pre-existing failures).
- `DOT_NPMRC` standardization / JFrog anonymous-access shutdown (→ PFM-ISSUE-34454).
- Branches ≤ 24.2.
- Eliminating the runtime `npm ci` (pre-bundling via esbuild/ncc, or publishing `tools/scripts/*`).
- Fixing the stale `--release 5.17` in `tools/scripts/upmerge/upmerge.ts:22`.
- ~~Modifying `use-npmrc`~~ — **superseded by Phase 4b (2026-08-11).** `use-npmrc` *is* now modified: it appends
  `replace-registry-host=never` and runs the advisory `warn-foreign-registry.sh`. The original exclusion assumed
  consumer pipelines were green and would only be endangered by a change here; the consumer survey found
  `cplace-paw-fe` `release/25.2`/`25.3` **already broken**, which only a change here fixes. See Phase 4b and
  [design.md](./design.md) Dimension 9. The **four affected composite actions** (`artifacts`, `snapshots`, `upmerge`,
  `run-many`) remain unmodified.
- Any npm devDependency for bats or shellcheck — that would mutate `package-lock.json` on all seven branches and break
  the very invariant this ticket establishes.

## Implementation Approach

Phases 1–6 execute end-to-end on the current branch
(`fix/PFM-ISSUE-34453-normalize-package-lock-json/25.2` → `release/25.2`). Phase 7 is a single parameterised runbook
applied six more times. Phase 8 files the follow-ups.

**Commit structure on every branch (design decision 7 — mandatory, see Key Discovery 5):** one PR, two commits.

- Commit 1 — tooling only (`tools/scripts/lockfile/*`, `.github/workflows/pr-checks.yml`, `.prettierignore`).
- Commit 2 — the normalized `package-lock.json` **alone**.

so that verification is exactly `check-lockfile.sh --baseline HEAD~1` with no remembered ref to get wrong. PRs are
squash-merged; the two commits exist for review.

**Established patterns.** These are the repository's first `.sh` files, so the pattern is *created* in Phase 2 and
approved before the rest is written:

- Google Shell Style Guide; `#!/usr/bin/env bash`; `set -euo pipefail`; all logic in functions; `main "$@"` last.
- `readonly` for constants, `local` for everything else; `${var}` bracing throughout.
- Errors to **stderr** via `err`/`die`; every failure message names the offending **package path**, the README, and the
  remediation command — and **never** echoes the JFrog host, which CI masks as `***`.
- shellcheck-clean at default severity; every `disable` carries a reason comment.
- Tests co-located as `<script-name>.bats`, mirroring the repo's existing co-located `*.test.ts` convention.

---

## Phase 1: Pre-flight — re-probe the proxy

### Overview

`design.md` Known Risk 1: the ticket's "166 × 200, 5 × 302" probe of the 171 tarballs through `cplace-npm` was taken on
faith and never re-verified. A curated-repo or Xray policy change would invalidate the entire approach. A non-200/302
is **stop-the-line** — do not proceed to Phase 2.

### Changes Required

None in the repository. This is a throwaway script in the scratchpad, deliberately not committed.

**File**: `<scratchpad>/probe-proxy.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

# Probe every npmjs-hosted tarball through the cplace JFrog npm proxy,
# anonymously (as the five ~/.npmrc-less workflows do).
jq -r '
  .packages
  | to_entries[]
  | select(.key != "")
  | .value.resolved
  | select(type == "string")
  | select(test("registry\\.npmjs\\.org"))
' package-lock.json \
  | sed 's#^https://registry\.npmjs\.org/#https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/#' \
  | while read -r url; do
      printf '%s %s\n' "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${url}")" "${url}"
    done \
  | tee probe-results.txt \
  | awk '{print $1}' | sort | uniq -c
```

### Success Criteria

#### Automated Verification

- [x] The probe covers exactly 171 URLs: `wc -l < probe-results.txt` is `171`
- [x] Every status code is `200` or `302`: `awk '$1 !~ /^(200|302)$/' probe-results.txt` prints nothing
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 1 complete. Summary: re-probed all 171 npmjs tarballs through the cplace-npm proxy; status-code histogram is <paste histogram>. Please review and reply 'yes' to continue to Phase 2." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification

- [x] The status-code histogram is consistent with the ticket's original probe (predominantly 200, a small number of 302)
      — **166 × 200, 5 × 302**, probed anonymously 2026-08-11, exactly reproducing the ticket's original probe
- [x] If any URL returns 403/404, **stop** and report — the approach itself is invalidated, not just this phase
      — none did. The five 302s (`@babel/core`, `caniuse-lite`, `object.assign`, `prettier`, `typescript`) are JFrog
      remote-repo redirects; following one yields 200 with a real 232 744-byte payload.

---

## Phase 2: Establish the bash pattern

### Overview

Create `lib.sh`, `fingerprint.jq`, and **one** sample bats test. Nothing else is written until this pattern is
approved — it is the template every subsequent file follows, and the repo has no precedent to copy.

### Changes Required

#### 1. Shared constants and helpers

**File**: `tools/scripts/lockfile/lib.sh`
**Changes**: New file. Sourced by both scripts; never executed directly.

```bash
#!/usr/bin/env bash
#
# Shared constants and helpers for the package-lock.json normalizer and checker.
#
# This file is sourced, never executed. It deliberately depends on nothing but
# bash and jq: the scripts that source it exist to repair the lockfile that
# makes `npm ci` fail, so they cannot require `npm ci` to have succeeded.
#
# See tools/scripts/lockfile/README.md

# The one npm proxy every `resolved` URL in this repository's package-lock.json
# must point at.
#
# Hard-coded on purpose. This constant *is* the invariant that check-lockfile.sh
# asserts; if it were caller-supplied, a typo'd prefix handed to both scripts
# would validate itself. It is not a secret - it is already committed in
# plaintext in every JFrog-hosted lockfile entry - and it is NOT the JFROG_URL
# publish target (`.../artifactory/cplace-npm-local`, see
# tools/scripts/artifacts/configuration.ts:2), which points somewhere else.
readonly JFROG_NPM_PROXY='https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/'

# Extracts the registry-independent tarball path from a `resolved` URL:
#   https://<host>/<any/prefix>/@scope/name/-/name-1.2.3.tgz -> @scope/name/-/name-1.2.3.tgz
#   https://<host>/<any/prefix>/name/-/name-1.2.3.tgz        -> name/-/name-1.2.3.tgz
# Anchored at the end and safe because every `resolved` in this lockfile
# contains exactly one `/-/` (verified: 542/542).
#
# Defined once, here, and passed to jq via --arg, so that the normalizer and
# fingerprint.jq can never drift apart.
readonly TARBALL_PATH_RE='(?<t>(?:@[^/]+/)?[^/]+/-/[^/]+)$'   # superseded, see below
```

~~The regex above is what this phase specified.~~ **Superseded — the shipped constant is**
`'(?<t>(?:@[^/]+/)?[^/]+/-/.+\.tgz)$'`. Two changes, in order: `\.tgz` was **required** in response to review of
PR #163, so the regex matches what the documentation and the error messages promise (0 of 542 entries affected,
fingerprint unchanged, `\.tgz` deliberately case-sensitive while the scheme is not); then the tail was **widened**
from `[^/]+` to `.+` on 2026-08-13 (`8cb5d67`), because JFrog serves tarball paths containing slashes — a repeated
scope and an interposed version segment — which the narrower form rejected on entries that were already on the proxy.
See Phase 9. The fingerprint is byte-identical on all seven branches under both changes.

```bash

# Shape every non-root entry's `resolved` must have. Checked BEFORE any
# `capture`, because jq's capture raises an error rather than returning null
# when it does not match - which would replace a readable "package X has no
# usable tarball URL" with a jq stack trace.
readonly RESOLVED_URL_RE='^https?://[^/]+/.*(?:@[^/]+/)?[^/]+/-/[^/]+$'

readonly README_PATH='tools/scripts/lockfile/README.md'
readonly NORMALIZE_CMD='./tools/scripts/lockfile/normalize-lockfile.sh'

LOCKFILE_TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly LOCKFILE_TOOLS_DIR
readonly FINGERPRINT_JQ="${LOCKFILE_TOOLS_DIR}/fingerprint.jq"

info() {
  printf '%s\n' "$*"
}

err() {
  printf '%s\n' "$*" >&2
}

die() {
  err "ERROR: $*"
  exit 1
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    die "jq is required but not installed (macOS: brew install jq). See ${README_PATH}"
  fi
}

byte_size() {
  wc -c <"$1" | tr -d '[:space:]'
}

# Fails, naming every offending package path, if any non-root entry lacks a
# usable tarball URL. Never echoes a URL: CI masks the JFrog host as ***, so a
# message built from one is unreadable exactly when it matters most.
assert_resolvable() {
  local lockfile="$1"
  local offenders
  offenders="$(jq -r --arg url_re "${RESOLVED_URL_RE}" '
    .packages
    | to_entries[]
    | select(.key != "")
    | select(((.value.resolved | type) != "string")
             or ((.value.resolved | test($url_re)) | not))
    | .key
  ' "${lockfile}")"

  if [[ -n "${offenders}" ]]; then
    err "ERROR: these entries in ${lockfile} have no usable tarball URL:"
    while IFS= read -r package_path; do
      err "  ${package_path}"
    done <<<"${offenders}"
    err ""
    err "Every non-root entry must carry a standard <name>/-/<file>.tgz `resolved` URL."
    err "A link:/file:/git+ssh: dependency is a deliberate, reviewed loosening of this"
    err "assertion - see ${README_PATH}."
    exit 1
  fi
}

# Reduces a lockfile to its registry-independent comparable form. Sorted keys so
# the output is diffable and order-insensitive.
fingerprint_of() {
  jq -S --arg tarball_re "${TARBALL_PATH_RE}" -f "${FINGERPRINT_JQ}" "$1"
}

# Number of entries not already on the proxy - i.e. how much work there is to do.
count_foreign_entries() {
  jq --arg proxy "${JFROG_NPM_PROXY}" '
    [ .packages[]
      | select((type == "object") and ((.resolved | type) == "string"))
      | select((.resolved | startswith($proxy)) | not)
    ] | length
  ' "$1"
}
```

#### 2. The registry-independent fingerprint

**File**: `tools/scripts/lockfile/fingerprint.jq`
**Changes**: New file.

```jq
# Reduces a package-lock.json to a registry-independent, comparable form: every
# `resolved` URL is replaced by its bare tarball path. A legitimately rehosted
# entry therefore compares EQUAL, while a changed version, integrity, tarball
# filename or dependency edge does not.
#
# Requires: --arg tarball_re '<regex with a named group `t`>'  (see lib.sh)
#
# This transform is deliberately BLIND to which host an entry was rehosted onto
# - a typo'd proxy repo name and an entry left on npmjs both survive it. That
# blindness is exactly why check-lockfile.sh runs a second, independent prefix
# assertion; the two together are what `design.md` Dimension 2 requires.
#
# The whole entry is compared, not a version/integrity/tarball subset, because
# the subset misses dependency-edge drift (drift case t3).

.packages |= with_entries(
  if (.value | type) == "object" and (.value.resolved | type) == "string" then
    .value.resolved |= (capture($tarball_re) | .t)
  else
    .
  end
)
```

#### 3. The sample test — the bats pattern

**File**: `tools/scripts/lockfile/test-helper.bash`
**Changes**: New file. Builds the minimal fixtures both suites share.

```bash
#!/usr/bin/env bash
#
# Shared bats fixture builders. Fixtures are tiny hand-written lockfiles, not
# copies of the real 262 KB one: the tests assert behaviour, not byte counts.

readonly PROXY='https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/'
readonly NPMJS='https://registry.npmjs.org/'

# A two-entry mixed lockfile: one npmjs entry (scoped), one already on the proxy.
write_mixed_lockfile() {
  cat >"$1" <<'JSON'
{
  "name": "fixture",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "fixture",
      "version": "1.0.0",
      "dependencies": {
        "@scope/alpha": "^1.0.0"
      }
    },
    "node_modules/@scope/alpha": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/@scope/alpha/-/alpha-1.0.0.tgz",
      "integrity": "sha512-AAAA==",
      "dependencies": {
        "beta": "^2.0.0"
      }
    },
    "node_modules/beta": {
      "version": "2.0.0",
      "resolved": "https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/beta/-/beta-2.0.0.tgz",
      "integrity": "sha512-BBBB=="
    }
  }
}
JSON
}
```

**File**: `tools/scripts/lockfile/normalize-lockfile.bats`
**Changes**: New file containing **one** test — the sample that establishes the pattern. The remaining tests arrive in
Phase 3.

```bash
#!/usr/bin/env bats

setup() {
  LOCKFILE_DIR="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"
  load "${LOCKFILE_DIR}/test-helper.bash"
  NORMALIZE="${LOCKFILE_DIR}/normalize-lockfile.sh"
  TMP="${BATS_TEST_TMPDIR}/package-lock.json"
}

@test "rewrites npmjs entries onto the proxy and leaves proxy entries alone" {
  write_mixed_lockfile "${TMP}"

  run "${NORMALIZE}" "${TMP}"

  [ "${status}" -eq 0 ]
  [ "$(grep -c 'registry.npmjs.org' "${TMP}" || true)" -eq 0 ]
  [ "$(jq -r '.packages["node_modules/@scope/alpha"].resolved' "${TMP}")" \
      = "${PROXY}@scope/alpha/-/alpha-1.0.0.tgz" ]
  [ "$(jq -r '.packages["node_modules/beta"].resolved' "${TMP}")" \
      = "${PROXY}beta/-/beta-2.0.0.tgz" ]
  [ "$(jq -r '.packages["node_modules/@scope/alpha"].integrity' "${TMP}")" = 'sha512-AAAA==' ]
}
```

> This test cannot pass until `normalize-lockfile.sh` exists (Phase 3). Phase 2 delivers it as the **reviewed pattern**;
> Phase 3 makes it green. Verify the pattern in Phase 2 with the standalone commands below, which exercise `lib.sh` and
> `fingerprint.jq` directly.

### Success Criteria

#### Automated Verification

- [x] Files exist: `ls tools/scripts/lockfile/{lib.sh,fingerprint.jq,test-helper.bash,normalize-lockfile.bats}`
- [x] shellcheck is clean: `shellcheck tools/scripts/lockfile/lib.sh tools/scripts/lockfile/test-helper.bash`
      — clean after one `# shellcheck disable=SC2034` on `NORMALIZE_CMD` (consumed by `check-lockfile.sh`, invisible to
      shellcheck when analysing `lib.sh` standalone) and a file-level SC2034 disable for the fixture constants
- [x] `lib.sh` sources without error: `bash -c 'source tools/scripts/lockfile/lib.sh && echo "${TARBALL_PATH_RE}"'`
- [x] The fingerprint is stable on the real lockfile — it must equal itself after normalization. Run:
      `bash -c 'source tools/scripts/lockfile/lib.sh; fingerprint_of package-lock.json | sha256sum'` and confirm it
      matches the fingerprint of a jq-normalized copy of the same file — both `223e40e6ff642ff3…`
- [x] `assert_resolvable` returns 0 on the real lockfile and exits 1 naming `node_modules/foo` on a copy with
      `.packages["node_modules/foo"] = {"link": true}` injected
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 2 complete. Summary: created lib.sh (hard-coded proxy constant, single tarball-path regex, assert_resolvable/fingerprint_of/count_foreign_entries helpers), fingerprint.jq, test-helper.bash and one sample bats test — this is the bash + bats pattern every remaining file will follow. Please review the pattern and reply 'yes' to continue to Phase 3." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification

- [ ] The pattern reads like something this repo would accept as its first shell code *(reviewer judgement)*
- [ ] Comments explain *why* (hard-coded constant, deliberate blindness of the fingerprint), not *what* *(reviewer judgement)*
- [x] No failure message anywhere contains the JFrog host — `assert_resolvable`'s failure output greps
      `cplace.jfrog.io` zero times

---

## Phase 3: Normalizer, check, and the full bats suite

### Overview

Write the two executables and complete the test suite, including all five injected-drift cases that motivated the
two-assertion design.

### Changes Required

#### 1. The normalizer

**File**: `tools/scripts/lockfile/normalize-lockfile.sh`
**Changes**: New file, `chmod +x`.

```bash
#!/usr/bin/env bash
#
# Rewrites every `resolved` URL in a package-lock.json onto the cplace JFrog npm
# proxy, changing nothing else. Idempotent.
#
# Usage:
#   ./tools/scripts/lockfile/normalize-lockfile.sh [<lockfile>]
#
# Defaults to ./package-lock.json.
#
# Requires only bash and jq - no node, no `npm ci`. That is the point: this
# script repairs the lockfile whose npmjs URLs make `npm ci` fail against a
# JFrog ~/.npmrc, so it cannot depend on `npm ci` having worked.
#
# See tools/scripts/lockfile/README.md

set -euo pipefail

# shellcheck source=tools/scripts/lockfile/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  local lockfile="${1:-package-lock.json}"

  require_jq
  [[ -f "${lockfile}" ]] || die "no such lockfile: ${lockfile}"

  assert_resolvable "${lockfile}"

  local before_bytes rewritten
  before_bytes="$(byte_size "${lockfile}")"
  rewritten="$(count_foreign_entries "${lockfile}")"

  local tmp
  tmp="$(mktemp)"
  # shellcheck disable=SC2064  # expand ${tmp} now, not when the trap fires
  trap "rm -f '${tmp}'" EXIT

  jq --arg proxy "${JFROG_NPM_PROXY}" --arg tarball_re "${TARBALL_PATH_RE}" '
    .packages |= with_entries(
      if (.value | type) == "object" and (.value.resolved | type) == "string" then
        .value.resolved |= ($proxy + (capture($tarball_re) | .t))
      else
        .
      end
    )
  ' "${lockfile}" >"${tmp}"

  # Self-assertion. Secondary by design: it cannot see drift that arrived BEFORE
  # this run (a bad merge), which is why check-lockfile.sh compares against a git
  # baseline instead. It does make this script safe to run standalone.
  if ! diff -q <(fingerprint_of "${lockfile}") <(fingerprint_of "${tmp}") >/dev/null; then
    die "internal error: normalization altered the dependency graph; ${lockfile} left untouched"
  fi

  # `cat >` rather than `mv`, to preserve the file's existing permissions.
  cat "${tmp}" >"${lockfile}"

  local after_bytes
  after_bytes="$(byte_size "${lockfile}")"

  info "normalized ${lockfile}"
  info "  entries rewritten: ${rewritten}"
  info "  byte delta:        $((after_bytes - before_bytes)) (${before_bytes} -> ${after_bytes})"
  if ((rewritten == 0)); then
    info "  already normalized - nothing to do"
  fi
}

main "$@"
```

#### 2. The invariant check

**File**: `tools/scripts/lockfile/check-lockfile.sh`
**Changes**: New file, `chmod +x`.

```bash
#!/usr/bin/env bash
#
# Proves that a package-lock.json differs from its baseline ONLY in registry
# prefixes, and that every `resolved` URL points at the one correct proxy.
#
# Usage:
#   ./tools/scripts/lockfile/check-lockfile.sh [--baseline <ref-or-file>] [<candidate>]
#
#   --baseline HEAD~1                 the commit before the lockfile commit (default: HEAD)
#   --baseline :2:                    "ours" during a merge conflict
#   --baseline :3:                    "theirs" during a merge conflict
#   --baseline path/to/other.json     an explicit file
#
# Two independent assertions, BOTH required to pass:
#   1. graph invariance - the whole document, with every `resolved` reduced to a
#      registry-independent tarball path, must equal the baseline;
#   2. prefix exactness - every `resolved` must carry exactly the one proxy prefix.
#
# Neither alone is sufficient: (1) is blind to WHICH host an entry moved to, and
# (2) is blind to everything except the host. See design.md Dimension 2.
#
# See tools/scripts/lockfile/README.md

set -euo pipefail

# shellcheck source=tools/scripts/lockfile/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() {
  err "usage: ${0##*/} [--baseline <git-ref-or-file>] [<candidate-lockfile>]"
  exit 2
}

# Writes the baseline lockfile to ${2}, resolving ${1} as a file path if one
# exists, otherwise as a git ref. Always prints what it resolved, so a wrong
# baseline is visible rather than silent.
resolve_baseline() {
  local ref="$1" out="$2"

  if [[ -f "${ref}" ]]; then
    cat "${ref}" >"${out}"
    info "baseline: file ${ref}"
    return
  fi

  local spec="${ref}"
  if [[ "${spec}" == *: ]]; then
    spec="${spec}package-lock.json"     # `:2:` -> `:2:package-lock.json`
  elif [[ "${spec}" != *:* ]]; then
    spec="${spec}:package-lock.json"    # `HEAD~1` -> `HEAD~1:package-lock.json`
  fi

  if ! git show "${spec}" >"${out}" 2>/dev/null; then
    die "cannot read baseline '${ref}' (tried '${spec}'); pass a git ref or an existing file"
  fi
  info "baseline: ${spec}"
}

# Assertion 1. Prints every drifted package path; returns 1 if any.
assert_graph_invariant() {
  local baseline="$1" candidate="$2"
  local fp_base fp_cand drift

  fp_base="$(mktemp)"
  fp_cand="$(mktemp)"

  fingerprint_of "${baseline}" >"${fp_base}"
  fingerprint_of "${candidate}" >"${fp_cand}"

  drift="$(jq -n -r --slurpfile a "${fp_base}" --slurpfile b "${fp_cand}" '
    ($a[0]) as $A | ($b[0]) as $B
    | [ ((($A | keys) + ($B | keys)) | unique)[]
        | select(. != "packages")
        | select(($A[.] | tojson) != ($B[.] | tojson))
        | "top-level key: " + . ]
      + [ (((($A.packages // {}) | keys) + (($B.packages // {}) | keys)) | unique)[]
          | select((($A.packages[.]) | tojson) != (($B.packages[.]) | tojson)) ]
    | .[]
  ')"

  # Cleaned up explicitly rather than via `trap ... RETURN`: a RETURN trap set
  # inside a function is global unless `functrace` is set, so it would also fire
  # on unrelated function returns later in the run.
  rm -f "${fp_base}" "${fp_cand}"

  if [[ -n "${drift}" ]]; then
    err "FAIL: the dependency graph differs from the baseline. Drifted entries:"
    while IFS= read -r package_path; do
      err "  ${package_path}"
    done <<<"${drift}"
    return 1
  fi

  info "PASS: dependency graph identical to baseline"
}

# Assertion 2. Prints every package path not on the one correct proxy.
assert_prefix_exactness() {
  local candidate="$1"
  local offenders distinct

  offenders="$(jq -r --arg proxy "${JFROG_NPM_PROXY}" --arg tarball_re "${TARBALL_PATH_RE}" '
    .packages
    | to_entries[]
    | select(.key != "")
    | select((.value.resolved | sub($tarball_re; "")) != $proxy)
    | .key
  ' "${candidate}")"

  distinct="$(jq -r --arg tarball_re "${TARBALL_PATH_RE}" '
    [ .packages | to_entries[] | select(.key != "")
      | (.value.resolved | sub($tarball_re; "")) ] | unique | length
  ' "${candidate}")"

  if [[ -n "${offenders}" ]]; then
    err "FAIL: ${distinct} distinct registry prefixes found (expected exactly 1)."
    err "These entries do not resolve via the cplace npm proxy:"
    while IFS= read -r package_path; do
      err "  ${package_path}"
    done <<<"${offenders}"
    return 1
  fi

  info "PASS: exactly ${distinct} registry prefix, matching the expected proxy"
}

main() {
  local baseline='HEAD' candidate='package-lock.json'

  while (($# > 0)); do
    case "$1" in
      --baseline)
        [[ $# -ge 2 ]] || usage
        baseline="$2"
        shift 2
        ;;
      -h | --help) usage ;;
      -*) usage ;;
      *)
        candidate="$1"
        shift
        ;;
    esac
  done

  require_jq
  command -v git >/dev/null 2>&1 || die "git is required but not installed"
  [[ -f "${candidate}" ]] || die "no such lockfile: ${candidate}"

  local baseline_file
  baseline_file="$(mktemp)"
  # shellcheck disable=SC2064  # expand path now, not when the trap fires
  trap "rm -f '${baseline_file}'" EXIT

  resolve_baseline "${baseline}" "${baseline_file}"
  info "candidate: ${candidate}"

  assert_resolvable "${baseline_file}"
  assert_resolvable "${candidate}"

  # Run BOTH assertions before failing, so one run reports every problem.
  local failed=0
  assert_graph_invariant "${baseline_file}" "${candidate}" || failed=1
  assert_prefix_exactness "${candidate}" || failed=1

  if ((failed != 0)); then
    err ""
    err "To fix: run ${NORMALIZE_CMD}"
    err "then re-run: ${0} --baseline ${baseline}"
    err "See ${README_PATH}"
    exit 1
  fi

  info "OK: ${candidate} is normalized and graph-identical to its baseline"
}

main "$@"
```

#### 3. The full test suite

**File**: `tools/scripts/lockfile/normalize-lockfile.bats`
**Changes**: Extend the Phase 2 sample with:

- idempotence — a second run reports `entries rewritten: 0` and a byte delta of `0`
- `version`, `integrity` and `dependencies` are untouched
- a non-root entry with no `resolved` fails, naming the package path
- a `git+ssh:` `resolved` fails, naming the package path (rather than raising a jq error)
- a missing file argument fails cleanly
- **no error message contains `cplace.jfrog.io`** (masking safety)

**File**: `tools/scripts/lockfile/check-lockfile.bats`
**Changes**: New file. `test-helper.bash` gains one builder per drift case.

| test | drift injected into the candidate | must fail via |
| --- | --- | --- |
| passes on a clean normalization | none | — (exit 0) |
| t1 | tarball filename `alpha-1.0.0.tgz` → `alpha-9.9.9.tgz` | graph invariance |
| t2 | proxy repo `cplace-npm` → `cplace-nmp` | prefix exactness |
| t3 | `dependencies.beta` `^2.0.0` → `^9.0.0` | graph invariance |
| t4 | one entry left on `registry.npmjs.org` | prefix exactness |
| t5 | `integrity` → `sha512-POISONED==` | graph invariance |
| t6 | `version` `1.0.0` → `9.9.9` | graph invariance |

Plus: every failure names the offending package path; a git-ref baseline resolves (`--baseline HEAD`); two explicit
file paths are accepted; a bad baseline ref exits 1 with a readable message; no failure message contains
`cplace.jfrog.io`.

### Success Criteria

#### Automated Verification

- [x] Both scripts are executable: `test -x tools/scripts/lockfile/normalize-lockfile.sh -a -x tools/scripts/lockfile/check-lockfile.sh`
- [x] shellcheck is clean: `shellcheck tools/scripts/lockfile/*.sh tools/scripts/lockfile/test-helper.bash`
- [x] bats passes: `bats tools/scripts/lockfile/` — 24/24 at the time of this phase; **52/52** after the two review
      rounds added `warn-foreign-registry.bats` and the regression tests
- [x] All seven drift cases (t1–t6 plus the clean case) are present and asserted: `grep -c '^@test' tools/scripts/lockfile/check-lockfile.bats` is at least `11`
- [x] On a **copy** of the real lockfile, the normalizer reports `entries rewritten: 171` and `byte delta: 4788`
      — exact: `262063 -> 266851`
- [x] The result is byte-identical to a raw prefix rewrite:
      `sed 's#"resolved": "https://registry.npmjs.org/#"resolved": "https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/#' package-lock.json | cmp - <normalized-copy>`
- [x] `diff <original> <normalized-copy> | grep '^[<>]' | wc -l` is `342`, and `... | grep -vc '"resolved"'` is `0`
- [x] A second normalizer run on the normalized copy reports `entries rewritten: 0` and `byte delta: 0`
- [x] No error output contains the proxy host: inject each drift case and confirm `grep -c 'cplace.jfrog.io'` on stderr is `0`
      — all four real-scale drift cases: `host-leaks=0`, each naming `node_modules/jest`
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 3 complete. Summary: normalize-lockfile.sh and check-lockfile.sh written, shellcheck-clean; bats suite green with all six injected-drift cases (t1–t6); on a copy of the real lockfile the normalizer rewrites 171 entries for +4788 bytes / 342 changed lines / 0 non-resolved lines, byte-identical to a raw sed rewrite, and is idempotent. Please review and reply 'yes' to continue to Phase 4." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification

- [ ] A failure message read cold tells you which package is wrong and exactly what to run next *(reviewer judgement)*
- [x] The two assertions genuinely fail independently — t2 and t4 fail *only* prefix exactness, t1/t3/t5/t6 *only* graph
      invariance. `check-lockfile.bats` asserts the *identity* of the failing assertion, not merely that a failure occurred.
- [x] Nothing in either script would break if `${JFROG_URL}` changed — the proxy constant is unrelated to the publish
      target. Neither script reads any environment variable.

---

## Phase 4: The PR guard, `.prettierignore`, and the README

### Overview

Add the repository's first `on: pull_request` workflow, plus documentation. Together with Phases 2–3 this is **commit 1**
of the branch's PR.

### Changes Required

#### 1. The guard workflow

**File**: `.github/workflows/pr-checks.yml`
**Changes**: New file. Deliberately **not** `fe-`-prefixed — in this repo that prefix means "reusable workflow consumed
by other repositories".

```yaml
name: PR Checks

# This repository's first `on: pull_request` workflow. Everything under
# .github/workflows/ is otherwise `workflow_call`-only, and the `pull_request`
# trigger lives in .github/workflow-templates/fe/fe-pr.yml, which GitHub never
# executes.
#
# No `paths:` filter on purpose: a path-filtered workflow reports as pending
# rather than success, and would permanently block merges once it becomes a
# required check.
on:
  pull_request:
    branches:
      - '**'

permissions:
  contents: read

jobs:
  lockfile:
    name: Lockfile registry invariant
    runs-on: ${{ vars.SMALL_RUNNER || 'ubuntu-latest' }}
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3

      # --prefix-only, NOT a baseline comparison. With no baseline there is
      # nothing to fetch, so the default shallow checkout is enough. jq is
      # pre-installed on GitHub-hosted ubuntu runners, and this job runs no node
      # and no `npm ci` - the guard has to be trustworthy precisely when the
      # lockfile is broken.
      - name: Check package-lock.json resolved URLs
        run: ./tools/scripts/lockfile/check-lockfile.sh --prefix-only

  scripts:
    name: Shell scripts
    runs-on: ${{ vars.SMALL_RUNNER || 'ubuntu-latest' }}
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3

      # Never npm devDependencies: adding them would mutate package-lock.json on
      # all seven branches and break the invariant this workflow exists to guard.
      - name: Install bats and shellcheck
        run: |
          sudo apt-get update
          sudo apt-get install -y bats shellcheck

      - name: shellcheck
        run: shellcheck tools/scripts/lockfile/*.sh tools/scripts/lockfile/test-helper.bash

      - name: bats
        run: bats tools/scripts/lockfile/
```

**Changed during execution (2026-08-11, commit `604f95e`):** the block above is the *shipped* workflow. As originally
planned, the guard ran `check-lockfile.sh --baseline "${{ github.event.pull_request.base.sha }}"` on a
`fetch-depth: 0` checkout. Review of PR #163 showed that gate fails **every legitimate dependency change** — graph
invariance forbids any change to the graph, which is exactly what an ordinary `npm install` PR does — and then advises
running the normalizer, which cannot fix a graph difference. Graph invariance verifies a *normalization commit*; the
ticket's ongoing criterion is prefix exactness alone. Consequences, all recorded where they arise:

- `--prefix-only` needs no baseline, so `fetch-depth: 0` is gone and the default shallow checkout is used.
- Key Discovery 6 (`base.sha` vs `origin/${{ github.base_ref }}`) is thereby superseded — see the strikethrough there.
- `--baseline` is not lost, only relocated: it is run by hand to verify each normalization commit (Phase 5, Phase 7)
  and during conflict resolution, which is what README Flows 1 and 2 document.
- A green PR is therefore **not** evidence that a lockfile diff changed only prefixes. `design.md:528` states this.

#### 2. Prettier insurance

**File**: `.prettierignore`
**Changes**: Add `package-lock.json`. Forward-looking only — prettier currently leaves the lockfile byte-unchanged both
before and after normalization. This protects against a future npm writing differently-formatted JSON once
`check-prettier` eventually runs in CI.

```
node_modules
.idea
package-lock.json
```

#### 3. The documented entry point

**File**: `tools/scripts/lockfile/README.md`
**Changes**: New file. `design.md` Dimension 4 makes discoverability a documentation responsibility rather than an npm
alias, so this must be written, not stubbed. Three flows:

1. **Per-branch rollout** — `normalize-lockfile.sh`, commit the lockfile alone, `check-lockfile.sh --baseline HEAD~1`.
2. **Conflict resolution during an upmerge** — `git checkout --ours -- package-lock.json`, re-run the normalizer,
   `check-lockfile.sh --baseline :2:` (or `:3:`), proceed only on exit 0. Never `--theirs`, never a hand edit.
3. **Interpreting a guard failure** — what each assertion means, why messages name package paths rather than URLs
   (`JFROG_URL` masking), and what to do about a legitimate future `link:`/`file:`/`git+ssh:` entry.

Plus: the `brew install jq` prerequisite, and why this is bash rather than TypeScript (the bootstrap argument).

### Success Criteria

#### Automated Verification

- [x] The workflow is valid YAML — **PyYAML is not installed here**; validated with `ruby -ryaml` and additionally
      with **`actionlint`, which is clean**
- [x] The checkout SHA matches the pinned convention in `specs/2026-06-05_node24-workflow-migration/sha-pins.md`:
      `grep -c 'df4cb1c069e1874edd31b4311f1884172cec0e10' .github/workflows/pr-checks.yml` is `2`
- [x] No third-party action is used: `grep -E '^\s+uses:' .github/workflows/pr-checks.yml | grep -vc 'actions/checkout'` is `0`
- [x] The workflow is node-free — **the plan's grep is too naive**: it matches the explanatory comment "this job runs
      no node and no `npm ci`". Correct check, on non-comment lines only:
      `grep -vE '^\s*#' .github/workflows/pr-checks.yml | grep -E 'setup-node|npm ci'` → no matches
- [x] `.prettierignore` contains `package-lock.json`
- [x] `tools/scripts/lockfile/README.md` documents all three flows: `grep -c 'checkout --ours' tools/scripts/lockfile/README.md` is at least `1`
- [x] The whole tooling set is committed as commit 1 with no lockfile change — **the plan's command is wrong**:
      `git show --stat` includes the commit *message*, which legitimately mentions `package-lock.json` in prose.
      Correct check: `git show --name-only --format= HEAD | grep -c '^package-lock.json$'` → `0`
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 4 complete. Summary: added .github/workflows/pr-checks.yml (first on: pull_request workflow here; lockfile + scripts jobs, node-free, apt-get for bats/shellcheck, only actions/checkout pinned by SHA), package-lock.json added to .prettierignore, and tools/scripts/lockfile/README.md covering rollout, conflict resolution and guard-failure interpretation. This is commit 1 of the PR. Please review and reply 'yes' to continue to Phase 5." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification

- [ ] The README is genuinely usable by someone whose `npm ci` is broken right now *(reviewer judgement)*
- [ ] The workflow name and job names read well in the PR checks list *(reviewer judgement)*
- [x] Nothing in the workflow depends on the runner image happening to ship a tool — `bats` and `shellcheck` are
      installed explicitly; `jq` is the one image assumption, and `require_jq` fails loudly naming the README if absent

### Blocker discovered at first run — repository Actions policy

The first PR run (`31471849858`) ended in **`startup_failure` at 0s, with no jobs and no annotations**. Diagnosis:

```
$ gh api repos/collaborationFactory/github-actions/actions/permissions
{"enabled":true,"allowed_actions":"local_only","sha_pinning_required":false}

$ gh api repos/collaborationFactory/cplace-e2e/actions/permissions      # a repo whose workflows do run
{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}
```

`local_only` is the UI radio *"Allow `collaborationFactory` actions and reusable workflows"*. It permits actions owned
by the repo's **owner org**, so `actions/checkout` — owned by the `actions` organization — is rejected before any job
starts. The `409 Conflict` from the `selected-actions` endpoint confirms the repo is not in `selected` mode, which is
the only mode offering the *"Allow actions created by GitHub"* checkbox.

**Neither `research.md` nor `design.md` caught this.** Both correctly established "this repo has no CI of its own";
neither asked whether it *could*. `design.md` Dimension 5 treated adding a `pull_request` workflow as purely a
file-authoring problem. It is also a repo-settings problem — and it applies to all seven branches at once, since
`allowed_actions` is repo-scoped, not branch-scoped.

Ruled out during diagnosis, each with evidence:

| suspect | verdict |
| --- | --- |
| `runs-on: ${{ vars.SMALL_RUNNER \|\| 'ubuntu-latest' }}` | **not the cause** — the org's documented pattern, running today in `cplace-e2e`, `cplace-staging-builds`, `cplace-gh-workflows` |
| Invalid workflow YAML | **not the cause** — `actionlint` clean, ruby/psych parses it |
| Bad pinned checkout SHA | **not the cause** — SHA exists upstream, used by 9 other workflows here |
| Unbuildable merge ref | **not the cause** — PR reports `MERGEABLE` / `CLEAN` |

**Blast radius of raising the policy: exactly one workflow.** Measured across all seven branches — all 91 files under
`.github/workflows/` (13 × 7) are `workflow_call`-only and never self-execute. GitHub has registered 14 workflows here:
the 13 `fe-*.yml` plus `pr-checks.yml`. Nothing under `.github/workflow-templates/` is registered, despite those files
carrying `push` / `schedule` / `pull_request` triggers — confirming they are inert template content. Consumer repos are
unaffected either way: a `workflow_call` run executes in the **caller's** context under the caller's policy, which is
why every FE repo consumes these workflows today while this repo sits at `local_only`.

**Resolved.** The repo owner raised the policy in the UI. Confirmed by API:

```
$ gh api repos/collaborationFactory/github-actions/actions/permissions
{"enabled":true,"allowed_actions":"selected", ...}

$ gh api repos/collaborationFactory/github-actions/actions/permissions/selected-actions
{"github_owned_allowed":true,"patterns_allowed":[],"verified_allowed":false}
```

This permits `actions/*` and nothing else — no Marketplace, no arbitrary third parties — so it is strictly narrower
than `cplace-e2e`'s `all`. The workflow needed no change, and `local_only` was therefore repo-set rather than
org-enforced. The failed run could not be retried (`This workflow run cannot be retried`), so the guard was
re-triggered by closing and reopening the PR, which fires `pull_request: reopened` without adding a commit.

**Consequence for Phase 7:** none. `allowed_actions` is repo-scoped, so this one change covers all seven branches.

**Fallback, no longer needed but recorded:** had the policy been org-enforced, the guard would have replaced
`actions/checkout` with plain `git` in `run:` steps — dependency-free, and incidentally dropping the third-party SHA
pin this design flagged as a per-branch maintenance chore.

---

## Phase 5: Normalize `release/25.2`

### Overview

**Commit 2** of the PR: the normalized `package-lock.json` alone. Its parent *is* the baseline, so the invariant is
provable by construction.

### Changes Required

**File**: `package-lock.json`
**Changes**: 171 `resolved` prefixes rewritten. No other line touched.

```bash
./tools/scripts/lockfile/normalize-lockfile.sh
git add package-lock.json
git commit -m 'PFM-ISSUE-34453 - github-actions: normalize package-lock.json resolved URLs onto the JFrog npm proxy'
./tools/scripts/lockfile/check-lockfile.sh --baseline HEAD~1
```

### Success Criteria

#### Automated Verification

- [x] `grep -c 'registry.npmjs.org' package-lock.json` returns `0`
- [x] `./tools/scripts/lockfile/check-lockfile.sh --baseline HEAD~1` exits 0 and prints both PASS lines
- [x] The commit touches exactly one file: `git show --stat HEAD --name-only --format= | wc -l` is `1`, and it is `package-lock.json`
- [x] Exactly 342 changed lines, none of them non-`resolved`:
      `git show HEAD -- package-lock.json | grep -c '^[+-][^+-]'` is `342`, and
      `git show HEAD -- package-lock.json | grep '^[+-][^+-]' | grep -vc '"resolved"'` is `0`
- [x] Byte delta is exactly +4788: `git show HEAD~1:package-lock.json | wc -c` vs `wc -c < package-lock.json`
      — `262063 -> 266851`
- [x] The normalizer is idempotent: re-running it reports `entries rewritten: 0`, and `git diff --exit-code package-lock.json` is clean
- [x] bats and shellcheck still pass: `shellcheck tools/scripts/lockfile/*.sh && bats tools/scripts/lockfile/`
      — 24/24 at the time of this phase; **52/52** now
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 5 complete. Summary: package-lock.json normalized on release/25.2 as its own commit — 171 entries rewritten, +4788 bytes, 342 changed lines, 0 non-resolved lines, 0 registry.npmjs.org remaining; check-lockfile.sh --baseline HEAD~1 exits 0. Ready to push and open the PR. Please review and reply 'yes' to continue to Phase 6." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification

- [x] Spot-check three entries in the diff — a scoped package, an unscoped one, and one that was already on JFrog
      (which must be unchanged). Scoped `@ampproject/remapping` and unscoped `update-browserslist-db` (the ticket's own
      example URL) both rewritten with the tarball path preserved; `@actions/core`, already on JFrog, appears **0 times**
      in the diff.
- [x] Push the branch and confirm **both** `pr-checks.yml` jobs run and pass on the PR itself (see Key Discovery 5)
      — PR [#163](https://github.com/collaborationFactory/github-actions/pull/163) against `release/25.2`. After the
      Actions policy was raised, run `31475431467` is **green on both jobs**, and the logs prove the assertions really
      executed rather than passing vacuously:

      ```
      baseline: 967168ed1c896821e28a3ad343ddfcc6b07a4bcb:package-lock.json   # = release/25.2 tip = base.sha
      candidate: package-lock.json
      PASS: dependency graph identical to baseline
      PASS: exactly 1 registry prefix, matching the expected proxy
      OK: package-lock.json is normalized and graph-identical to its baseline
      ```

      The `scripts` job ran **24/24** bats tests plus shellcheck (the suite is **52** after two review rounds). Key Discovery 5 is confirmed empirically: the
      workflow ran on the very PR that introduced it, and passed.

      **That output predates `604f95e`.** The guard ran `--baseline` at the time of this run, which is why the log
      quotes a baseline and a graph-invariance line. Since the switch to `--prefix-only` the same job prints only
      `PASS: exactly 1 registry prefix, matching the expected proxy` / `OK: package-lock.json resolves entirely via the
      cplace npm proxy`. The evidence is kept verbatim as the historical record of the run; do not treat it as the
      expected output of the current workflow.

      Runner resolved to `ubicloud-standard-2`, so `vars.SMALL_RUNNER` **is** defined for this repo, and both `jq`
      (preinstalled) and `sudo apt-get` work there. Job times: `lockfile` **8s**, `scripts` 23s — the guard is the
      fastest job in the repo precisely because it runs no `setup-node` and no `npm ci`.
- [x] The PR description states plainly that the guard reports but cannot block until the Rule Sets follow-up lands

**Change requested mid-phase:** both jobs in `pr-checks.yml` now use
`runs-on: ${{ vars.SMALL_RUNNER || 'ubuntu-latest' }}`. Folded into commit 1 by amend (both commits were still
unpushed) rather than added as a third commit, so the two-commit structure `--baseline HEAD~1` depends on is preserved.
actionlint clean. Commit 1 is now `fd63b83`.

`SMALL_RUNNER` is new to this repository — it appears nowhere on this branch, `master`, `26.2` or `26.3`. The nearest
precedent is `runs-on: ${{ inputs.GITHUB_RUNNER }}` in two reusable workflows.

**Runner confirmed:** `SMALL_RUNNER` is hosted by Ubicloud, whose images track the GitHub-hosted runner spec — so the
`lockfile` job's preinstalled `jq` and the `scripts` job's `sudo apt-get` both hold. The first PR run is the empirical
proof of that, and is exactly what the Phase 5 manual-verification item below checks.

---

## Phase 6: Consumer-repo canary

### Overview

Prove the fix before anything merges. `design.md` Dimension 7: the canary must exercise a `use-npmrc` path — the five
workflows that run `npm ci` with no `~/.npmrc` resolve npmjs URLs fine today and cannot demonstrate anything.

### Changes Required

**Repository**: ~~`cplace-remote-filesystem-fe`~~ → **`cplace-paw-fe`** (temporary PR — **not** merged)

**Changed during execution:** `cplace-remote-filesystem-fe`'s release branches do not go back to `25.2`, so it cannot
exercise the `25.2` lockfile state at all. `cplace-paw-fe` has a `release/25.2` that pins
`github-actions@release/25.2`, so it was used instead.

1. Branch from the branch whose workflows pin `github-actions@release/25.2`.
2. Temporarily re-point the `uses:` refs to the branch under test, in a workflow that goes through `use-npmrc`.
3. Open the PR, let the pipeline run, confirm the composite's internal `npm ci` resolves every package.
4. Close the PR and discard the branch. Do not merge; create no tag and no release.

> Note, so it is not a surprise: `fe-pr-snapshot` publishes a `latest-pr-snapshot` package to JFrog (cleaned up by
> `fe-pr-close`). That is a real publish, though not a tag or a release.

### Two execution findings that would have invalidated a naive canary

**1. Re-pinning the consumer's `uses:` alone tests the wrong lockfile.** The `artifacts` composite runs
`cd "$GITHUB_ACTION_PATH/../../.." && npm ci`, so it installs *its own* checkout — meaning the ref on the **composite**,
not on the reusable workflow, decides which `package-lock.json` is under test. `fe-pr-snapshot.yml` pins `use-npmrc`
and `artifacts` internally at `@release/25.2`. A canary that re-pinned only the consumer's `uses:` would have installed
`release/25.2`'s **un-normalized** lockfile and passed for the wrong reason.

Resolved with a throwaway `canary/PFM-ISSUE-34453-lockfile/25.2` branch in `github-actions` = the fix branch plus
internal ref re-pins, so nothing temporary could reach the real PR. Deleted after validation. The runner log proves the
right tree was used:

```
GITHUB_ACTION_PATH=/home/runner/work/_actions/collaborationFactory/github-actions/canary/PFM-ISSUE-34453-lockfile/25.2/.github/actions/artifacts
```

**2. The canary job is label-gated.** `fe-pr-snapshot.yml` carries
`if: contains(github.event.pull_request.labels.*.name, 'snapshot')`, and the consumer's trigger is
`types: [labeled, synchronize, reopened]` — **not `opened`**. Opening the PR fires nothing; adding the `snapshot`
label both fires the event and satisfies the `if:`.

Also worth knowing for the remaining states: only `fe-pr-snapshot` and `fe-pr-close` are valid canary paths.
`fe-licenses` and `fe-install-deps` call `use-npmrc` but then run a workflow-level `npm ci` against the *consumer's*
own lockfile — they never invoke a composite, so they cannot demonstrate anything. `fe-cleanup-snapshots` is a cron in
`cplace-paw-fe` with no `workflow_dispatch`, so it is not PR-triggerable.

### Success Criteria

#### Automated Verification

- [x] The canary pipeline run completes green — `cplace-paw-fe` PR #184, run `31487742492`,
      `publish-pr-snapshot` **success**. paw-fe's normal PR CI (still pinned at `@release/25.2`) was also green on all
      15 jobs beforehand, as a control.
- [x] The composite's `npm ci` step log shows no `E404` and no `***`-masked resolution failure — **zero `E404` in the
      entire run**. The full chain, in log order:

      ```
      435  Run cd "$GITHUB_ACTION_PATH/../../.." && pwd && npm ci
      448  added 542 packages, and audited 543 packages in 14s
      460  Run npx ts-node "$GITHUB_ACTION_PATH/../../../tools/scripts/artifacts/main.ts"
      ```

      542 packages / 543 audited is the **github-actions** lockfile's exact entry count, matching the local run
      precisely — so this installed the tree under test, not the consumer's. `main.ts` then ran successfully on top,
      proving `node_modules` was functional and not merely populated.
- [x] The re-pinned `uses:` refs point at the branch under test, verified in the PR diff before the run

**Additional local proof (design.md Manual testing steps 1–2), a controlled experiment — same machine, same
`~/.npmrc`, lockfile the only variable:**

| lockfile | `npm ci` |
| --- | --- |
| pre-fix (171 npmjs URLs) | `npm error code E404` — `GET https://cplace.jfrog.io/unicode-property-aliases-ecmascript/-/…tgz`, i.e. the `/artifactory/api/npm/cplace-npm` prefix dropped |
| normalized (0 npmjs URLs) | `added 542 packages, and audited 543 packages in 5s`, exit 0 |

**No artifact was published, and the canary does not claim one.** `main.ts` correctly reported *"No snapshots of
projects have been published (probably no project is affected)"* — the canary PR changes only a workflow file, so nx
found no affected project. Confirmed with `jf rt search`: no `cf-training-extended` artifact exists for PR 184. This is
unrelated to the fix; `npm publish` never depended on lockfile resolution, and the step that *did* fail before the fix
(`npm ci`) is proven working.
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 6 complete. Summary: canary PR in cplace-paw-fe (cplace-remote-filesystem-fe has no release/25.2) with uses: temporarily re-pinned to the fix branch, exercising a use-npmrc path — the composite's internal npm ci resolved with no E404. Canary PR closed, no tag or release created. release/25.2 is ready to merge. Please review and reply 'yes' to continue to Phase 7 (the six remaining branches)." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification

- [x] The chosen workflow demonstrably ran `use-npmrc` before the composite (check step ordering in the run log)
      — step 5 `Use .npmrc` → success, step 7 `Build and Push to Jfrog NPM Registry` → success. (Step 6
      `Install modules` was **skipped** on a cache hit; that is the *consumer's* own install and is irrelevant. The
      composite's `npm ci` inside step 7 runs unconditionally, which is exactly why it is the failing step today.)
- [x] The canary PR is closed and its branch deleted; no `uses:` re-pin is left behind anywhere — PR #184 closed with
      `--delete-branch`; `canary/PFM-ISSUE-34453-lockfile/25.2` deleted local and remote. `git ls-remote origin 'canary/*'`
      returns 0. Both repos verified clean, and the fix branch's internal refs are back at `@release/25.2`.
- [ ] `release/25.2` PR merged after the canary is green — prove-then-merge, in that order

**Canary coverage decision:** this validated the `25.2` lockfile state. The other two states (`25.3 = 25.4` and
`26.1 = 26.2 = 26.3 = master`) get their own canary run during Phase 7, as `design.md` Dimension 7 requires.

---

## Phase 7: Replicate to the six remaining branches

### Overview

One parameterised runbook, executed six times in order: `25.3 → 25.4 → 26.1 → 26.2 → master → 26.3`. `master` and
`26.3` are **not** downstream of `26.2` (research §8), so none of this can ride the upmerge.

Tooling files must be **byte-identical** across branches, so a future upmerge sees a conflict-free add/add.

### PR #163 is the seed; `master` is explicitly in scope

**`master` receives this fix like every other branch** — it is in the ordered list above, and because it is not
downstream of `26.2` it can only get there through its own PR. It is not a leftover to be handled later.

**#163 is the seed, not merely the first instance.** Everything the six inherit — the tooling set, the guard, the
mitigation, and the two rounds of review fixes folded into it — is settled here. That is why this PR carries the whole
substantive review and the others do not, and why the six are held unpushed until #163 is approved: a change here has
to be replicated seven times.

**Each PR still carries the differences its own branch requires.** Byte-identity is a property of the *tooling set*
(`tools/scripts/lockfile/*`, `pr-checks.yml`, `use-npmrc/action.yml`, `.prettierignore`) — **not** of the whole diff.
Per branch, legitimately different:

- the `package-lock.json` content and its byte totals (three distinct lockfile states — `25.2` | `25.3 = 25.4` |
  `26.1 = 26.2 = 26.3 = master`), though every branch shows the same `171` / `+4788` / `342` / `0` signature;
- the PR's base branch, and on `master` the base is `master` rather than a `release/*`;
- anything a branch already differs in that the tooling touches — verified 2026-08-11 to be nothing:
  `.prettierignore` is byte-identical on all seven, and no branch already contains `tools/scripts/lockfile/` or
  `pr-checks.yml`.

The byte-identity gate in step 3 below is what keeps that distinction honest: it compares only the tooling paths, so a
legitimate per-branch difference elsewhere cannot mask tooling drift.

### Gate: PR #163 must be APPROVED before this phase starts

Not *merged* — approved. The six branches are technically independent of #163's merge: the tooling is copied from commit
`fd63b83`, which is already pushed, and each branch normalizes its **own** pre-fix lockfile, so no branch can inherit
another's dependency versions. Each PR's guard also runs on itself, proven on #163.

The binding constraint is different: because the tooling files must stay byte-identical across all seven branches, **any
change arising from #163's review would have to be force-pushed to all seven PRs.** Approval is therefore the event that
makes the tooling content safe to replicate — merge is irrelevant to it.

Review context measured 2026-08-11: `release/25.2` has **no branch protection at all**; only `master` requires an
approval (1), with zero required status checks; no rulesets, no CODEOWNERS. So review is a team practice here rather
than something the repo enforces — which is precisely what the Phase 8 Rule Sets follow-up addresses.

When reviewing the six, note that #163 is the only PR with novel content; the others are the same tooling plus a
machine-checked lockfile transformation. State that in each PR description, with the `sha256sum` proof, so the six do
not consume six substantive reviews.

### Changes Required — per branch `<B>`

```bash
# 1. Branch from the release branch
git fetch origin
git checkout -b "fix/PFM-ISSUE-34453-normalize-package-lock-json/<B>" "origin/release/<B>"   # or origin/master

# 2. Commit 1 - tooling, copied verbatim from the merged 25.2 commit
git checkout <merged-25.2-tooling-commit> -- \
  tools/scripts/lockfile .github/workflows/pr-checks.yml .prettierignore
git commit -m 'PFM-ISSUE-34453 - github-actions: add package-lock.json normalizer, invariant check and PR guard'

# 3. Byte-identity gate - MUST be empty before continuing
git diff --stat <merged-25.2-tooling-commit> HEAD -- \
  tools/scripts/lockfile .github/workflows/pr-checks.yml

# 4. Commit 2 - the lockfile alone
./tools/scripts/lockfile/normalize-lockfile.sh
git add package-lock.json
git commit -m 'PFM-ISSUE-34453 - github-actions: normalize package-lock.json resolved URLs onto the JFrog npm proxy'

# 5. Prove it
./tools/scripts/lockfile/check-lockfile.sh --baseline HEAD~1
```

### Pre-flight measurements for this phase (2026-08-11, while #163 is in review)

**No drift since research.** All seven branches still show exactly the state the plan assumes, and the last commit
touching any lockfile is from 2025 — so no Dependabot churn to account for:

| branch | entries | npmjs | jfrog | lockfile sha256[:10] |
| --- | --- | --- | --- | --- |
| `release/25.2` | 543 | 171 | 371 | `21aead4730` |
| `release/25.3`, `release/25.4` | 543 | 171 | 371 | `012c07592f` |
| `release/26.1`, `26.2`, `26.3`, `master` | 559 | 171 | 387 | `d06efe2cba` |

**The normalizer was dry-run against all six remaining branches.** Every one succeeds, and the `+4788` delta holds
across all three lockfile states (it is `171 × 28`, independent of entry count):

| branch | before → after | delta | changed lines | non-`resolved` | idempotent |
| --- | --- | --- | --- | --- | --- |
| `25.3`, `25.4` | 262 061 → 266 849 | +4788 | 342 | 0 | yes |
| `26.1`, `26.2`, `26.3`, `master` | 270 244 → 275 032 | +4788 | 342 | 0 | yes |

**Two conflict risks retired:**

- `.prettierignore` is **byte-identical on all seven branches** (`node_modules` / `.idea`), so the conflict this plan
  warned about cannot occur — the same one-line addition applies cleanly everywhere.
- **No branch already contains `tools/scripts/lockfile/` or `pr-checks.yml`** (0 files on each), so every copy is a
  clean add.

**The canary trap recurs per state, and is not a 25.2 quirk:** each branch pins its composites to its own release
(`release/25.4` → `@release/25.4`, `release/26.2` → `@release/26.2`). So the `25.4` and `26.x` canaries each need
their own throwaway branch with the internal `use-npmrc`/`artifacts` refs re-pinned, exactly as Phase 6 did.

**Canary coverage.** There are three distinct lockfile states — `25.2` | `25.3 = 25.4` | `26.1 = 26.2 = 26.3 = master`.
Phase 6 covered the first. Run one further canary per remaining state: one on `25.4`, one on `26.2`. The other three
26.x branches carry a byte-identical lockfile and need no separate canary.

### Canary runbook (per remaining state: `25.4`, then `26.2`)

Derived from Phase 6, where both of the traps below were hit for real. `<B>` is `release/25.4` or `release/26.2`.

```bash
# 1. Throwaway branch in github-actions: the fix branch for <B>, plus internal ref re-pins.
#    MANDATORY. The artifacts composite runs `cd "$GITHUB_ACTION_PATH/../../.." && npm ci`,
#    so the ref on the COMPOSITE decides which lockfile is installed. Re-pinning only the
#    consumer's `uses:` would install <B>'s UN-normalized lockfile and pass for the wrong reason.
#    Verified 2026-08-11: every branch pins its composites to its own release, so this recurs per state.
git checkout -b "canary/PFM-ISSUE-34453-lockfile/<V>" "fix/PFM-ISSUE-34453-normalize-package-lock-json/<V>"
# edit .github/workflows/fe-pr-snapshot.yml: use-npmrc@<B> and artifacts@<B>
#   -> @canary/PFM-ISSUE-34453-lockfile/<V>          (use an editor: BSD sed has no \| alternation)
git commit -am 'PFM-ISSUE-34453 - TEMPORARY canary pin - DO NOT MERGE' && git push -u origin HEAD

# 2. Consumer branch in cplace-paw-fe, from the branch pinning github-actions@<B>
git checkout -b "test/PFM-ISSUE-34453-lockfile-canary/<V>" "origin/<B>"
# edit .github/workflows/fe-pr-snapshot.yml: the single `uses:` -> @canary/PFM-ISSUE-34453-lockfile/<V>
git commit -am 'PFM-ISSUE-34453 - paw-fe TEMPORARY canary pin - DO NOT MERGE' && git push -u origin HEAD
gh pr create --draft --base "<B>" --title 'PFM-ISSUE-34453 - CANARY (do not merge)' --body '…'

# 3. Fire it. The job is gated on `if: contains(…labels.*.name, 'snapshot')` and the consumer
#    trigger is `types: [labeled, synchronize, reopened]` - NOT `opened`. Opening the PR fires nothing.
gh pr edit <N> --add-label snapshot

# 4. Verify - the composite path must contain the canary branch, or you tested the wrong tree
gh run view <RUN> --log | grep -E 'GITHUB_ACTION_PATH=|added [0-9]+ packages|E404'
```

Pass criteria: the log shows `GITHUB_ACTION_PATH=…/github-actions/canary/PFM-ISSUE-34453-lockfile/<V>/…`, then
`added 542 packages` (25.x) or `added 558 packages` (26.x), and **zero `E404`** in the whole run.

Cleanup: `gh pr close <N> --delete-branch`, then delete the github-actions canary branch local and remote. Confirm with
`git ls-remote --heads origin 'canary/*'` returning nothing.

Note `cplace-paw-fe` has `release/25.2` and `release/25.3` but **check `release/25.4` and `release/26.2` exist there**
before starting; if not, pick another consumer pinning that branch. Also note paw-fe's own `release/25.2` and `25.3`
lockfiles each carry 14 npmjs entries ([consumer-survey.md](./consumer-survey.md)) — unrelated to this fix, but it
means a *workflow-level* `npm ci` on those branches may fail for the same underlying reason. Do not mistake that for a
canary failure: the canary's subject is the **composite's** install, not the consumer's.

### Reusable PR description for the six replication PRs

The point is to make these cheap to review, since only #163 carries novel content.

```markdown
## What this is

Branch <N> of 7 for PFM-ISSUE-34453. Normalizes this branch's `package-lock.json` `resolved`
URLs onto the JFrog npm proxy, and adds the same lockfile tooling and PR guard.

**The tooling is byte-identical to #163** — verified, not asserted:

    sha256(tools/scripts/lockfile/* + pr-checks.yml) = <DIGEST>   # same on all seven branches

So the only thing needing review here is the lockfile commit, and that is machine-checked.
The substantive review is on #163.

## Two commits

1. Tooling — copied verbatim from #163's tooling commit.
2. The normalized lockfile alone. Its parent *is* the baseline, so the invariant is provable
   by construction: `./tools/scripts/lockfile/check-lockfile.sh --baseline HEAD~1`.

## Evidence

- 171 entries rewritten, +4788 bytes (`<BEFORE>` → `<AFTER>`), 342 changed lines, **0** outside a `"resolved"` line
- `grep -c registry.npmjs.org package-lock.json` → **0**
- `check-lockfile.sh --baseline HEAD~1` exits 0: graph identical, exactly one registry prefix
- bats 52/52 and shellcheck clean, both in CI via `pr-checks.yml`

Known limitation, same as #163: the guard **reports but cannot block** until PFM-ISSUE-34465
(Rule Sets enforcement) lands.
```

**Cross-branch consistency check**, after all seven PRs are merged:

```bash
for b in release/25.2 release/25.3 release/25.4 release/26.1 release/26.2 release/26.3 master; do
  printf '%s  ' "${b}"
  git show "origin/${b}:.github/workflows/pr-checks.yml" | sha256sum | cut -c1-16
done
for b in release/25.2 release/25.3 release/25.4 release/26.1 release/26.2 release/26.3 master; do
  printf '%s  ' "${b}"
  for f in lib.sh fingerprint.jq normalize-lockfile.sh check-lockfile.sh test-helper.bash README.md; do
    git show "origin/${b}:tools/scripts/lockfile/${f}"
  done | sha256sum | cut -c1-16
done
```

### Success Criteria

#### Automated Verification

- [ ] On each branch: `grep -c 'registry.npmjs.org' package-lock.json` returns `0`
- [ ] On each branch: `./tools/scripts/lockfile/check-lockfile.sh --baseline HEAD~1` exits 0
- [ ] On each branch: the lockfile commit shows 342 changed lines, 0 non-`resolved`, +4788 bytes
- [ ] On each branch: `shellcheck tools/scripts/lockfile/*.sh && bats tools/scripts/lockfile/` passes
- [ ] The byte-identity gate (step 3) produces empty output on all six branches
- [ ] Both `sha256sum` loops print the **same** digest on all seven rows
- [ ] `pr-checks.yml` runs and passes on all seven PRs
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 7 complete. Summary: all seven branches normalized (25.2, 25.3, 25.4, 26.1, 26.2, master, 26.3); every branch has 0 registry.npmjs.org entries and passes check-lockfile.sh --baseline HEAD~1; tooling files and pr-checks.yml are byte-identical across all seven (sha256 <digest>); canaries run for all three lockfile states. Please review and reply 'yes' to continue to Phase 8." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification

- [ ] Canaries green for the `25.4` and `26.x` lockfile states, both on a `use-npmrc` path
- [ ] The pending `25.2 → 25.3` upmerge (2 commits) is unaffected — normalizing `25.3` directly did not depend on it
- [ ] The two tag/release pipelines originally reported in the ticket now succeed
- [ ] No branch was normalized before its tooling commit landed on that same branch

---

## Phase 4b: Interim mitigation in `use-npmrc` (added 2026-08-11, folded into PR #163)

### Overview

Normalization fixes this repo's lockfile on seven branches, but not consumer lockfiles — and the consumer survey found
`cplace-paw-fe` `release/25.2`/`25.3` **already broken** for the same reason. This phase stops the bleeding everywhere
without touching a single lockfile.

### Changes Required

**File**: `.github/actions/use-npmrc/action.yml` — append one line, and run the advisory check:

```yaml
run: |
  echo "$DOT_NPMRC" > ~/.npmrc
  echo 'replace-registry-host=never' >> ~/.npmrc
```

**File**: `tools/scripts/lockfile/warn-foreign-registry.sh` — advisory; warns when the **consumer's** lockfile has
entries outside the proxy, via a `::warning` annotation plus a job summary. Never fails a build.

`use-npmrc` now joins the byte-identical tooling set, so the Phase 7 digest covers it.

### Success Criteria

#### Automated Verification

- [x] `replace-registry-host=never` present in `use-npmrc`
- [x] Mitigation verified against **real** lockfiles with the real secret:
      github-actions un-normalized → `added 542 packages`; `cplace-paw-fe release/25.2` → `added 2576 packages`
- [x] The advisory check is silent on a normalized lockfile, warns with a count on a mixed one, ignores local-path
      `resolved` values, and exits 0 on missing file / missing `jq` / invalid JSON / no `packages` section
- [x] No URL in the warning, so it survives `***` masking
- [x] bats **34/34** at the time of this phase (**52/52** now), shellcheck clean, `pr-checks.yml` green
- [x] Tooling digest identical on all seven branches including `use-npmrc`: `4131452a775f78ab`

#### Manual Verification

- [ ] Consumer canary proves the mitigation on a real runner *(Phase 6b below)*
- [ ] Removal is tracked on PFM-ISSUE-34454 *(done — a dedicated section was appended)*

**Rejected alternative, recorded because it was the first instinct:** reverting `use-npmrc` to a workspace-level
`.npmrc`. It fixes only the composite surface — a consumer's own `npm ci` runs *in* the workspace where that file
lives, so `cplace-paw-fe` would stay broken — and it makes the composite's install issue **730 anonymous JFrog
requests per run**, creating exactly the dependency PFM-ISSUE-34454 exists to remove.

---

## Phase 6b: Mitigation canary (consumer surface)

### Overview

Phase 6 proved the *composite* surface — its subject was the **github-actions** lockfile installed by the composite,
not paw-fe's own, which that run never installed (`Install modules` was skipped on a cache hit). This proves the
*consumer* surface: paw-fe's own lockfile on `release/25.2`, the branch that is actually broken. Both canary PRs were
opened against `release/25.2`.

### Changes Required

Canary branch `canary/PFM-ISSUE-34453-mitigation/25.2` in `github-actions` (fix branch + internal refs re-pinned to
itself), and a draft PR in `cplace-paw-fe` against **`release/25.2`** — the branch carrying 14 npmjs entries — with
`fe-pr.yml` re-pinned at that canary.

> **The internal re-pin is what makes this test valid.** The mitigation *lives in* `use-npmrc`, and
> `fe-install-deps.yml` pins `use-npmrc@release/25.2` internally. Re-pinning only the consumer's `uses:` would load the
> old `use-npmrc` and test nothing — the same trap as Phase 6, one level deeper.

### Success Criteria

#### Automated Verification

- [x] `install-deps` **succeeds** on `cplace-paw-fe` `release/25.2`, where it fails without the mitigation
      — [paw-fe#185](https://github.com/collaborationFactory/cplace-paw-fe/pull/185), run `31509557594`, job
      `93839623043`. Every link in the chain, from the runner log:

      ```
      echo 'replace-registry-host=never' >> ~/.npmrc
      ##[warning]14 entries in package-lock.json do not resolve via the cplace npm proxy. …
      added 2439 packages, and audited 2440 packages in 8m
      Install modules -> success
      ```

      The **8m** install time confirms a genuinely cold cache — nothing was restored, which is precisely the condition
      under which this branch fails today. `Install modules` is the step that returns `E404` without the mitigation.
- [x] The `::warning` annotation and job summary appear, naming the 14 offending package paths — the annotation
      independently counted **14**, matching the local survey, and surfaces in the run UI without failing the job
- [x] Canary PR closed, both throwaway branches deleted — `git ls-remote --heads origin 'canary/*'` returns 0, both
      repos clean, and the fix branch's internal refs are back at `@release/25.2` (7 occurrences, none on a canary)
- [x] **The full pipeline went green, not just `install-deps`** — all 15 jobs (4 e2e shards, 4 code-quality shards,
      2 builds, 2 storybooks, SonarCloud, install-deps) succeeded on a branch that cannot install without the
      mitigation. Stronger than this criterion asked for.

> **Process note, recorded because it nearly lost work.** The canary branch was created with `git checkout -b` and
> never switched away from, so the two documentation commits (`design.md` Dimension 9, `plan.md` Phase 4b/6b) landed on
> the *canary* branch and were pushed to its remote. Deleting the throwaway branch with `git branch -D` plus
> `git push --delete` then orphaned both. Recovered by cherry-picking the SHAs out of the reflog. **When working on a
> throwaway branch, commit documentation on the target branch first, or verify `git branch --show-current` before every
> commit.**

---

## Phase 8: File the follow-ups

### Overview

`design.md` explicitly defers two pieces of work and asks that they be filed **alongside** the plan, not after the
rollout — the guard is unenforced until the first one lands.

### Changes Required

1. **New PFM issue — enforcement via GitHub Rule Sets.** Measured today: six release branches unprotected; `master`
   protected with `required_status_checks.contexts = []`; zero rulesets. One ruleset targeting `release/*` + `master`
   replaces seven per-branch configurations and makes `pr-checks.yml` a required check. Reference PFM-ISSUE-34453 and
   the PFM-ISSUE-33179 precedent ("check does not block"). In the same family: enabling `jest` and `check-prettier` in
   CI once the 20 pre-existing prettier failures are cleaned up.
2. **Prep note on PFM-ISSUE-34454** — out-of-band consumer lockfile survey (clone the FE repos,
   `grep -c registry.npmjs.org` per repo and branch) so 34454 starts knowing its blast radius. Also record that after
   this fix the five `npm ci`-without-`~/.npmrc` workflows resolve 100 % of packages anonymously from JFrog rather
   than ~69 %.

### Success Criteria

#### Automated Verification

- [ ] Both follow-ups exist and are linked to PFM-ISSUE-34453
- [ ] PFM-ISSUE-34453 can be closed: every item in **Success Criteria** below is checked
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 8 complete. Summary: filed the Rule Sets enforcement follow-up (with jest/check-prettier CI noted in the same family) and the PFM-ISSUE-34454 consumer-lockfile-survey prep note, both linked to 34453. This completes the plan. Please review and reply 'yes' to close out." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification

- [ ] The Rule Sets issue states plainly that until it lands, `pr-checks.yml` reports but cannot block
- [ ] PFM-ISSUE-34454 is unblocked and its description reflects the increased anonymous-access exposure

---

## Phase 9: Review iteration 1 — triage fixes and jq audit (added 2026-08-13)

### Overview

Discharges the seven iteration-1 review findings that require a change, plus four defects found by an
argument-by-argument audit of every `jq` invocation in the toolkit, run during triage at the reviewer's request.

**This phase must complete before Phase 7.** The tooling files are meant to be byte-identical across all seven
branches, so a fix made after replication has to be made seven times instead of once.

The audit's headline: `normalize-lockfile.sh` and `fingerprint.jq` do **not** use the shared `JQ_REGISTRY_ENTRIES`
predicate — they transform every entry with a string `resolved`, including the root `""` key that the predicate
excludes. Reproduced on jq 1.8.1:

| input | observed |
| --- | --- |
| root entry resolving to `https://registry.npmjs.org/x/-/x-1.0.0.tgz` | file rewritten, +90 bytes, run printed `entries rewritten: 0` and `already normalized - nothing to do` |
| root entry resolving to `packages/root` | `resolved` **silently deleted**, exit 0, `already normalized` |

The cause is a false premise recorded in `lib.sh:37-40`: jq's `capture` does **not** raise on a non-match, it produces
`empty` — and `.x |= empty` *deletes* the key (`{"a":1,"b":2}` → `{"b":2}`). `fingerprint.jq` performs the identical
deletion on both sides of the comparison, so the fail-closed self-assertion and graph invariance are both blind to it.
Non-root entries are protected, because `assert_resolvable` runs first and every string matching `RESOLVED_URL_RE`
also matches `TARBALL_PATH_RE`; real lockfiles do not put `resolved` on the root entry, so this is latent rather than
firing today.

**Not a defect, recorded because it was raised and checked:** the `https?` scheme test is not a permission. The proxy
constant is `https://`, and `assert_prefix_exactness` demands exact equality, so `http://cplace.jfrog.io/…` fails the
guard (verified, exit 1), the advisory reports it, and the normalizer rewrites it to `https`. Narrowing the selector to
`^https://` would make plaintext-http entries *invisible* to the predicate and therefore silently compliant — bug
[1.3] again in a new scheme. The selector stays `https?`; only the failure message changes.

### Changes Required

**File**: `tools/scripts/lockfile/normalize-lockfile.sh`

**Changes**: gate the rewrite on the shared predicate's own terms — skip the root `""` key and require
`(.value.resolved | test("^https?://"; "i"))` — so `capture` is never handed a value `JQ_REGISTRY_ENTRIES` would have
passed over, and so `count_foreign_entries` and the rewrite genuinely agree, as `lib.sh:161-165` already claims they
do.

**File**: `tools/scripts/lockfile/fingerprint.jq`

**Changes**: apply the same two guards, so a root `resolved` is compared verbatim instead of being captured away —
which is what makes the graph comparison able to see it at all. Extend the header comment: it currently documents only
`--arg tarball_re`, while the transform additionally requires that the caller has already run `assert_resolvable`.

**File**: `tools/scripts/lockfile/lib.sh` — the tarball-path widening is **already applied** (see below); the rest of
this entry remains to be done.

**Applied 2026-08-13, ahead of the phase, because the rollout depends on it.** The 2026-08-13 canary
(cplace-paw-fe #186) reported **18** foreign entries where only 14 were foreign. The four extras sit on the correct
proxy host but carry a tarball path the regex rejected — a repeated scope
(`…/@cplace-next/cf-frontend-sdk/-/@cplace-next/cf-frontend-sdk-25.2.30.tgz`) or an interposed version segment
(`…/@fortawesome/fontawesome-pro/-/5.15.4/fontawesome-pro-5.15.4.tgz`), both served by JFrog and both installed by
npm without complaint. Two consequences: the advisory inventory that governs removal of `replace-registry-host=never`
could never reach zero on that consumer, and `normalize-lockfile.sh` refused to touch the lockfile at all
(`assert_resolvable`: "no usable tarball URL"). Both constants were widened from `[^/]+\.tgz` to `.+\.tgz`, in
lockstep — everything `RESOLVED_URL_RE` accepts must stay capturable by `TARBALL_PATH_RE`, or validation passes an
entry to a `capture` that yields `empty` and deletes its `resolved` key. Measured after the change: paw-fe reports
14, its normalizer run rewrites 14 (+392 bytes) and then passes the guard with the four odd-shaped entries untouched;
this repo's guard still passes and its normalizer is still idempotent (0 entries, 0 bytes); and the fingerprint is
**byte-identical on all seven branches** (`44464a7b05bbaf6a`, `e011920349fb2ecc` ×2, `93e0b3cd361bc1cc` ×4), so
Phase 5's recorded evidence stands. Five bats cases pin it: the two real shapes pass the guard, the same shape on a
foreign host is still rejected, the `RESOLVED_URL_RE` ⊆ `TARBALL_PATH_RE` invariant is asserted directly, and the
one genuine ambiguity — `.+` may cross a `/-/`, so a prefix containing one anchors on the first — is pinned with its
fail-loud direction recorded.

**Changes**: correct the `RESOLVED_URL_RE` rationale at lines 37-40. A non-matching `capture` yields `empty`, and
`|= empty` deletes the key — pre-validation exists to stop a *silent deletion*, not a jq stack trace. The conclusion
stands; only the stated mechanism was wrong, and the wrong one is what made the root-entry path read as safe. Give
`assert_supported_lockfile` an optional display-name argument, so the baseline can be checked without the error
message naming a `mktemp` path.

**File**: `tools/scripts/lockfile/check-lockfile.sh`

**Changes**:
- Call `assert_supported_lockfile` on the resolved baseline before fingerprinting it, passing the baseline spec as the
  display name. Today a lockfileVersion 1 baseline — `--baseline <ref>` predating the v2/v3 upgrade is the realistic
  way in — produces `jq: error … null (null) has no keys` followed by `internal error: cannot fingerprint the baseline
  (is fingerprint.jq present?)`: a raw jq trace plus a wrong diagnosis, the exact failure class this toolkit exists to
  eliminate.
- Report the number of registry entries examined on the `PASS:` line, and refuse to report compliance from an empty
  set. A lockfile whose entries are all `link:`, and one carrying only a root entry, both currently print
  `PASS: exactly 0 registry prefix, matching the expected proxy` and `OK: … resolves entirely via the cplace npm
  proxy` — asserting a fact from nothing, which is the vacuity `assert_supported_lockfile` was written to prevent.
  Trade-off, stated deliberately: a genuinely dependency-free lockfile now fails rather than passing silently;
  measured 542 entries on `release/25.2` and non-zero on all seven branches.
- When an offender's stripped prefix differs from the proxy **only** in scheme, add a line naming the plaintext-`http`
  downgrade as the reason. The entry already fails; the message says only "does not resolve via the cplace npm proxy",
  which is true but sends the reader looking for a path problem.
- Rebuild both jq programs in `assert_prefix_exactness` from single-quoted fragments concatenated around
  `JQ_REGISTRY_ENTRIES` — `'[ '"${JQ_REGISTRY_ENTRIES}"' | select(…) ]'` — so no jq `$var` sits inside a
  double-quoted bash string needing `\$tarball_re` / `\"\"` escaping. Drop the `--arg proxy` passed to the `distinct`
  program, which never references it. *(discharges [1.13])*

**File**: `tools/scripts/lockfile/check-lockfile.bats`

**Changes**: add cases for
- a `:2:` merge-stage baseline: build a real conflict on `package-lock.json`, then assert
  `check-lockfile.sh --baseline :2:` resolves and prints `baseline: :2:package-lock.json`. This is the
  `spec="${spec}${lockfile_path}"` arm of `resolve_baseline` and the path the Flow 2 runbook depends on *(discharges
  [1.5])*
- a lockfile omitting `lockfileVersion` entirely: exit 1 and `is it a package-lock.json?`, distinguishing the
  `missing` arm from its unsupported-version sibling *(discharges [1.11])*
- a lockfileVersion 1 baseline: fails with the readable message, no jq trace
- a lockfile with zero registry entries: does not claim proxy compliance
- an `http://` entry on the proxy host: fails, and the message names the scheme

**File**: `tools/scripts/lockfile/normalize-lockfile.bats`

**Changes**: add cases for
- a lockfile omitting `lockfileVersion` *(discharges [1.11])*
- a root entry carrying a foreign tarball URL: whatever the run reports must match what the file did — no
  `entries rewritten: 0` on a file that changed
- a root entry whose `resolved` is not a tarball URL: the key survives the run

**File**: `.github/actions/use-npmrc/action.yml`

**Changes**: line 41 uses the bash variable `$GITHUB_ACTION_PATH`, as `artifacts`, `snapshots`, `upmerge` and
`run-many` all do, instead of the `${{ github.action_path }}` expression — one spelling of the value per directory,
and the form that is quoted at runtime rather than interpolated into the command line, which is what the step's own
comment worries about. *(discharges [1.9])*

**File**: `tools/scripts/lockfile/README.md`

**Changes**: retitle "The two scripts" to "The scripts" (the table lists three, in four rows); change "Both default to
`./package-lock.json`" to "All three default"; split the invocation claim so "no npm script and no composite action
wrapper" applies to the two lockfile scripts it is true of, while `warn-foreign-registry.sh` is named as invoked by
`use-npmrc`. *(discharges [1.10])* In "no usable tarball URL", state that the hard failure fires on the `--baseline`
path and not on the `--prefix-only` PR guard. *(discharges [1.12])*

**File**: `specs/2026-08-10_normalize-package-lock-resolved-urls/design.md`

**Changes**: strike through Dimension 2's `link:`/`file:`/`git+ssh:` implication and annotate it
"**Superseded 2026-08-11 (`604f95e`)**" — matching the treatment its neighbouring `fetch-depth` implication already
carries — recording that the hard failure holds on the `--baseline` path while `--prefix-only` admits non-http entries
by design, so the guard would stop blocking npm workspaces. *(discharges [1.12])*

**File**: `specs/2026-08-10_normalize-package-lock-resolved-urls/plan.md`

**Changes**: strike through the `TARBALL_PATH_RE` line in the Phase 1 code block and the inline regex in Key
Discovery 4, annotating both with the shipped form — `'(?<t>(?:@[^/]+/)?[^/]+/-/.+\.tgz)$'`, i.e. tightened to
require `\.tgz` in response to review and then widened after the tail must be allowed to contain slashes (above) —
that 0 of 542 entries are affected and the fingerprint is unchanged on all seven branches, and that `\.tgz` is
deliberately case-sensitive while the scheme is not. *(discharges [1.14])*

### Success Criteria

#### Automated Verification

- [x] `bats tools/scripts/lockfile/` passes, including every case added above — **74/74** (57 before triage, 65 after
      the regex widening, 74 now)
- [x] `shellcheck tools/scripts/lockfile/*.sh` is clean
- [x] On the real `package-lock.json`: `check-lockfile.sh --prefix-only` exits 0 and now reports the number of entries
      examined (`542 entries examined`); `normalize-lockfile.sh` reports `entries rewritten: 0` with byte delta 0
- [x] `check-lockfile.sh --baseline` still exits 0 across the Phase 5 normalization commit (`f08ac98`): `PASS:
      dependency graph identical to baseline`, `542 entries examined`
- [x] A root entry carrying `"resolved": "packages/root"` survives a normalizer run with its key intact — verified
      directly and pinned by a bats case
- [x] Review findings [1.5], [1.9], [1.10], [1.11], [1.12], [1.13] and [1.14] marked resolved in `review.md` — all 15
      findings are now ticked, 0 open
- [ ] `pr-checks.yml` green on PR #163

#### Manual Verification

- [x] The four audit fixes are re-read against the reproductions in the Overview table — each one no longer occurs:
      the root entry keeps `resolved` and the count no longer says 0 about a changed file (N1); the `capture`
      rationale states what jq actually does (N2); a zero-entry lockfile is refused rather than reported compliant,
      with status 2 so the normalizer is not offered as the remedy (N3); a lockfileVersion 1 baseline fails with
      `baseline v1.json is lockfileVersion 1`, no jq trace and no "is fingerprint.jq present?" (N4)
- [x] The fingerprint is byte-identical on all seven branches **after** the `fingerprint.jq` guards — the change most
      able to move the comparison basis, re-measured against the pre-phase transform
- [ ] The tooling digest is recomputed **after** this phase, and it is that digest Phase 7 replicates

---

## Testing Strategy

### Unit / behavioural tests (bats)

- `normalize-lockfile.bats` — rewriting (scoped and unscoped), idempotence, `version`/`integrity`/`dependencies`
  untouched, missing-`resolved` failure, non-tarball-protocol failure, missing-file failure, masking safety.
- `check-lockfile.bats` — the clean case plus all six injected-drift cases (t1–t6), each asserted to fail via the
  *correct* assertion; baseline resolution from a git ref, from `:2:`-style merge stages, and from two explicit file
  paths; a bad baseline ref; masking safety.

Fixtures are tiny hand-written lockfiles from `test-helper.bash` — the tests assert behaviour, not the real file's byte
counts. Byte-level facts are asserted separately against a copy of the real lockfile in Phase 3's success criteria.

### Integration tests

- Phase 3's real-lockfile assertions: 171 rewritten, +4788 bytes, 342 lines, 0 non-`resolved`, byte-identical to a raw
  `sed` rewrite, idempotent.
- Phase 5's `check-lockfile.sh --baseline HEAD~1` against a real two-commit history.
- `pr-checks.yml` running on the introducing PR itself.

### Manual testing steps

1. Reproduce the bug first: with a JFrog `~/.npmrc` active, run `npm ci` in a fresh clone at the pre-fix commit and
   observe the `E404`.
2. Normalize, then re-run `npm ci` in the same environment — it must resolve every package.
3. Simulate a bad merge: hand-edit one `version` in the normalized lockfile, run `check-lockfile.sh --baseline HEAD~1`,
   confirm it exits 1 and names that package path.
4. Simulate the conflict runbook: create a conflict on `package-lock.json`, `git checkout --ours`, re-run the
   normalizer, `check-lockfile.sh --baseline :2:`.
5. Confirm no failure output anywhere contains `cplace.jfrog.io`.

## Performance Considerations

Negligible and worth stating only to rule it out: `jq` processes the 262 KB lockfile in well under a second, and the
`lockfile` guard job runs no `setup-node` and no `npm ci` at all — it is the fastest job in the repo by construction,
which is the point. The `scripts` job pays ~20 s for `apt-get update && apt-get install`.

## Migration Notes

- **Nothing to migrate for consumers.** The four affected composites are unmodified; they simply stop failing once the
  lockfile they `npm ci` is internally consistent.
- **Rollback** is `git revert` of the lockfile commit on the affected branch. The tooling commit is inert on its own —
  reverting it alone would leave a normalized lockfile with no guard, which is safe but pointless.
- **Future upmerge conflicts** on `package-lock.json` have a mechanical resolution, documented in the README:
  `git checkout --ours -- package-lock.json`, re-run the idempotent normalizer, verify with
  `check-lockfile.sh --baseline :2:` (or `:3:`). Never `--theirs`, never a hand edit.
- **A future legitimate `link:`/`file:`/`git+ssh:` dependency** will fail `assert_resolvable`, by design. The failure
  names the package path; loosening the assertion is then a deliberate, reviewed edit rather than a silent pass.

## Success Criteria (ticket-level)

From [design.md](./design.md), verifiable when all seven PRs are merged:

- [ ] `grep -c 'registry.npmjs.org' package-lock.json` returns **0** on all seven branches
- [ ] `check-lockfile.sh --baseline HEAD~1` exits 0 on each branch
- [ ] Each lockfile commit shows exactly **342 changed lines** and **+4788 bytes**, with no non-`resolved` line changed
- [ ] The normalizer is idempotent: a second run rewrites 0 entries and changes 0 bytes
- [ ] The check **fails** on injected drift — poisoned `version`, poisoned `integrity`, changed tarball filename,
      typo'd proxy prefix, an entry left on npmjs — naming the offending package path in each case
- [ ] A consumer-repo canary PR per lockfile state completes the composite's internal `npm ci` on a `use-npmrc` path
- [ ] `pr-checks.yml` fails a PR that reintroduces `registry.npmjs.org`, and its message names the remediation command
- [ ] bats and shellcheck pass in CI on all seven branches
- [ ] `tools/scripts/lockfile/*` and `pr-checks.yml` are byte-identical across all seven branches

## References

- Research: [research.md](./research.md)
- Design: [design.md](./design.md)
- Original ticket: [PFM-ISSUE-34453](https://base.cplace.io/pages/6lxohwjr2a51h39y5idjx6qj2/PFM-ISSUE-34453-github-actions-Normalize-package-lock.json-resolved-URLs-onto-the-JFrog-npm-proxy-release-25.2-master)
- Upstream cause: [`specs/2026-06-05_node24-workflow-migration/design.md`](../2026-06-05_node24-workflow-migration/design.md)
- SHA-pinning convention: [`specs/2026-06-05_node24-workflow-migration/sha-pins.md`](../2026-06-05_node24-workflow-migration/sha-pins.md)
- Non-executing PR template (the `on: pull_request` shape to mirror): `.github/workflow-templates/fe/fe-pr.yml:2-5`
- ~~`fetch-depth: 0` precedent: `.github/workflows/fe-check-upmerge.yml:21`~~ — no longer used; the guard takes no
  baseline (see Key Discovery 6)
- Fail-loudly validator pattern: `tools/scripts/artifacts/utils.ts:309-328`
- Publish target vs. install proxy — must not be confused: `tools/scripts/artifacts/configuration.ts:2`
- The regression's mechanism: `.github/actions/use-npmrc/action.yml:10-14`
- Blocked ticket: PFM-ISSUE-34454
- "Check does not block" precedent: PFM-ISSUE-33179 (`5c4ba52`)
