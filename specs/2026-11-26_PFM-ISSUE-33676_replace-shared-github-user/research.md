---
date: 2026-11-26T21:34:41+01:00
git_commit: 3e8a45b364d0e9f6aae577fe230a0f85be09791c
branch: master
topic: "PFM-ISSUE-33676 - Replace shared GitHub user account in frontend workflows"
tags: [research, codebase, github-actions, github-token, permissions, github-app, fe-tag, fe-release-flow, fe-check-upmerge, upmerge, fe-pr-snapshot]
status: complete
last_updated: 2026-11-26
---

# Research: Replace shared GitHub user account in frontend workflows (PFM-ISSUE-33676)

**Date**: 2026-11-26T21:34:41+01:00
**Git Commit**: 3e8a45b364d0e9f6aae577fe230a0f85be09791c
**Branch**: master

## Research Question
Inventory every remaining use of the shared GitHub user account (`GIT_USER_TOKEN`, `GIT_USER`, `GIT_USER_EMAIL`, actor `squad-fe`) in this repo's frontend reusable workflows, caller templates, composite actions and tools. Map each use to its replacement: the workflow's own `GITHUB_TOKEN` with scoped `permissions:`, or a GitHub App. Also record what PFM-ISSUE-34282, -34283 and -34285 have already replaced.

