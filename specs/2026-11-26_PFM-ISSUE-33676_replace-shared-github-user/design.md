# Replace shared GitHub user account in frontend workflows (PFM-ISSUE-33676) - Design Approach

## Overview

Remove the last places where the shared GitHub user account (`GIT_USER_TOKEN`, `GIT_USER`, `GIT_USER_EMAIL`, actor `squad-fe`) authenticates or identifies FE workflow activity:

- **In this repo:** the remaining uses are git identity only. They move to a fixed `github-actions[bot]` identity set in the workflow, and the secret declarations become optional.
- **In cplace-fe:** the one remaining real PAT use, the visual-baseline heal push to protected branches, moves to the existing `sva-actions-upmerge` GitHub App.
- **Verification:** the result is checked in `clone-cplace-fe` with the shared-account secrets deleted.

## Problem Statement

The FE workflows still depend on a shared GitHub user account. That is a shared credential with rotation, audit and blast-radius risk. PFM-ISSUE-34282, -34283 and -34285 already moved tag creation, GitHub release creation and snapshot checkout to `GITHUB_TOKEN`. What is left:

- U5: the release-flow git identity
- U6: the upmerge-check git identity
- U9: the README
- uses in consumer repos that the research did not cover

See [Research](./research.md) for the full inventory.

### Requirements
- Map every current use of the shared account to its replacement: `GITHUB_TOKEN` with permissions, or a GitHub App (AC1).
- Implement the replacement and verify it in a reference FE repository (AC2).
- Stop using the shared account in that reference repository, including its `GIT_USER*` repo secrets (AC3).

### Constraints
- **The caller's permissions are a ceiling.** Reusable workflows may only narrow them.
- **Explicit secret passing is strict.** Callers that pass secrets one by one fail when they pass a secret the reusable workflow no longer declares. Four consumer repos pass `GIT_USER*` to `fe-check-upmerge.yml`, and 14 pass them to `fe-tag.yml`.
- **The old and new release flows run side by side.** `fe-tag.yml` needs its PAT so that the tag push triggers the legacy `fe-release.yml`.
- **Neighbouring tickets own adjacent work:**
  - Least-privilege caller templates: PFM-ISSUE-35504.
  - Consumer migration and deleting `fe-tag.yml`/`fe-release.yml`: the migration/cleanup ticket.

## Design Decisions Summary

1. **Bot identity set in the workflow (U5, U6)**: `fe-check-upmerge.yml` and `fe-release-flow.yml` each set `github-actions[bot]` / `41898828+github-actions[bot]@users.noreply.github.com` in a workflow step, with quoted values.
   - `upmerge.ts` no longer sets a git identity. Its unquoted `git config --global` calls go away with it.
   - U5 belongs to this ticket. It is not related to PFM-ISSUE-34286.
2. **Secret declarations stay, but optional**: `GIT_USER` and `GIT_USER_EMAIL` remain in `workflow_call.secrets` of both workflows. They become `required: false`, are no longer read, and carry a comment marking them for removal in the migration/cleanup ticket.
   - The upmerge caller template stops passing `GIT_USER*`. Its `permissions:` stay as they are (PFM-ISSUE-35504).
   - README "Required secrets" drops `GIT_USER*`. `GIT_USER_TOKEN` stays documented only as long as a repo still has callers of `fe-tag.yml`/`fe-release.yml`.
3. **Heal-visual-baselines push uses `sva-actions-upmerge` (cplace-fe)**: `heal-visual-baselines.yml` mints a short-lived token with `actions/create-github-app-token`. The token is limited to `cplace-fe` with `contents: write`. It is used for the checkout and the push that today uses `GIT_USER_TOKEN`.
   - The App is already a bypass actor on the `product-fe` ruleset (default branch and `release/*`), and its org secrets `SVA_ACTIONS_UPMERGE_ID`/`_KEY` are already visible to cplace-fe. No new App or ruleset is needed.
   - The heal commit is authored as `sva-actions-upmerge[bot]` / `278916743+sva-actions-upmerge[bot]@users.noreply.github.com`. The `BOT_EMAIL` env line is dropped, because upmerge commits are written by people and the gate already treats an empty value as "no bot".
