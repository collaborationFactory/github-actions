---
date: 2026-11-23
ticket: PFM-ISSUE-34293
topic: "Introduce separate JFrog user and token secrets (plain _authToken)"
status: approved-for-planning
research: ./research.md
---

# Separate JFrog User and Token Secrets (plain `_authToken`) - Design Approach

## Overview

Switch npm publish/delete authentication in the shared FE workflows from the combined base64 `_auth` blob (`JFROG_BASE64_TOKEN`) to the standard `//<registry>/:_authToken=${JFROG_TOKEN}` pattern, with the JFrog user and token held as separate, correctly named secrets. The change is shipped as a dual-support window so the 14 workflow-calling FE repos can migrate one by one; a follow-up ticket closes the window.

## Problem Statement

Publish, unpublish, `npm show` and `dist-tag` in the artifacts tooling authenticate via a generated dist `.npmrc` containing `_auth=<JFROG_BASE64_TOKEN>` — a misnamed secret that actually holds `base64(user:secret)`. `JFROG_USER` only feeds a deprecated `email=` line and in several repos does not even match the identity inside the blob. The ticket requires a plain `_authToken` sourced from separate user and token secrets, and retirement of the blob and its name.

The rollout is the hard part, not the code: all callers pass secrets explicitly and default branches follow `@master` live, so any change to required/declared secrets breaks every caller at once ([Research §3–4](./research.md)).

### Requirements
- npm publish auth uses `//<registry>/:_authToken=${JFROG_TOKEN}`.
- JFrog user and token are separate, correctly named secrets.
- `JFROG_BASE64_TOKEN` and the base64 blob are no longer used once repos have migrated.
- `.github/actions/artifacts` (via the TS tooling) and all consuming workflows use the new secrets.

### Constraints
- 14 FE repos pass secrets explicitly (no `secrets: inherit`); defaults follow `@master`, `release/26.4` follows `@release/26.4`.
- `DOT_NPMRC` remains the install / Bryntum / direct-use credential and is not touched here.
- Live testing only on `clone-cplace-fe` → `cplace-npm-test`; never on real `release/*` branches.
- Deprecated `fe-release.yml` / `fe-tag.yml` are still on the live path of every FE repo.

## Design Decisions Summary

1. **Secret naming**: new per-repo `JFROG_TOKEN` holds the token; existing `JFROG_USER` is kept as the user secret and must name the owner of `JFROG_TOKEN`; `JFROG_URL` is unchanged.
   - `JFROG_USER` is no longer needed for npm auth; it is logged as the publishing identity.
   - Fixes today's `JFROG_USER` vs. auth-identity mismatch as part of provisioning.
2. **Token provisioning**: one JFrog reference token per existing service account (deploy, delete, annotate on `cplace-npm-local`), stored as `JFROG_TOKEN` in each repo that account serves.
   - Minting and secret assignment are done by the user with existing token tooling and the maintained token list; no code or workflow involvement.
   - Today's service-account grouping across repos is preserved.
3. **Dist `.npmrc` format (token path)**: exactly two lines — `<scope>:registry=<JFROG_URL>` and `//<host>/<path>/:_authToken=${JFROG_TOKEN}`, with the placeholder written **literally** so npm expands it from the step env.
   - The auth key is derived from `JFROG_URL` normalized to end in exactly one `/`; `JFROG_URL` itself is used unchanged everywhere else, so its stored format does not matter.
   - `always-auth` and `email` are dropped; the legacy `_auth` path stays byte-for-byte unchanged.
4. **Transition mechanics**: dual-support window — `JFROG_TOKEN` and `JFROG_BASE64_TOKEN` both `required: false` in the reusables.
   - Token present → `_authToken` path (legacy ignored); only legacy present → `_auth` path plus a `::warning::` deprecation annotation; neither, in a mode that publishes/deletes → fail fast with a clear error.
   - Callers migrate by replacing their `JFROG_BASE64_TOKEN:` line with `JFROG_TOKEN:`.
   - Removing the fallback and making `JFROG_TOKEN` required is a **follow-up ticket** after all 14 repos have migrated.
