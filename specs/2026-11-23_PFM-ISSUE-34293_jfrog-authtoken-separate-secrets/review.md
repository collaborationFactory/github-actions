# Code Review: Separate JFrog User and Token Secrets (plain `_authToken`)

## Iteration 1 — 2026-11-25

*Reviewed `origin/master...HEAD` (23 files) against `plan.md`. The test branch `test/PFM-ISSUE-34293-jfrog-token` was not used as the baseline because it was branched from this branch. Agents: plan-conformance, correctness, craft, test, security. plan-conformance, correctness and security returned nothing. 4 findings kept, 0 dropped in verification, 0 merged.*

### [1.1] 💡 Credential gate branches for force and non-release bump-only runs are untested

- [ ] Resolved

**Agent(s):** test

**File(s):**
- [artifacts-handler.ts:147](/tools/scripts/artifacts/artifacts-handler.ts#L147)
- [artifacts-handler-release-flow.test.ts:291](/tools/scripts/artifacts/artifacts-handler-release-flow.test.ts#L291)

The new tests cover three outcomes of `requiresPublishCredentials()`. A release flow on `release/*` without credentials fails. A non-forced release flow on the default branch needs no credentials. A bump-only run on `release/*` needs no credentials. Two cases have no test. A **forced** release flow on the default branch without credentials should fail. `onlyBumpVersion` on a non-release branch should still require credentials. A regression in either case would let a publish start with no credentials, or block a legitimate no-op run.

### [1.2] 💡 Credential gate re-derives handle()'s dispatch in a second place

- [ ] Resolved

**Agent(s):** craft

**File(s):**
- [artifacts-handler.ts:129](/tools/scripts/artifacts/artifacts-handler.ts#L129)
- [artifacts-handler.ts:148](/tools/scripts/artifacts/artifacts-handler.ts#L148)

`requiresPublishCredentials()` says it "mirrors the dispatch in handle()", which makes it a second copy of the release-flow, release-branch, force and bump-only conditions. If `handle()` changes and the copy is not updated, the gate either skips a needed check or demands credentials where none are needed. Calling `requireForPublishing()` at the start of each publishing or deleting path would remove the copy; the release-flow path could call it after its no-op check.

### [1.3] 💡 Credential-mode branching and a per-project log line inside the .npmrc writer

- [x] Resolved — removed getAuthKey() so both auth modes key the .npmrc with getJfrogUrlNoHttp(), because npm-registry-fetch walks the registry URL prefix by prefix (trailing slash included) and so matches either key form, which makes design decision 3's trailing-slash premise unnecessary; the .npmrc building and the per-project log line stay in NxProject by choice.

**Agent(s):** craft

**File(s):**
- [nx-project.ts:294](/tools/scripts/artifacts/nx-project.ts#L294)
- [nx-project.ts:300](/tools/scripts/artifacts/nx-project.ts#L300)

`NxProject` now knows the `.npmrc` format of each auth mode. `JfrogCredentials` already owns the URL and key helpers, so building the credential lines would fit better there. The "Publishing as JFrog user …" line runs once per project, so a run that publishes many projects repeats it (×21 in the Phase 1 smoke run). The token branch builds its key with `getAuthKey()` and the legacy branch with `getJfrogUrlNoHttp()`, which is easy to miss when reading.

### [1.4] 💡 Ticket id in a user-facing warning message

- [x] Resolved — dropped the ticket id from LEGACY_WARNING without adding a link, since the message already names the secret to set and what to pass instead.

**Agent(s):** craft

**File(s):**
- [jfrog-credentials.ts:10](/tools/scripts/artifacts/jfrog-credentials.ts#L10)

`LEGACY_WARNING` puts the internal ticket id `PFM-ISSUE-34293` into a CI annotation that consuming repositories see. Pointing to the README's "JFrog and npm secrets" migration section instead would give a repo owner a step they can act on.