## PFM Ticket Context
- **Ticket**: [PFM-ISSUE-33676](https://base.cplace.io/pages/w64364g0a1qsl6z6vb11ngevs/PFM-ISSUE-33676-Replace-shared-GitHub-user-account-in-frontend-workflows)
- **Title**: Replace shared GitHub user account in frontend workflows
- **Type**: PFM Issue, category 30.groundwork. Priority 20.high, status 50.working.
- **Target Release**: not set on the ticket
- **Assignee**: Vladimir Arsov. Requested by Christian Kaltenbach. Squad 01 - Build & Connect, team Stratum.
- **Parent**: WP-1963 "Modernize FE 2.0 Frontend Workflow Authentication"
- **Suggested Branch**: `improvement/PFM-ISSUE-33676-Replace-shared-GitHub-user-account-in-frontend`
- **Description**:
  > **User Story**: As a CI/CD engineer in the Build & Connect POD, I want the shared GitHub user account in frontend workflows replaced with GitHub-native authentication (scoped `GITHUB_TOKEN` or a GitHub Authentication App), so that we eliminate a shared credential with rotation, audit, and blast-radius risk.
  >
  > **Description**: The shared GitHub user account is used in frontend workflows for tag creation, PR decoration, and (in some cases) cross-repository checkout for end-to-end tests. Replace it with GitHub-native authentication — scoped `GITHUB_TOKEN` permissions or a dedicated GitHub Authentication App — wherever it can cover the required usage.
  >
  > **Open Questions (decide at implementation start)**
  > - Which usages can be covered by the workflow's own `GITHUB_TOKEN` with appropriate `permissions:` settings (likely: tag creation, PR decoration on the same repo).
  > - Which usages require a GitHub Authentication App (likely: cross-repository checkout for e2e tests).
  >
  > **Acceptance Criteria**
  > 1. Each current usage of the shared GitHub user account is mapped to its replacement (`GITHUB_TOKEN` with permissions or GitHub App).
  > 2. The replacement is implemented and verified in at least one reference frontend repository.
  > 3. The shared GitHub user account is no longer used in that reference repository.

## Summary

The three uses the ticket expects are mostly already gone from this repo, or never existed here:

| Ticket's expected use | State on `master` (3e8a45b) | Replacement |
|---|---|---|
| **Tag creation** | **Done in the current flow.** `fe-release-flow.yml` pushes `version/*` tags with the persisted default `GITHUB_TOKEN`, with job `permissions: contents: write` (PFM-ISSUE-34282, #189). **Still PAT-based** in the deprecated `fe-tag.yml`, which is kept for unmigrated branches. | `GITHUB_TOKEN` (`contents: write`). The remaining PAT use goes away when `fe-tag.yml` is retired, not when it is migrated. |
| **PR decoration** | **Already `GITHUB_TOKEN`.** The only PR write is the "published artifacts" comment in `fe-pr-snapshot.yml`, sent through `actions/github-script` with the default `github.token`. | `GITHUB_TOKEN` (`pull-requests: write`, granted by the caller template) |
| **Cross-repo checkout for e2e** | **Not in this repo.** No `actions/checkout` has `repository:`, and there is no `git clone`. `fe-e2e.yml` tests the same repo in a Cypress container. | n/a here. If it exists, it lives in a consumer repo's own workflows (open question). |

The shared account is still referenced in four places:

1. **`fe-tag.yml`**, deprecated. This is the only place a PAT (`GIT_USER_TOKEN`) authenticates anything. It is used for the checkout and the later tag `git push`, and it also sets `GIT_USER`/`GIT_USER_EMAIL` as identity.
2. **`fe-release-flow.yml`**, the current flow. `GIT_USER`/`GIT_USER_EMAIL` are declared `required: true` and set as the git identity in the `release` job. The job only creates a lightweight tag, so the identity is never recorded. Removing it is formally assigned to **PFM-ISSUE-34286**.
3. **`fe-check-upmerge.yml`, `.github/actions/upmerge`, `tools/scripts/upmerge/upmerge.ts` and the caller template.** These use `GIT_USER`/`GIT_USER_EMAIL` as global git identity only. No token is involved: checkout uses the default token, and `cplace-cli flow --upmerge --no-push` pushes nothing. No earlier spec covers this.
4. **README "FE Release Flow → Required secrets"**, which documents `GIT_USER`/`GIT_USER_EMAIL` and the deprecated reusables' need for `GIT_USER_TOKEN`.

None of the remaining uses needs a GitHub App. Every one is either same-repo `GITHUB_TOKEN` work or a pure git identity that can become the `github-actions[bot]` identity or be dropped. A GitHub App would only be needed for a cross-repo or workflow-triggering use, and none exists in this repo. The real remaining work is:
- (a) the identity-only uses (upmerge, release flow);
- (b) retiring `fe-tag.yml`/`workflows/fe-release.yml` once consumers are migrated;
- (c) acceptance criteria 2 and 3: proving in a reference FE repo that the shared account, including the `GIT_USER*` repo secrets, is no longer used. Consumer-side workflows outside this repo are part of that.

## Detailed Findings

### 1. Tag creation

**Current flow: done (PFM-ISSUE-34282).**
- `.github/workflows/fe-release-flow.yml:108-109`: the `release` job has `permissions: contents: write`.
- `.github/workflows/fe-release-flow.yml:115-118`: the checkout has no `token:` override, so the default `GITHUB_TOKEN` is saved in `.git/config`. `fetch-depth: 0`.
- `fe-release-flow.yml:148-156` → `tools/scripts/artifacts/artifacts-handler.ts:311-313`: with `RELEASE_FLOW: true`, after publish and promote the flow runs `git tag <gitTag>` and `git push origin <gitTag>`. It pushes tags only, no commits or branches.
- `fe-release-flow.yml:160-193`: failure cleanup runs `git ls-remote --exit-code --tags origin` (`:173`) with the same token.
- `fe-release-flow.yml:195-219`: the `github-release` job runs `gh release create --verify-tag --generate-notes` with `GH_TOKEN: ${{ github.token }}` (`:205`) and `contents: write` (`:200-201`).
- `GIT_USER_TOKEN` is no longer declared in `workflow_call.secrets`. `fe-snapshot.yml` lost it in PFM-ISSUE-34285 (faa4771).

**Deprecated `fe-tag.yml`: still uses the PAT.**
- `.github/workflows/fe-tag.yml:19-24`: declares `GIT_USER_TOKEN`, `GIT_USER_EMAIL` and `GIT_USER`, all `required: true`.
- `fe-tag.yml:30-31`: prints `::warning::fe-tag.yml is deprecated. Migrate to fe-release-flow.yml`.
- `fe-tag.yml:33-37`: checkout with `token: ${{ secrets.GIT_USER_TOKEN }}`. The token is saved by default, so the later push uses the PAT.
- `fe-tag.yml:48-51`: `git config user.name/user.email` with the secrets put straight into the shell command, unquoted.
- `fe-tag.yml:53-61` → `artifacts-handler.ts:203-223` (`ONLY_BUMP_VERSION`): on a release branch it runs `git tag version/X.Y.Z` and `git push origin <tag>`. The PAT push exists because the old `workflows/fe-release.yml` listens for tag pushes: a `GITHUB_TOKEN` push would not start it.
- It has no `permissions:` block. The PAT bypasses `GITHUB_TOKEN` scoping anyway.
- No template or workflow in this repo calls it. The only references are the guard grep at `fe-release-flow.yml:57-66` (which fails the flow while a consumer still calls `fe-tag.yml@`/`fe-release.yml@`) and the README (`:52-58`, `:66-67`, `:89-90`).
- Known external callers, from the 34282 research and not re-checked here: `cplace-fe/.github/workflows/push_to_release.yaml` (`fe-tag.yml@master`, explicit PAT), and `cplace-2lforge-scores-fe/.github/workflows/fe-release.yml` (`@release/26.1`, `write-all`, explicit `GIT_USER_TOKEN`/`GIT_USER`/`GIT_USER_EMAIL`). Release lines 25.4-26.4 keep the old flow.

**What this means:** tag creation needs no new mechanism. The PAT goes away when consumers migrate to `fe-release-flow.yml` and `fe-tag.yml`/`workflows/fe-release.yml` are deleted or stop being called. Switching `fe-tag.yml` itself to `GITHUB_TOKEN` would break it, because its tag must trigger the old `fe-release.yml` consumer.

### 2. PR decoration

- `.github/workflows/fe-pr-snapshot.yml:75-89`: `actions/github-script@v9.0.0` creates or updates one comment, marked `<!-- published-artifacts -->`, with text from `githubCommentsForPR.txt`. It passes no `github-token:` input, so it uses the default `github.token`. The job runs only when the PR has the `snapshot` label (`:21`).
- The reusable workflow has no `permissions:` block. `pull-requests: write` comes from the caller template `.github/workflow-templates/fe/fe-pr-snapshot.yml:8-12`.
- The thollander action was replaced by `github-script` with the default token in the node24 migration (`specs/2026-06-05_node24-workflow-migration/plan.md:244-264`).
- `fe-code-quality.yml:182` and `fe-sonar.yml:128-131` use `SONAR_CLOUD_TOKEN`, a service token rather than the shared user. SonarCloud adds its PR decoration from the server side through its own GitHub integration.
- `.github/` has no `gh pr`, sticky-comment, labeler or commit-status calls. The `pr-checks` job in the `fe-pr.yml` template only gathers the results of the jobs it depends on, using `jq`.

**What this means:** PR decoration is already on `GITHUB_TOKEN`. The only open point is verification. The 34282 research calls this "the PR-decoration part of 33676" (`specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/research.md:278`).

### 3. Cross-repo checkout for e2e

- `grep -rn "repository:" .github` finds nothing. Every `actions/checkout` targets the same repo, and only `fe-tag.yml:37` overrides `token:`.
- The only other git network calls are same-repo `git fetch origin <base>` in `fe-build.yml:44`, `fe-code-quality.yml:64`, `fe-e2e.yml:46` and `fe-pr-snapshot.yml:46,52`.
- `fe-e2e.yml` runs Cypress in the `cypress/browsers:24.22.1` container against the checked-out repo and uses `PERCY_TOKEN` (`:59`), a service token.

**What this means:** none of this repo's reusable workflows checks out another repo. If an FE e2e setup checks out another repo with the shared account (for example `cplace-e2e` or a private test-data repo), it is in a consumer repo's own workflow files. That is the only place a GitHub App (an `actions/create-github-app-token` pattern like the backend's `SVA_ACTIONS_READ_PRODUCT_*`) might be justified.

### 4. Upmerge check (identity only, not covered by any earlier spec)

- `.github/workflows/fe-check-upmerge.yml:5-11`: declares `SLACK_TOKEN_UPMERGE`, `GIT_USER_EMAIL` and `GIT_USER`, all `required: true`. There is no `GIT_USER_TOKEN`.
- `fe-check-upmerge.yml:18-21`: checkout with the default token and `fetch-depth: 0`. `ref: ${{ inputs.GHA_REF }}` refers to an **input that is not declared** (`workflow_call` has no `inputs:`), so it is empty and checkout falls back to the default ref. This is a latent bug that has nothing to do with authentication.
- `fe-check-upmerge.yml:34-39` passes the three secrets as env to `collaborationFactory/github-actions/.github/actions/upmerge@master`.
- `.github/actions/upmerge/action.yml:1-13` runs `printenv`, `npm ci`, `npm i -g @cplace/cli` and `ts-node tools/scripts/upmerge/main.ts`. GitHub masks the secret values that `printenv` logs.
- `tools/scripts/upmerge/upmerge.ts:12-21`: `git config --global user.email ${GIT_USER_EMAIL}` / `user.name ${GIT_USER}`, unquoted.
- `upmerge.ts:26-61`: `cplace-cli flow --upmerge --release 5.17 --no-push --show-files`. It parses stdout for "have been merged". **Nothing is pushed**, and no branch, PR or comment is created. The identity is probably needed only because the CLI makes local merge commits. This has not been checked in cplace-cli.
- `upmerge.ts:63-91`: posts to Slack channel `frontend-upmerge` with `SLACK_TOKEN_UPMERGE`, which is not a GitHub credential.
- Caller template `.github/workflow-templates/fe/fe-check-upmerge.yml`: cron `0 18 * * *`. It passes the three secrets explicitly (`:16-19`) and grants `contents: write`, `pull-requests: write`, `actions: read` and `checks: write` (`:7-11`). `contents: read` is enough, because nothing is pushed.
- The node24 migration never live-tested this workflow (`specs/2026-06-05_node24-workflow-migration/design.md:62`, `plan.md:418`).

**What this means:** the shared account appears here only as a git author name and email for local merge commits that are thrown away. A fixed bot identity can replace it, for example `github-actions[bot]` / `41898828+github-actions[bot]@users.noreply.github.com`, set in the workflow or in code. With that change the `GIT_USER*` secrets can stop being required. If the declarations are removed while callers still pass the secrets explicitly, those callers may start failing (see Open Questions).

### 5. Release flow git identity (assigned to PFM-ISSUE-34286)

- `.github/workflows/fe-release-flow.yml:24-27`: `GIT_USER` and `GIT_USER_EMAIL` are `required: true`.
- `fe-release-flow.yml:140-146`: the "Configure git user" step sets `git config user.name "$GIT_USER"` / `user.email "$GIT_USER_EMAIL"` through env, quoted.
- The `release` job creates only a **lightweight** tag (`artifacts-handler.ts:312`), which records no tagger. The 34282 research (`:215`) found no `git commit`/`git merge` in non-test `tools/` code, so the identity is never used.
- The caller template `.github/workflow-templates/fe/fe-release.yml:32` uses `secrets: inherit`. If the declarations are removed, inherit callers need no change.
- `README.md:83-91` lists `GIT_USER`/`GIT_USER_EMAIL` as required secrets for the flow.
- The 34282 design deferred removal to PFM-ISSUE-34286 (34282 `design.md` "Git identity" and decision 4; 34283 `design.md:82-85`).

### 6. Permissions and secrets in the workflows and templates

Reusable workflows (`.github/workflows/`):

| Workflow | `permissions:` | Shared-account secrets |
|---|---|---|
| fe-tag (deprecated) | none | GIT_USER_TOKEN, GIT_USER, GIT_USER_EMAIL |
| fe-release (deprecated tag-push consumer) | none | none |
| fe-release-flow | job-level: `contents: read` for guard, install-deps, build, e2e; `contents: write` for release and github-release | GIT_USER, GIT_USER_EMAIL |
| fe-check-upmerge | none | GIT_USER, GIT_USER_EMAIL |
| fe-pr-snapshot | none (relies on the caller's `pull-requests: write`) | none |
| fe-sonar | `sonarqube-scan`: `contents: read` | none |
| fe-snapshot, fe-code-quality, fe-e2e, fe-licenses, fe-install-deps, fe-build, fe-pr-close, fe-cleanup-snapshots | none | none |

Caller templates (`.github/workflow-templates/fe/`):
- All templates except `fe-release.yml` grant the same four scopes (`contents: write`, `pull-requests: write`, `actions: read`, `checks: write`) and pass secrets explicitly. Reducing these to least privilege is assigned to **PFM-ISSUE-35504**.
- `fe-release.yml` grants only `contents: write` and uses `secrets: inherit`.
- Only `fe-check-upmerge.yml` still passes `GIT_USER*`.
- There is no `fe-tag` template.

## Usage → replacement mapping (acceptance criterion 1)

| # | Use | Location | Current credential | Proposed replacement | Owner / status |
|---|---|---|---|---|---|
| U1 | Release tag push | `fe-release-flow.yml:108-156` | `GITHUB_TOKEN` | — (done) | 34282, merged #189 |
| U2 | GitHub release creation | `fe-release-flow.yml:195-219` | `GITHUB_TOKEN` | — (done) | 34283, merged #183 |
| U3 | Snapshot workflow checkout | `fe-snapshot.yml` | `GITHUB_TOKEN` | — (done) | 34285, merged #182 |
| U4 | Legacy tag push (PAT, triggers `fe-release.yml`) | `fe-tag.yml:19-61` | `GIT_USER_TOKEN` PAT + `GIT_USER*` | Retire: consumers migrate to `fe-release-flow.yml` (U1). No in-place migration, because a `GITHUB_TOKEN` tag would not trigger the legacy consumer. | Consumer rollout (34287 pilot); 33676 removes the PAT from the reference repo |
| U5 | Release flow git identity | `fe-release-flow.yml:24-27,140-146` | `GIT_USER*` (identity only) | Delete the step and declarations (lightweight tag, identity never used), or use `github-actions[bot]` | PFM-ISSUE-34286 (overlaps with 33676) |
| U6 | Upmerge check git identity | `fe-check-upmerge.yml:5-11,34-39`, `upmerge.ts:12-21`, template `:16-19` | `GIT_USER*` (identity only) | `github-actions[bot]` identity. Checkout already uses `GITHUB_TOKEN`. Narrow the template to `contents: read`. | **Unowned → 33676** |
| U7 | PR "published artifacts" comment | `fe-pr-snapshot.yml:75-89` | `GITHUB_TOKEN` | — (done). Verify with `pull-requests: write`. | Verify in 33676 |
| U8 | Cross-repo checkout for e2e | not in this repo | ? | GitHub App via `actions/create-github-app-token`, if it exists in a consumer repo | Open question |
| U9 | Docs | `README.md:83-91` | — | Remove `GIT_USER*` from the required secrets once U5/U6 land. Document secret deletion per repo. | 33676 / 34286 |

## Code References
- `.github/workflows/fe-tag.yml:19-24` - `GIT_USER_TOKEN`/`GIT_USER`/`GIT_USER_EMAIL` declarations
- `.github/workflows/fe-tag.yml:30-31` - deprecation warning
- `.github/workflows/fe-tag.yml:33-37` - checkout with the PAT, which is saved and reused for the push
- `.github/workflows/fe-tag.yml:48-51` - unquoted git identity from secrets
- `tools/scripts/artifacts/artifacts-handler.ts:203-223` - `ONLY_BUMP_VERSION` tag and push (legacy)
- `tools/scripts/artifacts/artifacts-handler.ts:311-313` - `RELEASE_FLOW` tag and push (current)
- `.github/workflows/fe-release-flow.yml:24-27` - `GIT_USER`/`GIT_USER_EMAIL` declarations
- `.github/workflows/fe-release-flow.yml:57-66` - guard that fails while consumers still call `fe-tag.yml@`/`fe-release.yml@`
- `.github/workflows/fe-release-flow.yml:108-118` - `release` job, `contents: write`, default-token checkout
- `.github/workflows/fe-release-flow.yml:140-146` - "Configure git user" step
- `.github/workflows/fe-release-flow.yml:195-219` - GitHub release with `github.token`
- `.github/workflows/fe-check-upmerge.yml:5-11,18-21,34-39` - upmerge secrets, checkout (undeclared `inputs.GHA_REF`), env pass-through
- `.github/actions/upmerge/action.yml:1-13` - upmerge composite (`printenv`, `npm ci`, cplace-cli, ts-node)
- `tools/scripts/upmerge/upmerge.ts:12-21` - global git identity from `GIT_USER*`
- `tools/scripts/upmerge/upmerge.ts:26-61` - `cplace-cli flow --upmerge --no-push`
- `tools/scripts/upmerge/upmerge.ts:63-91` - Slack notification
- `.github/workflow-templates/fe/fe-check-upmerge.yml:7-19` - four-scope permissions, explicit `GIT_USER*`
- `.github/workflow-templates/fe/fe-release.yml:1-5,18-19,32` - header (GITHUB_TOKEN tag starts no workflow), `contents: write`, `secrets: inherit`
- `.github/workflows/fe-pr-snapshot.yml:75-89` - PR comment through `github-script` with the default token
- `README.md:52-58,66-67,83-98,156` - migration, deprecation, required secrets, tag rulesets, release token

## Architecture Insights
- **`GITHUB_TOKEN` first, a GitHub App only where it can't work.** The FE workflows follow the backend precedent (`cplace-gh-workflows` commit 18ea38f3), which dropped the PAT for `GITHUB_TOKEN`. The backend uses Apps only for cross-repo reads (`SVA_ACTIONS_READ_PRODUCT_*`), pushes to protected branches that need a bypass (`SVA_ACTIONS_UPMERGE_*`), cross-repo PR comments (`SVA_ACTIONS_PR_WRITER_*`) and pushes that must trigger workflows (`SVA_CONTAINER_BUILD_BOT_*`). None of these cases is left in this repo's FE workflows.
- **`GITHUB_TOKEN` pushes start no workflows.** This is why the PAT existed (`fe-tag.yml` → tag-push → `workflows/fe-release.yml`). The consolidated `fe-release-flow.yml` (#183) removed the dependency on that trigger, and that change is what made the token swap possible.
- **The caller's permissions are a ceiling.** A reusable job that asks for more than its caller grants fails at startup (34282 live test R5). Adding new scopes to reusables means editing every caller, so reusables should only narrow.
- **`secrets: inherit` makes removing secrets easy.** Only the `fe-release` template uses it. The other templates, and external callers such as cplace-fe, pass secrets explicitly, so removing a `required` declaration has to be coordinated with callers that pass it.
- **Old and new flows run side by side.** A repo can't delete `GIT_USER_TOKEN` until none of its branches, release lines included, calls the deprecated reusables.

## Historical Context (from specs/)
- `specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/research.md`, `design.md`, `plan.md`, `live-test-plan.md`: moved the release tag push to `GITHUB_TOKEN` with `contents: write` and removed `GIT_USER_TOKEN` from the flow. It rejected the `checks`/`pull-requests` baseline, deferred `GIT_USER*` removal to 34286 and template least-privilege to 35504, and left `fe-tag.yml` on the PAT on purpose. It was live-tested in `collaborationFactory/clone-cplace-fe` (R0-R5 passed). **R6 (release with `GIT_USER_TOKEN` deleted) was skipped**, so running without the PAT secret was never proven live. `research.md:278` names `fe-pr-snapshot` as "the PR-decoration part of 33676".
- `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/research.md:49-50,281`: places 33676 under epic WP-1963 and expects tag creation and PR decoration to map to `GITHUB_TOKEN` and the cross-repo e2e checkout to a GitHub App. It notes "No spec yet covers PFM-ISSUE-33676". `design.md:82-85,97` covers identity deferral and the note on a future `version/*` tag ruleset (bypass actor = GitHub Actions, not `squad-fe`). `clone-cplace-fe-live-tests.md` describes the test-fork protocol.
- `specs/2026-06-05_node24-workflow-migration/plan.md:244-264`: moved the PR comment to `github-script` with the default token. `design.md:62`/`plan.md:418`: `fe-check-upmerge` was never live-tested. `validation-log.md:33-41`: never test on real `release/*` branches.
- `specs/2026-11-16_PFM-ISSUE-34301_third-party-npm-registries-jfrog/`: not related to GitHub auth. It touches upmerge only for `npm ci`/`.npmrc`.

## Related Research
- `specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/research.md`
- `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/research.md`
- `specs/2026-06-05_node24-workflow-migration/research.md`

## Open Questions
1. **Reference repository for acceptance criteria 2 and 3.** The candidates:
   - `collaborationFactory/clone-cplace-fe`, the test fork used by 34282/34283;
   - `cplace-remote-filesystem-fe`, the 34287 pilot and node24 validation repo;
   - `cplace-fe` itself.

   Criterion 3 ("no longer used in that reference repository") means auditing that repo's **own** workflow files, including direct `GIT_USER*` use, `squad-fe` pusher guards and any cross-repo checkout, and deleting the `GIT_USER_TOKEN`/`GIT_USER`/`GIT_USER_EMAIL` repo secrets. That also covers the R6 test that 34282 skipped.
2. **Cross-repo e2e checkout (U8).** Does any FE consumer repo check out another repo (for example `cplace-e2e` or test data) with the shared account? It doesn't happen in this repo. If it exists, a GitHub App is needed. Is there an existing App (for example the backend's `SVA_ACTIONS_READ_PRODUCT_*`) that can be reused for FE repos, or does a new one have to be requested?
3. **Overlap with PFM-ISSUE-34286.** Should 33676 also take over removing the release flow's git identity (U5), or only handle upmerge (U6) and leave U5 to 34286?
4. **Removing `required` secret declarations.** Callers that pass secrets explicitly (cplace-fe, the 2lforge repo, the `fe-check-upmerge` template) might fail if `GIT_USER*` is removed from `workflow_call.secrets` while they still pass it. The 34282 research's Open Q10 lists a related case to verify: cplace-fe `push_main.yaml` passes `GIT_USER_TOKEN` to `fe-snapshot.yml`, which no longer declares it. Options: make the declarations `required: false` first, then remove them later.
5. **Does upmerge need any identity?** The guess is that `cplace-cli flow --upmerge --no-push` creates local merge commits, which need `user.name`/`user.email`. This needs checking in `@cplace/cli` to decide between "bot identity" and "no identity".
6. **Retiring `fe-tag.yml`/`workflows/fe-release.yml`.** When can they be deleted (after release lines 25.4-26.4 reach end of life)? Is that in scope for 33676, or a separate cleanup?
7. **Side findings in upmerge, not about authentication but in the files being touched:** the undeclared `inputs.GHA_REF` (`fe-check-upmerge.yml:20`), the hard-coded `--release 5.17` (`upmerge.ts`), unquoted `git config` arguments, and `printenv` in the composite action.
8. **Template permissions for upmerge.** Should narrowing the `fe-check-upmerge` template to `contents: read` be done here, or left to PFM-ISSUE-35504?