4. **Storybook identity (cplace-fe)**: `deploy_storybook.yaml` replaces the hard-coded `git config user.name squad-fe` with the `github-actions[bot]` identity. Its push already uses `GITHUB_TOKEN`.
   - The cplace-fe changes (3, 4) are a separate PR on `main` only. Release lines are not changed, following the 34281 decision of 2026-10-22.
5. **Cross-repo checkout (U8) is already done**: the only cross-repo checkout across the 15 FE repos is cplace-fe's devkit e2e (`devkit-test-template.yaml` and its 6 callers). PFM-ISSUE-34281 already moved it to `sva-actions-read-product-fe`. No other repo needs the read App.
6. **Side fixes in the upmerge files**: delete the undeclared `ref: ${{ inputs.GHA_REF }}` from `fe-check-upmerge.yml`. The behavior stays the same: the default branch is checked out.
   - `printenv` in `.github/actions/upmerge/action.yml` stays.
   - The hard-coded `--release 5.17` stays (out of scope).
7. **Verification in `clone-cplace-fe`**:
   - Migrate it to the current caller templates and audit its own workflows for shared-account use.
   - Delete its `GIT_USER_TOKEN`, `GIT_USER` and `GIT_USER_EMAIL` repo secrets.
   - Run a release (the R6 that 34282 skipped), an upmerge check and a labelled snapshot PR with its comment. All must pass.
   - Add the extended U1–U9 usage mapping, including the 15-repo audit, to the spec as the AC1 deliverable.

This means:
- No reusable workflow in this repo reads a shared-account secret any more. Only the deprecated `fe-tag.yml` still accepts `GIT_USER_TOKEN`.
- Consumers need no change on rollout. Explicit `GIT_USER*` passes keep working, and repos using `secrets: inherit` can delete the secrets at any time.
- In cplace-fe, only the legacy tagger (`push_to_release.yaml` → `fe-tag.yml`) and its `squad-fe` pusher guard still depend on the shared account. Both go away with the migration ticket.
- Every remaining GitHub credential in FE CI is either `GITHUB_TOKEN` or a short-lived token for an App that is scoped to one repo.

Major trade-offs we're accepting:
1. **Optional but dead secret declarations**: `GIT_USER`/`GIT_USER_EMAIL` stay declared until the cleanup ticket. This avoids breaking callers that pass secrets one by one, at the cost of a leftover interface that looks meaningful but isn't.
2. **The legacy PAT stays in `fe-tag.yml`**: the shared account stays in use org-wide until every repo and release line has migrated. 33676 only proves removal in one reference repo.
3. **Heal commits run under the backend upmerge App's name**: this reuses an App that already has bypass and secrets, so no FE-named App or org-admin change is needed. The cost is less precise attribution in the audit trail.
4. **cplace-fe fixes on `main` only**: older release lines (25.4–26.4) keep the PAT in `heal-visual-baselines.yml` until they reach end of life or are migrated.

What we're NOT doing (out of scope):
- Deleting `fe-tag.yml` or `workflows/fe-release.yml`, or switching them away from the PAT (migration/cleanup ticket).
- Removing the `GIT_USER*` declarations from `workflow_call.secrets` (migration/cleanup ticket).
- Migrating the 14 consumer repos off `fe-tag.yml`, or removing cplace-fe's `squad-fe` pusher guard (migration/cleanup ticket).
- Narrowing `permissions:` in caller templates, including the upmerge template (PFM-ISSUE-35504).
- Removing `printenv` from the upmerge composite action, or changing `--release 5.17` in `upmerge.ts`.
- Changing cplace-fe release lines, or the JFrog/`.npmrc` service users.
- Setting up any new GitHub App.

Success criteria:
- `grep` for `GIT_USER` in this repo's `.github/` and `tools/` finds only the optional, unused declarations in `fe-check-upmerge.yml`/`fe-release-flow.yml` and the deprecated `fe-tag.yml`.
- In `clone-cplace-fe`, with `GIT_USER_TOKEN`/`GIT_USER`/`GIT_USER_EMAIL` deleted, all three checks pass: a release (tag + GitHub release), an upmerge check and a snapshot PR comment.
- A cplace-fe heal run pushes a baseline commit to a protected branch as `sva-actions-upmerge[bot]`. A storybook run commits as `github-actions[bot]`.
- The usage mapping lists every use of the shared account across this repo and the 15 FE repos, each with its replacement and owner.

