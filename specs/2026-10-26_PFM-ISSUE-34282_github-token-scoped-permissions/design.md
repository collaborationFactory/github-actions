---
date: 2026-11-11
branch: improvement/PFM-ISSUE-34282-Use-GITHUB_TOKEN-with-scoped-permissions-for
git_commit: 87feb8e4218d9fe87791883f9f683ddca3106e05
topic: "PFM-ISSUE-34282 - Use GITHUB_TOKEN with scoped permissions for in-repo tag and release"
tags: [design, github-actions, fe-release-flow, github-token, permissions, pat]
status: draft
---

# Use GITHUB_TOKEN with scoped permissions for in-repo tag and release - Design Approach

## Overview

The consolidated FE release flow (`fe-release-flow.yml`, PR #183) pushes its `version/X.Y.Z` tag with the built-in `GITHUB_TOKEN` instead of the shared user PAT. The `release` job gets `contents: write` and nothing else. The PAT secret is dropped from the flow's contract. The docs that describe the PAT-pushed tag are reworded.

## Problem Statement

After #183, the shared user PAT is used for tagging/releasing in one place: the `release` job checks out with `token: ${{ secrets.GIT_USER_TOKEN }}` (`fe-release-flow.yml:121`). Checkout persists it in `.git/config`. The artifacts tool's `git push origin <tag>` (`artifacts-handler.ts:313`) and the cleanup's `git ls-remote --exit-code` (`fe-release-flow.yml:176`) use it implicitly. The PAT's original purpose, making the tag push start the second run, disappeared with #183. What remains is a broad, long-lived, cross-repo credential next to `npm ci` and the artifacts tool.

### Requirements
- In-repo tag and GitHub release authenticate with `GITHUB_TOKEN`.
- Write scope is granted per job, only where it has a consumer. Build/test/install jobs keep `contents: read`.
- Scopes without a consumer (`checks`, `pull-requests`, `issues`, `actions`) are not granted.
- The shared user PAT is no longer used or required by the tag/release path.

### Constraints
- The caller's `permissions:` is a ceiling. Migrated callers grant `contents: write` only (template `fe-release.yml:18-19`). Requesting more fails every migrated consumer at startup.
- Callers use `secrets: inherit`, so removing a declared secret needs no caller edit.
- Inside `release` the order is publish → promote → tag. A rejected tag push is the most expensive failure: the version is unpublished and `release-X.Y` is lost on every promoted package until the next release.
- The deprecated `fe-tag.yml` / `fe-release.yml` reusables must keep working for unmigrated consumers (cplace-fe, 2lforge, release lines 25.4-26.4).
- Retiring `GIT_USER` / `GIT_USER_EMAIL` is PFM-ISSUE-34286 scope.

## Design Decisions Summary

1. **Permissions: `contents: write` only on `release`**: the job moves from `contents: read` to `contents: write`; no other scope is added anywhere.
   - `github-release` stays `contents: write`; `guard`, `install-deps`, `build`, `e2e` stay `contents: read`.
   - The ticket's "baseline" (`checks: write`, `pull-requests: write`) and the "confirm" scopes (`issues: read`, `actions: write`) are dropped: none has a consumer. The ticket text is updated to match.
2. **Credential: persisted default token**: the `release` checkout drops `token:` and persists `github.token`, as `fe-snapshot.yml` does since 34285.
   - The `GIT_USER_TOKEN` declaration is removed from `workflow_call.secrets`.
   - The artifacts tool and the cleanup's `ls-remote` are unchanged; they use whatever checkout persisted.
3. **No early push-rights check; document the ruleset requirement**: a `version/*` tag ruleset must list GitHub Actions as a bypass actor, otherwise a release fails after promote.
   - The note goes into the README and onto 34283's Q10 (the unowned tag-ruleset item, `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/design.md:97`).
4. **Git identity stays for 34286**: the "Configure git user" step and the `GIT_USER` / `GIT_USER_EMAIL` declarations are untouched.
5. **Main chain unchanged**: the `fe-main.yml` template keeps its four-scope block. Follow-up PFM-ISSUE-35504 moves all seven FE templates to least privilege.
6. **Docs and guard reworded, guard logic unchanged**: the template header, README migration note, secrets list and release section describe the `GITHUB_TOKEN` tag push.
   - Old callers must still be deleted in the migration commit: a tag-push caller would publish manually pushed tags; an old `fe-tag.yml` caller would tag in parallel with the PAT.
   - Only the guard's comment changes; its check stays as validated in 34283 A1-A12.

This means:
- A tag pushed by the flow starts no workflow. A tag-push caller left in a migrated tree can no longer re-publish the flow's own tags.
- Migrated consumers need no change: the template's `contents: write` ceiling and `secrets: inherit` already cover the switch.
- A repo can drop `GIT_USER_TOKEN` once all its branches run the new flow; `GIT_USER*` follow with 34286.
- Unmigrated consumers on the deprecated reusables keep the PAT and keep working.
- The live test plan's open points are settled: T1 expects `release` = `Contents: write` only; T3 and the `GIT_USER*` part of R6 do not apply; M1 is a plain regression check; open point 4 (credential isolation) is dropped.

Major trade-offs we're accepting:
1. Write token next to third-party code: `npm ci` and the artifacts tool in the `release` job can read the persisted `GITHUB_TOKEN`. We give up full isolation and gain a three-line change that keeps #183's validated one-job publish/promote/tag/cleanup design. The exposure is still far smaller than the PAT's (this repo only, `contents` only, expires with the job).
2. Late ruleset rejection: a future `version/*` ruleset without an Actions bypass would reject the push after publish and promote. We rely on documentation instead of a pre-check that a dry-run probably cannot provide and a ruleset query would need extra scope for.
3. Unused shared-account secrets remain required: `GIT_USER` / `GIT_USER_EMAIL` stay declared until 34286, so the flow is not yet free of the shared account.
4. Deviation from the ticket's literal baseline: we follow its "drop any without a consumer" requirement over its listed baseline, and update the ticket text.

What we're NOT doing (out of scope):
- Isolating the write token from third-party code (`persist-credentials: false` with a push-only credential, or a separate tag-push job).
- A pre-publish push-rights or ruleset check.
- Removing the git identity step or `GIT_USER` / `GIT_USER_EMAIL` (PFM-ISSUE-34286).
- Narrowing `fe-main.yml` or the other FE templates' permissions (follow-up PFM-ISSUE-35504), including the stale `actions: write` in cplace-fe `push_main.yaml`.
- Changing the deprecated `fe-tag.yml` / `fe-release.yml` reusables.
- The backend's credential-store approach (`prepare-git-environment`).
- JFrog secret changes.

Success criteria:
- A push release in `clone-cplace-fe` tags and releases with no PAT: no canary run for the new tag, `release` job log shows `Contents: write` / `Metadata: read` only, no auth errors (live test R1, T1-T2, E7 Phase B).
- The failure cleanup still reads the remote: `ls-remote` exit code 2 and the unpublish run after a forced publish failure (R3).
- A migrated caller with the unchanged template starts without startup failure, and a release succeeds with the `GIT_USER_TOKEN` secret deleted (R0, R6).
- `git grep GIT_USER_TOKEN` finds nothing in `fe-release-flow.yml`; the deprecated reusables are byte-identical to PR #183.

## Design Decisions - Details

### Permission set of the `release` job

**Chosen Approach:** `contents: write` only.

**Rationale:** The only write consumers in the release chain are the tag push and `gh release create`, both under `contents`. Nothing in `fe-release-flow.yml`, the nested `fe-install-deps` / `fe-build` / `fe-e2e` workflows or the composite actions calls the Checks, Pull Requests, Issues or Actions APIs ([research §3](./research.md)). The ticket's baseline comes from the four-scope boilerplate in the other FE templates. Its own third requirement asks to drop scopes without a consumer.

**Alternatives Considered:**
- **Ticket baseline (`contents` + `checks` + `pull-requests` write)**: Rejected because it grants unused scopes to a job that runs third-party code, and every migrated caller would have to raise its ceiling or fail at startup.

**Implications:**
- The ticket's Requirements section is updated to state `contents: write` only and record why the other scopes were dropped.
- The caller template's `permissions: contents: write` stays as the ceiling.

---

### Write-credential handling inside the `release` job

**Chosen Approach:** Persisted default credential: checkout without `token:`, `fetch-depth: 0` kept.

**Rationale:** The smallest change that removes the PAT, matching the 34285 precedent (`fe-snapshot.yml`) and every other FE checkout. The push and the cleanup's `ls-remote` keep working without touching the TS tool. `GITHUB_TOKEN` is limited to this repository and `contents`, and expires with the job.

**Alternatives Considered:**
- **`persist-credentials: false` with the token injected only into the artifacts and cleanup steps**: Rejected because the artifacts action itself runs `npm ci` and ts-node with the token in env, so it isolates almost nothing, and it adds token handling to a tool that has none.
- **Tag push in a separate job without npm**: Rejected because it breaks #183's one-job publish → promote → tag → cleanup design (cross-job cleanup, more complex re-runs) and would invalidate the 34283 live validation. Listed as out of scope.

**Implications:**
- `npm ci` and the artifacts tool can read a write-capable token during the job (trade-off 1).
- If an implementation step ever drops the persisted credential, the cleanup fails loudly ("Could not check whether … is pushed") instead of unpublishing.

---

### Early check of push rights

**Chosen Approach:** No pre-check; document that a `version/*` tag ruleset needs GitHub Actions as bypass actor.

**Rationale:** A missing grant is already caught early (the caller ceiling at startup; the job grant is static). The only realistic late rejection is a future tag ruleset, which does not exist today in cplace-fe or clone-cplace-fe. GitHub evaluates rulesets on the actual ref update, so a `git push --dry-run` most likely would not detect one (not verified live).

**Alternatives Considered:**
- **`git push --dry-run` of the tag before publishing**: Rejected because it likely does not catch ruleset rejections, and the tag name is computed inside the TS tool.
- **Query repository rulesets before publishing**: Rejected because org rulesets and bypass evaluation make it fragile, and reading bypass actors may need scope beyond `contents`.

**Implications:**
- README: a ruleset note next to the Recovery section.
- 34283 design Q10 (`design.md:97`): the same note, so whoever takes up the ruleset sees it.

---

### Git identity and `GIT_USER` / `GIT_USER_EMAIL`

**Chosen Approach:** Leave them for PFM-ISSUE-34286.

**Rationale:** The tag is lightweight and no commit is made, so the identity is unused but harmless. 34286 exists to retire `GIT_USER*` across all FE workflows in one pass. Keeping 34282 to the token keeps review and live validation focused.

**Alternatives Considered:**
- **Remove the step and declarations in 34282**: Rejected because it takes 34286 scope for no functional gain.

**Implications:**
- Live test rule T3 and the `GIT_USER*` part of R6 do not apply.
- The README secret list keeps `GIT_USER` / `GIT_USER_EMAIL`.

---

### Main chain permissions (`fe-main.yml` template)

**Chosen Approach:** Unchanged in 34282; follow-up PFM-ISSUE-35504 covers all FE templates.

**Rationale:** The ticket covers the tag/release path. The four-scope block appears in seven FE templates, at least one with a real consumer (`fe-pr-snapshot.yml:76-88`), so a single audit is cleaner than narrowing one. A template change only reaches consumers when they re-copy it.

**Alternatives Considered:**
- **Narrow `fe-main.yml` to `contents: read` in 34282**: Rejected because it extends the ticket scope and leaves six templates inconsistent.

**Implications:**
- Follow-up PFM-ISSUE-35504: least-privilege `permissions:` for all FE templates, plus the stale `actions: write` in cplace-fe `push_main.yaml`.
- Live test M1 is a regression check only.

---

### Docs, template header and guard wording

**Chosen Approach:** Reword all PAT references; keep the guard check and the "delete old callers in the same commit" rule.

**Rationale:** After the switch, the flow's own tags no longer re-fire tag-push callers, but two reasons to delete old callers remain: a tag-push caller would still publish manually pushed tags, and an old `fe-tag.yml` caller would tag in parallel with the PAT.

**Alternatives Considered:**
- **Relax the guard to `fe-tag.yml` callers only**: Rejected because a leftover tag-push caller can still double-publish a manually pushed `version/*` tag, and it changes validated logic for no safety gain.

**Implications:**
- `.github/workflow-templates/fe/fe-release.yml:1-5`: new header (no "still pushes the tag with the PAT", no "34282 removes …").
- `README.md:54-59` migration note, `:84-88` secrets list without `GIT_USER_TOKEN`, `:146` "tag and GitHub release are created with `GITHUB_TOKEN`".
- `fe-release-flow.yml:59-61` guard comment.
- Migrated branches keep the old header comment until re-copied; harmless.

---

## Overall Architecture

The job structure of #183 stays. One job's scope changes, one secret leaves the contract, and the docs follow.

### Key Components
1. **`fe-release-flow.yml` `release` job**: `permissions: contents: write`; checkout without `token:`; identity step unchanged; publish → promote → tag → cleanup unchanged.
2. **`fe-release-flow.yml` secret contract**: `GIT_USER_TOKEN` removed; `GIT_USER`, `GIT_USER_EMAIL`, JFrog, `DOT_NPMRC`, `PERCY_TOKEN` unchanged.
3. **Caller template `fe-release.yml`**: `contents: write` ceiling and `secrets: inherit` unchanged; header comment rewritten.
4. **README / guard comment / 34283 Q10**: wording and the ruleset note.

### Data Flow
`actions/checkout` persists `github.token` (job scope `contents: write`) → the artifacts tool publishes and promotes on JFrog (JFrog credentials) → `git push origin version/X.Y.Z` with the persisted token, which triggers no workflow → on failure, `git ls-remote --exit-code` with the same token decides the unpublish → `github-release` creates the release with its own `github.token`.

### Integration Points
- Migrated consumers: unchanged callers (template ceiling `contents: write`, `secrets: inherit`).
- Unmigrated consumers: the deprecated `fe-tag.yml` / `fe-release.yml` reusables, untouched and still PAT-based.
- Repository rulesets: none today; a future `version/*` ruleset needs a GitHub Actions bypass.

## Known Risks

1. **Compromised dependency with a write token**: code run by `npm ci` or the artifacts tool could push to this repo during the job. Mitigation: the token is limited to `contents` on one repo and expires with the job; full isolation is listed out of scope and can be its own ticket.
2. **Future tag ruleset rejects the push after promote**: the version is unpublished and `release-X.Y` is lost until the next release. Mitigation: README and 34283 Q10 note; README Recovery already covers restoring `release-X.Y`.
3. **A consumer branch mixes the old and new flow**: an unmigrated branch keeps needing `GIT_USER_TOKEN`. Mitigation: the secret is only deleted per repo once no branch uses the deprecated reusables; README says so.
4. **The dry-run assumption is unverified**: if a dry-run did detect ruleset rejections, a cheap pre-check would have been possible. Mitigation: revisit together with Q10 if a ruleset is planned.

## Next Steps

1. Review this design document
2. Done: PFM-ISSUE-34282 ticket text updated (permission baseline); follow-up PFM-ISSUE-35504 created
3. Proceed to implementation planning: `/spec-driven-development:create_plan specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/design.md`

## References

- Original ticket: [PFM-ISSUE-34282](https://base.cplace.io/pages/p9vu89ujy61fxb2nrrp6focwy/PFM-ISSUE-34282-Use-GITHUB-TOKEN-with-scoped-permissions-for-in-repo-tag-and-release)
- Related research: [Research](./research.md)
- Live test plan: [live-test-plan.md](./live-test-plan.md)
- Base design: [34283 design](../2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/design.md)
- Similar change: PFM-ISSUE-34285 (commit faa4771, `fe-snapshot.yml` without `GIT_USER_TOKEN`)
- Backend pattern: `cplace-gh-workflows` commit 18ea38f3 (PAT removed, `GITHUB_TOKEN` tag push)