5. **Workflow scope**: all seven reusables declaring JFrog secrets (`fe-snapshot`, `fe-pr-snapshot`, `fe-pr-close`, `fe-cleanup-snapshots`, `fe-release-flow`, deprecated `fe-release`, deprecated `fe-tag`), the FE starter templates, and the README.
   - README documents what `JFROG_URL` / `JFROG_USER` / `JFROG_TOKEN` contain, deprecates `JFROG_BASE64_TOKEN`, and states that `DOT_NPMRC` stays for installs.
6. **Release-line reach**: master only; release lines keep working on `JFROG_BASE64_TOKEN`; new lines pick up dual support at branch-off.
7. **`DOT_NPMRC` boundary**: untouched; its future is handled by a separate ticket. No reusable uses `DOT_NPMRC` purely for publishing, so the two are cleanly decoupled.
8. **Validation**: unit tests for selection and format, a live matrix on `clone-cplace-fe` against `cplace-npm-test`, then a pilot on `cplace-remote-filesystem-fe` before the remaining 13 repos.

This means:
- The token never appears in the dist `.npmrc`, its `console.log`, or any artifact — no reliance on secret masking.
- Each FE repo migrates independently with a one-line edit per caller; reverting that edit is the rollback.
- Unmigrated repos are visible as warning annotations in their run summaries.
- A repo with neither secret fails with an explicit error instead of an anonymous npm 401/404.
- npm 11 no longer warns about `always-auth` on the token path.

Major trade-offs we're accepting:
1. Temporary dual path: fallback code and two optional secrets live on master until the cleanup ticket, and GitHub's "required secret missing" check is replaced by our own fail-fast check — in exchange for per-repo, independently reversible migration.
2. Old credential lives on: `JFROG_BASE64_TOKEN` stays in repos as long as release lines reference it — in exchange for not touching release branches at all.
3. `JFROG_USER` becomes metadata: still a secret callers pass, but not used for auth — in exchange for meeting the ticket's "separate user and token secrets" requirement with minimal churn.
4. Deprecated workflows are edited: `fe-release` and `fe-tag` change — in exchange for repos being able to stop using `JFROG_BASE64_TOKEN` before `fe-release-flow` is rolled out.

What we're NOT doing (out of scope):
- Any change to `DOT_NPMRC`, `use-npmrc`, install auth, Bryntum auth, or cplace-fe/project-planning-fe/cplace-e2e direct `DOT_NPMRC` uses (separate ticket). The ticket's "coordinated cutover with `DOT_NPMRC` removal" dependency no longer applies.
- `cplace-e2e` (no `JFROG_*`, does not publish).
- Backporting to `release/26.4` or older lines.
- Removing the legacy fallback / making `JFROG_TOKEN` required (follow-up ticket).
- Deleting `JFROG_BASE64_TOKEN` repo secrets (separate concern, after the last referencing release line is out of support).
- Removing JFrog secrets from `fe-tag` (it does not need them, but dropping declarations would break callers).
- Rolling out `secrets: inherit` to callers (PFM-ISSUE-34283/34287 track).
- Minting tokens or setting secrets (done by the user with existing tooling).

Success criteria:
- On `clone-cplace-fe`, with only `JFROG_TOKEN` set: snapshot publish, PR-snapshot publish/replace (incl. `npm show`), PR-close unpublish, release-flow publish + dist-tag promote, and cleanup-snapshots delete all succeed, and no log line contains the token value.
- With only `JFROG_BASE64_TOKEN` set, the same flows still succeed and show the deprecation annotation; with neither set, the run fails fast with the explicit error.
- The pilot `cplace-remote-filesystem-fe` publishes successfully from master after switching to `JFROG_TOKEN`.
- A cross-repo search of the 14 FE repos' default branches finds no `JFROG_BASE64_TOKEN` reference — the entry condition for the cleanup ticket.

## Design Decisions - Details

### 1. Secret naming and semantics

**Chosen Approach:** `JFROG_TOKEN` + keep `JFROG_USER`

**Rationale:** Matches the ticket's `${JFROG_TOKEN}` pattern literally; `JFROG_USER` is already correctly named and passed everywhere, so callers change one line per call. With `_authToken` the user is not needed for npm auth; it remains the documented owner of the token and is logged as the publishing identity.