## Design Decisions - Details

### Scope split with related tickets

**Chosen Approach:** 33676 owns U5 (release-flow identity), U6 (upmerge identity), U9 (docs), the two cplace-fe findings, and verification. Template permissions go to 35504. `fe-tag.yml`, its consumers and the removal of the optional declarations go to the migration/cleanup ticket.

**Rationale:**
- The research had attributed U5 to PFM-ISSUE-34286, but 34286 has no relation to U5. U5 is the same identity-only pattern as U6, so it belongs here.
- Retiring `fe-tag.yml` depends on consumer migration, not on authentication work.

**Alternatives Considered:**
- **Leave U5 to 34286**: rejected, because 34286 does not cover it.
- **Narrow the upmerge template to `contents: read` here**: rejected, to keep all least-privilege template work together in 35504.
- **Retire `fe-tag.yml` here**: rejected, because 14 repos still call it from their default branch.

**Implications:**
- The migration/cleanup ticket inherits:
  - removing the optional declarations
  - deleting `fe-tag.yml`/`fe-release.yml`
  - the `squad-fe` pusher guard
  - deleting `GIT_USER*` secrets per repo

---

### Git identity for upmerge and release flow

**Chosen Approach:** each workflow sets a fixed `github-actions[bot]` identity in a step. `upmerge.ts` no longer configures git.

**Rationale:**
- The release flow creates only a lightweight tag, so its identity is never recorded.
- The upmerge check only makes local merge commits, which are discarded (`--no-push`).
- A fixed identity keeps git working whether or not cplace-cli needs one. That has not been checked in `@cplace/cli`, and it no longer matters for this design.
- Setting the identity in the workflow keeps it in one place, visible in YAML.

**Alternatives Considered:**
- **Set the identity in `upmerge.ts`**: rejected, because the identity would then live in two different layers (TS for upmerge, YAML for the release flow).
- **Drop the identity entirely**: rejected. Whether the upmerge CLI makes commits is unverified, and a missing identity would make git fail.

**Implications:**
- The quoting issue in `upmerge.ts` disappears, because the lines are removed.
- The release flow's existing "Configure git user" step is rewritten to fixed values, with no secret env.

---

### Secret declaration phase-out

**Chosen Approach:** `required: false`, unused, with a comment pointing to the cleanup ticket. The upmerge caller template stops passing `GIT_USER*`. The README drops them from the required secrets.

**Rationale:**
- cplace-fe, cplace-paw-fe, cplace-office-reports-fe and cplace-workflow-fe pass `GIT_USER*` to `fe-check-upmerge.yml` one by one. Removing the declarations would break their scheduled runs.
- Optional declarations let the reusable workflows change now and leave the consumer updates for later.

**Alternatives Considered:**
- **Remove the declarations now**: rejected, because it breaks the callers that pass the secrets explicitly.
- **Keep them `required: true` but unused**: rejected. Repos could not delete the secrets, which defeats AC3.

**Implications:**
- `clone-cplace-fe` can delete its `GIT_USER*` secrets once its callers stop passing them.

---

### Heal-visual-baselines credential (cplace-fe)

**Chosen Approach:** Option A. Mint a token from the existing `sva-actions-upmerge` App (app id 3487076, `contents: write`, `metadata: read`), limited to `cplace-fe`. Use it for the checkout and push in the `heal` job. Author the commit as the App's bot user. Drop `BOT_EMAIL`.

**Rationale:**
- The heal job pushes a commit to protected `main`/`release/**`, which requires ruleset bypass. `GITHUB_TOKEN` cannot do that without opening a bypass for every workflow in the repo.
- The App is already a bypass actor on the `product-fe` ruleset, and its secrets are already visible to cplace-fe.
- It follows the backend pattern: an App, not the PAT, for bypass pushes (`SVA_ACTIONS_UPMERGE_*`).
- An App push, like the PAT push, triggers workflows. The `[skip visual-heal]` marker still breaks the loop.
- Recent upmerge commits on `release/26.4` were all written by people. The `byBot` hint in `heal-gate.mjs` therefore never matched, and dropping `BOT_EMAIL` changes nothing.