**Alternatives Considered:**
- **New namespaced pair `JFROG_NPM_USER` / `JFROG_NPM_TOKEN`**: Rejected because it deviates from the ticket's name and doubles the per-repo secrets and caller edits, plus a second retirement cycle for `JFROG_USER`.
- **Reuse org-level `ENV_CPLACE_ARTIFACTORY_ACTOR` / `_TOKEN`**: Rejected because it collapses all repos onto one org-wide identity with unknown rights on `cplace-npm-local`, owned and rotated outside this workstream, and deviates from per-repo secret storage.

**Implications:**
- `JFROG_USER` must be set to the token's owner during provisioning (fixes office-reports/workflow/project-planning mismatches).

---

### 2. Token type and provisioning

**Chosen Approach:** One reference token per existing service account

**Rationale:** Reference tokens via `_authToken` are already proven on this JFrog instance (`cplace-e2e`, `resource-management-fe` `DOT_NPMRC`). Keeping today's account grouping changes nothing about who can publish what, and the switch doubles as a credential rotation. The user mints tokens and sets secrets with existing tooling and maintains the token list (incl. expiry/rotation).

**Alternatives Considered:**
- **Reuse the secret inside `JFROG_BASE64_TOKEN`**: Rejected because it only works if that secret is a token (not a password), would require decoding secrets outside GitHub, and carries an old credential forward instead of rotating it.
- **One dedicated publish account for all FE repos**: Rejected because it removes per-account separation (one leak affects all repos) and needs new JFrog account/permission setup.

**Implications:**
- Each token needs deploy, delete and annotate (dist-tag) on `cplace-npm-local`; the `clone-cplace-fe` token needs the same on `cplace-npm-test`.

---

### 3. Generated dist `.npmrc` format

**Chosen Approach:** Literal `${JFROG_TOKEN}`, normalized key, minimal lines

**Rationale:** Writing the placeholder literally keeps the token out of the dist file and the `console.log` at `nx-project.ts:306` (research open question 9). npm looks up credentials by the registry's nerf-dart with a trailing slash, so the key is normalized to end in exactly one `/` regardless of the `JFROG_URL` secret's format; `JFROG_URL` itself stays unchanged for `<scope>:registry=`, `publishConfig.registry` and `--registry=`, so whatever works today keeps working. `always-auth` is removed in current npm and `email` has no role with tokens.

**Alternatives Considered:**
- **Write the expanded token value**: Rejected because the token would sit in the dist file and logs, relying solely on GitHub masking, and it contradicts the ticket's pattern.
- **Keep `always-auth` / `email` on the token path**: Rejected because it carries deprecated config and npm 11 warnings into the new format.

**Implications:**
- All npm calls running in the dist `cwd` must have `JFROG_TOKEN` in env — true today since they run inside the same composite step; the token line is only written when the token is present, avoiding npm's "Failed to replace env in config" error.
- Unit tests must cover `JFROG_URL` with and without a trailing slash.
- The legacy `_auth` output (and `test-data.ts:84-88` fixture) remain byte-for-byte unchanged.

---

### 4. Transition mechanics

**Chosen Approach:** Token wins; legacy fallback with deprecation annotation; fail fast on missing credentials