**Alternatives Considered:**
- **Extend `sva-actions-write-product-fe` with `contents: write` and bypass**: rejected. It broadens an App that 34281 deliberately kept to Issues, needs org-admin changes, and departs from the backend pattern.
- **`GITHUB_TOKEN` plus GitHub Actions as bypass actor**: rejected. It grants bypass to every workflow, and the healed commit would not trigger CI.
- **Hand the heal and storybook findings to a follow-up ticket (option c)**: recommended, then overturned on user override. The assumption that turned out wrong was that a new bypass-capable App and new ruleset work were needed. The existing `sva-actions-upmerge` App already has bypass and visible secrets.

**Implications:**
- The cplace-fe PR adds a `create-github-app-token` step pinned to a SHA (v3.3.0, as in the devkit template), with `app-id: SVA_ACTIONS_UPMERGE_ID`.
- Verification needs one real heal run on a protected branch of cplace-fe `main`, or a `workflow_dispatch` with an app selected.

---

### Storybook identity (cplace-fe)

**Chosen Approach:** replace `git config user.name squad-fe` with `github-actions[bot]` in `deploy_storybook.yaml`. The email is already `github-actions@github.com`; align it to the bot noreply address.

**Rationale:** the step is identity only, and the push to `gh-pages` already uses `GITHUB_TOKEN`.

**Alternatives Considered:**
- **Leave it**: rejected, because it is a literal `squad-fe` reference and would fail AC3-style audits.

**Implications:** none beyond the authorship of `gh-pages` merge commits.

---

### Cross-repo checkout for e2e (U8)

**Chosen Approach:** no change. Record U8 as done by PFM-ISSUE-34281.

**Rationale:** the default branches of all 15 FE repos (14 `-fe` repos plus `cplace-e2e`) were audited for `repository:` checkouts, `git clone`, `gh repo clone` and App-token use. The only cross-repo checkout is cplace-fe's devkit e2e, and it already uses `sva-actions-read-product-fe` (Contents/Metadata read, secrets visible only to cplace-fe).

**Alternatives Considered:**
- **Roll the read App out to more repos**: rejected, because no other repo checks out a second repo.

**Implications:** the read App's org-secret visibility stays limited to cplace-fe.

---

### Side fixes in the upmerge files

**Chosen Approach:**
- Delete the undeclared `ref: ${{ inputs.GHA_REF }}`.
- The unquoted `git config` calls are removed along with the identity code.
- Keep `printenv`.
- Keep `--release 5.17`.

**Rationale:**
- The `ref:` line always resolved to empty, so deleting it changes no behavior and removes a misleading reference.
- `--release 5.17` controls which release lines cplace-cli checks, which has nothing to do with authentication.

**Alternatives Considered:**
- **Declare a `GHA_REF` input**: rejected, because no caller would use it.
- **Remove `printenv`**: recommended, then overturned on user override. The assumption that turned out wrong was that it is a leftover debug step nobody relies on. The user keeps it.
- **Change `--release 5.17`**: rejected for this ticket, because changing the upmerge scope is out of scope.

**Implications:** none beyond the identity change.

---

### Reference repository and verification

**Chosen Approach:** `collaborationFactory/clone-cplace-fe`, the test fork used for 34282 and 34283.

**Rationale:**
- It is the established test fork with a known live-test protocol (`specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/clone-cplace-fe-live-tests.md`).
- Deleting its secrets puts no production repo at risk.

**Alternatives Considered:**
- **`cplace-remote-filesystem-fe` (34287 pilot)**: rejected. It is a production repo and belongs to the rollout ticket.
- **`cplace-fe`**: rejected. Its release lines still need the PAT for `fe-tag.yml`, so the secrets cannot be deleted.

**Implications:**
- `clone-cplace-fe` must be on the current caller templates (`fe-release.yml` → `fe-release-flow.yml`, `fe-check-upmerge.yml` without `GIT_USER*`) before its secrets are deleted.
- This covers the R6 test that 34282 skipped.

## Overall Architecture

No new components. Every GitHub credential in FE CI falls into one of three classes:

- **`GITHUB_TOKEN` with job-scoped permissions** for same-repo work: checkout, tag push, GitHub release, PR comment, storybook `gh-pages` push.
- **Short-lived App tokens** for what `GITHUB_TOKEN` can't do:
  - `sva-actions-read-product-fe` for cross-repo clone (devkit e2e)
  - `sva-actions-write-product-fe` for milestones (devkit)
  - `sva-actions-upmerge` for bypass pushes to protected branches (heal)
- **A fixed bot identity** (`github-actions[bot]`, or the App's bot user when the App pushes) wherever git needs an author.

The shared-account secrets remain only as optional, unused declarations and in the deprecated `fe-tag.yml`, until the migration/cleanup ticket.

### Key Components
1. **`.github/workflows/fe-check-upmerge.yml`**: bot identity step, optional `GIT_USER*`, no `ref:` line.
2. **`tools/scripts/upmerge/upmerge.ts`**: identity configuration removed.
3. **`.github/workflows/fe-release-flow.yml`**: "Configure git user" sets the bot identity, optional `GIT_USER*`.
4. **`.github/workflow-templates/fe/fe-check-upmerge.yml`**: stops passing `GIT_USER*`.
5. **`README.md`**: required-secrets section updated.
6. **cplace-fe `heal-visual-baselines.yml` / `deploy_storybook.yaml`**: App token and bot identity (separate PR).
7. **`specs/.../research.md` mapping**: extended with the 15-repo audit (AC1).

### Data Flow
- **Upmerge:** checkout (default branch, `GITHUB_TOKEN`) → bot identity → `cplace-cli flow --upmerge --no-push` makes local merges → Slack notification. Nothing is pushed.
- **Release:** unchanged, except that the identity comes from fixed values.
- **Heal:** mint the App token → checkout with it → render, update baselines, commit as the App bot → pull --rebase and push to the protected branch through the ruleset bypass.

### Integration Points
- Consumer callers that pass `GIT_USER*` explicitly keep working through the optional declarations.
- `product-fe` ruleset bypass list (Integration 3487076) and the org secrets `SVA_ACTIONS_UPMERGE_ID`/`_KEY`.
- `heal-gate.mjs` loop-break (`[skip visual-heal]`) and the subject-based upmerge detection.

## Known Risks

1. **`cplace-cli` upmerge behavior with a different identity**: the upmerge check was never live-tested on node24.
   - Mitigation: run the upmerge check in `clone-cplace-fe` with the secrets deleted, as part of verification.
2. **The App's bypass entry or secret visibility changes under us**: the `sva-actions-upmerge` setup is owned by the backend, and cplace-fe also has a repo ruleset named "experimental".
   - Mitigation: rely on the org `product-fe` ruleset bypass, not the experimental one. Note the dependency in a workflow comment. Verify with a real heal run.
3. **App-token push triggers a cascade of workflows on protected branches**: the PAT push did the same, so nothing new. The heal loop is broken by `[skip visual-heal]`.
   - Mitigation: confirm in the heal verification run that the gate skips the heal commit.
4. **Optional declarations are forgotten**: dead interface stays around.
   - Mitigation: a comment on each declaration naming the cleanup ticket, and an entry in that ticket's scope.
5. **A cross-repo use on non-default branches was missed**: the audit covered default branches only.
   - Mitigation: release lines are frozen and covered by the migration ticket. The 34281 decision already excludes release lines.

## Next Steps

1. Review this design document
2. Refine if needed based on feedback
3. Proceed to implementation planning: `/spec-driven-development:create_plan specs/2026-11-26_PFM-ISSUE-33676_replace-shared-github-user/design.md`

## References

- Original ticket: [PFM-ISSUE-33676](https://base.cplace.io/pages/w64364g0a1qsl6z6vb11ngevs/PFM-ISSUE-33676-Replace-shared-GitHub-user-account-in-frontend-workflows)
- Related research: [Research](./research.md)
- GitHub App for cross-repo cloning: [PFM-ISSUE-34281](https://base.cplace.io/pages/m47pvua9sb9od1xl9f7360kon/PFM-ISSUE-34281-Set-up-GitHub-App-for-cross-repository-cloning-in-FE-2.0-workflows), PFM-TASK-8604, cplace-fe PR #2982
- Prior specs: `specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/`, `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/`
- Similar patterns: cplace-fe `.github/workflows/devkit-test-template.yaml` (App-token minting), backend `SVA_ACTIONS_UPMERGE_*` usage in `cplace-gh-workflows`