**Rationale:** Explicit secret passing plus `@master` tracking means any required/declared change breaks callers at once (34282 open question #10). Making both secrets optional lets each repo migrate independently; the annotation makes progress visible; the fail-fast check restores the protection lost by dropping `required: true` (today credentials silently default to `''`).

**Alternatives Considered:**
- **Silent fallback, no annotation, no fail-fast**: Rejected because migration tracking would require manual greps across 14 repos and a repo with neither secret would fail late with an opaque npm auth error.

**Implications:**
- Per-repo migration = set `JFROG_TOKEN` secret, then replace `JFROG_BASE64_TOKEN:` with `JFROG_TOKEN:` in each caller.
- Follow-up cleanup ticket (after all 14 repos migrated): remove fallback, drop `JFROG_BASE64_TOKEN` declarations, make `JFROG_TOKEN` required.
- The fail-fast applies only to modes that publish or delete; `ONLY_BUMP_VERSION` (`fe-tag`) must not fail on missing credentials.

---

### 5. Workflow scope

**Chosen Approach:** All seven JFrog-declaring reusables + templates + README

**Rationale:** Deprecated `fe-release` / `fe-tag` are still called from every FE repo's default branch; leaving them on a required `JFROG_BASE64_TOKEN` would block the acceptance criterion until `fe-release-flow` is rolled out everywhere. Uniform treatment keeps the caller edit mechanical.

**Alternatives Considered:**
- **Only non-deprecated reusables**: Rejected because repos could not stop passing `JFROG_BASE64_TOKEN`, coupling this ticket to the release-flow rollout.
- **Remove JFrog secrets from `fe-tag` entirely**: Rejected because callers still pass them and would break immediately (34282 #10 failure mode); needs its own transition.

**Implications:**
- Each reusable's `env:` into `artifacts`/`snapshots` passes both `JFROG_TOKEN` and `JFROG_BASE64_TOKEN`.
- Templates `fe-main.yml`, `fe-pr-snapshot.yml`, `fe-pr-close.yml`, `fe-cleanup-snapshots.yml` pass `JFROG_TOKEN`; `fe-release.yml` (inherit) unchanged.
- README "Required secrets" explains each JFrog secret's content, marks `JFROG_BASE64_TOKEN` deprecated, and notes `DOT_NPMRC` stays for installs.

---

### 6. Release-line reach

**Chosen Approach:** Master only

**Rationale:** Follows the 34283/34282 precedents; release lines keep working unchanged, and no live testing on release branches is needed. New release lines inherit dual support at branch-off via cf-devkit ref rewriting.

**Alternatives Considered:**
- **Backport to `release/26.4` and older lines**: Rejected because it multiplies PRs (one per `github-actions` line plus release-branch caller edits in 14 repos) and those branches cannot be live-tested.

**Implications:**
- `JFROG_BASE64_TOKEN` repo secrets must stay until the last referencing release line is out of support; deleting them is a separate concern.

---

### 7. `DOT_NPMRC` boundary

**Chosen Approach:** Leave `DOT_NPMRC` untouched; record the decoupling

**Rationale:** No reusable uses `DOT_NPMRC` purely for publishing (`fe-snapshot` has no `use-npmrc`; every other publishing workflow also runs `npm ci` or cleanup lookups). `DOT_NPMRC` remains the install, Bryntum and direct-use credential and is handled by a separate existing ticket.

**Alternatives Considered:**
- **Also derive JFrog install auth from `JFROG_USER`/`JFROG_TOKEN`**: Rejected because it widens scope to every `npm ci` across 14 repos, needs read rights on the `cplace-npm` virtual repo for publish tokens, and overlaps the separate `DOT_NPMRC` ticket.

**Implications:**
- The ticket's "coordinated cutover with `DOT_NPMRC` removal" dependency no longer applies.

---

### 8. Validation

**Chosen Approach:** Unit tests + live matrix on `clone-cplace-fe` + pilot on `cplace-remote-filesystem-fe`

**Rationale:** Unpublish and dist-tag with Bearer auth are the least proven parts; the clone harness exercises every dist-`.npmrc` npm command without touching real packages, under the established JFrog safety rules (own versions only, exact paths, show hits before delete).

**Alternatives Considered:**
- **Unit tests, then pilot directly on a real FE repo**: Rejected because the first live unpublish/dist-tag with `_authToken` would hit real `cplace-npm-local` packages, departing from 34282/34283 practice.

**Implications:**
- Unit: legacy fixture unchanged; new token fixture; selection cases (token only / legacy only + warning / both → token / neither → fail fast); key normalization with and without trailing slash; file contains literal `${JFROG_TOKEN}`, never the value.
- Live: legacy-only, token-only, and neither scenarios on `clone-cplace-fe` with callers pointed at the feature-branch ref; changing the clone repo's secrets requires the user's consent.
- Pilot `cplace-remote-filesystem-fe` after merge, then remaining 13 repos.

---

## Overall Architecture

Install auth and publish auth stay separated. `DOT_NPMRC` → `use-npmrc` → `~/.npmrc` continues to serve installs. The publish side gains a second credential mode: the TS tooling selects `_authToken` when `JFROG_TOKEN` is present and falls back to the legacy `_auth` otherwise, writing the corresponding per-project dist `.npmrc`.

### Key Components
1. **`JfrogCredentials` (`tools/scripts/artifacts/jfrog-credentials.ts`)**: reads `JFROG_TOKEN` in addition to the existing vars; decides the credential mode; derives the trailing-slash auth key; reports missing credentials.
2. **`writeNPMRCInDist` (`nx-project.ts:293-313`)**: writes the two-line token `.npmrc` (literal placeholder) or the unchanged legacy four-line one; logs the publishing identity, never a token.
3. **Artifacts entry points (`artifacts-handler.ts`, `cleanup-snapshots.ts`)**: emit the deprecation annotation on the legacy path and fail fast when a publish/delete mode has no credentials.
4. **Reusable workflows (7)**: declare `JFROG_TOKEN` and `JFROG_BASE64_TOKEN` as optional and pass both into the composite step env.
5. **Templates + README**: show callers the new secret and document the secrets contract.

### Data Flow
Repo secrets (`JFROG_URL`, `JFROG_USER`, `JFROG_TOKEN` | `JFROG_BASE64_TOKEN`) → caller workflow (explicit `secrets:`) → reusable workflow → step `env:` of `artifacts`/`snapshots` composite → `JfrogCredentials` → dist `.npmrc` (`_authToken=${JFROG_TOKEN}` literal) → `npm publish/show/unpublish/dist-tag` in dist `cwd`, where npm expands the placeholder from the same step env and sends `Authorization: Bearer`.

### Integration Points
- 14 FE repos' caller workflows (one-line swap per call, after the repo secret exists).
- JFrog `cplace-npm-local` (prod) and `cplace-npm-test` (validation) — Bearer auth via reference tokens.
- User's token tooling and token list (provisioning, rotation).

## Known Risks

1. **Bearer auth lacks a needed right (e.g. unpublish/annotate) for a reference token**: Mitigation — live matrix on `clone-cplace-fe` covers every command before any real repo switches; token scopes listed in Decision 2.
2. **npm call in dist `cwd` runs without `JFROG_TOKEN` in env** ("Failed to replace env in config"): Mitigation — token line only written when the token is present; all such calls stay inside the composite step; covered by live matrix.
3. **Caller passes a secret the callee no longer declares** (34282 #10 failure mode): Mitigation — no declarations are removed in this ticket; removal happens only in the cleanup ticket after a cross-repo search shows zero references.
4. **Fail-fast misfires in a mode that needs no credentials** (`fe-tag` `ONLY_BUMP_VERSION`): Mitigation — fail-fast scoped to publish/delete modes; unit test for bump-only with no credentials.
5. **Window never closes**: Mitigation — deprecation annotations make stragglers visible; follow-up cleanup ticket with an explicit entry condition.

## Next Steps

1. Review this design document
2. Refine if needed based on feedback
3. Create the follow-up cleanup ticket (remove fallback, make `JFROG_TOKEN` required)
4. Proceed to implementation planning: `/spec-driven-development:create_plan specs/2026-11-23_PFM-ISSUE-34293_jfrog-authtoken-separate-secrets/design.md`

## References

- Original ticket: [PFM-ISSUE-34293](https://base.cplace.io/pages/writuvh8xnwnf0bzeo6c6u2hc/PFM-ISSUE-34293-Introduce-separate-JFrog-user-and-token-secrets-plain-auth-token)
- Related research: [Research](./research.md)
- Related ticket: PFM-ISSUE-33675 (standardize JFrog npm read and publish auth); separate `DOT_NPMRC` ticket
- Precedents: `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/design.md`, `specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/`, `specs/2026-06-05_node24-workflow-migration/`
- Similar code: `tools/scripts/artifacts/nx-project.ts:293-313`, `tools/scripts/artifacts/jfrog-credentials.ts`
