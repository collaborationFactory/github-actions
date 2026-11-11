---
date: 2026-10-26T17:16:49+01:00
git_commit: 87feb8e4218d9fe87791883f9f683ddca3106e05
branch: improvement/PFM-ISSUE-34282-Use-GITHUB_TOKEN-with-scoped-permissions-for
topic: "PFM-ISSUE-34282 - Use GITHUB_TOKEN with scoped permissions for in-repo tag and release"
tags: [research, codebase, github-actions, fe-release-flow, github-token, permissions, pat, git-user-token]
status: complete
last_updated: 2026-11-11
last_updated_note: "Refreshed against PR #183 head 4666f60 (via 87feb8e): updated line references; added the promote phase, the ls-remote exit-code handling, the guard's comment handling and the fe-main.yml concurrency change"
---

# Research: Use GITHUB_TOKEN with scoped permissions for in-repo tag and release

**Date**: 2026-10-26T17:16:49+01:00, refreshed 2026-11-11T11:41:22+01:00
**Git Commit**: 87feb8e4218d9fe87791883f9f683ddca3106e05 (first version: 69021ec)
**Branch**: improvement/PFM-ISSUE-34282-Use-GITHUB_TOKEN-with-scoped-permissions-for, based on PR #183 head `4666f60`

## Research Question

How does the FE release flow authenticate its in-repo tag and release today? What has to change to move it to the built-in `GITHUB_TOKEN` with least-privilege, job-scoped permissions, following the backend pattern? Which of the ticket's candidate permissions actually have a consumer?

The research builds on PR #183 (PFM-ISSUE-34283). That PR replaces `fe-tag.yml` + `fe-release.yml` with one consolidated flow: the reusable `.github/workflows/fe-release-flow.yml`, called from the `.github/workflow-templates/fe/fe-release.yml` caller template. 34282 applies to that consolidated flow, not to the deprecated pair.

**Refresh (2026-11-11).** The first version was recorded at `69021ec`. PR #183 has had 11 more commits since (live tests and review fixes, up to `4666f60`). They changed `fe-release-flow.yml`, `fe-main.yml`, `README.md` and the artifacts tool. Every line reference below is re-checked against `87feb8e`. The section "Changes since the first version" lists what changed and how it affects this ticket.

## PFM Ticket Context

- **Ticket**: [PFM-ISSUE-34282](https://base.cplace.io/pages/p9vu89ujy61fxb2nrrp6focwy/PFM-ISSUE-34282-Use-GITHUB-TOKEN-with-scoped-permissions-for-in-repo-tag-and-release)
- **Title**: Use GITHUB_TOKEN with scoped permissions for in-repo tag and release
- **Type**: PFM Issue, Groundwork (priority high, status Working)
- **Target Release**: not set
- **Assignee**: Vladimir Arsov
- **Epic**: WP-1963 Modernize FE 2.0 Frontend Workflow Authentication
- **Relations**: blocked by PFM-ISSUE-34283 (release-flow consolidation, PR #183); relates to PFM-ISSUE-33676 (replace the shared GitHub user account in frontend workflows)
- **Suggested Branch**: `improvement/PFM-ISSUE-34282-Use-GITHUB_TOKEN-with-scoped-permissions-for` (exists; draft PR #189, based on the PR #183 branch)
- **Description**:

  > **Description**
  > Switch `fe-tag.yml` / `fe-release.yml` to the built-in `GITHUB_TOKEN` for in-repo tag and release, scoped narrowly to the release/tag job. This follows the backend pattern and removes the shared user PAT from the tagging/release path.
  >
  > **Requirements**
  > - Grant `GITHUB_TOKEN` **only on the release/tag job** (not workflow-wide), so build/test/install jobs that run third-party code do not inherit write scope.
  > - Baseline permissions: `contents: write`, `checks: write`, `pull-requests: write`.
  > - Confirm whether `issues: read` and `actions: write` are actually needed (current FE templates run `actions: read` and no `issues`) and drop any without a consumer.
  > - Remove use of the shared user PAT for tagging/releasing.
  >
  > **Acceptance Criteria**
  > - In-repo tag/release authenticates via `GITHUB_TOKEN` with least-privilege, job-scoped permissions.
  > - The shared user PAT is no longer used for tagging/releasing.
  >
  > **Dependencies**
  > Depends on the release-flow consolidation (applied to the already-consolidated workflow). Relates to PFM-ISSUE-33676.

  The ticket was written before #183 and names `fe-tag.yml` / `fe-release.yml`. After #183, the target is `fe-release-flow.yml` and its caller template. The user confirmed this scope.

## Summary

- **One remaining PAT use.** The shared user PAT is used for tagging/releasing in exactly one place: the `release` job's checkout, `token: ${{ secrets.GIT_USER_TOKEN }}` (`fe-release-flow.yml:121`). Checkout persists that credential into `.git/config`. Two things then use it implicitly:
  - the artifacts tool's `git push origin <tag>` (`artifacts-handler.ts:313`);
  - the failure cleanup's `git ls-remote --exit-code` (`fe-release-flow.yml:176`).

  Nothing in the tool handles a token itself. The GitHub release is already created with `github.token` in the `github-release` job (`fe-release-flow.yml:198-222`).
- **The switch is small.**
  - Drop `token:` from the release checkout. The default is `github.token`.
  - Raise the `release` job from `contents: read` (`:110-111`) to `contents: write`.
  - Remove the `GIT_USER_TOKEN` secret declaration (`fe-release-flow.yml:24-25`).
  - The caller template already grants `contents: write` at workflow level and uses `secrets: inherit`. No consumer change is needed, so removing a declared secret is safe.
- **Permissions without a consumer.** Of the ticket's baseline, only `contents: write` has a consumer in the release flow. Nothing in `fe-release-flow.yml`, the nested `fe-install-deps` / `fe-build` / `fe-e2e` workflows or the composite actions calls the Checks, Pull Requests, Issues or Actions APIs. Re-checked on `87feb8e`.
  - `checks: write`, `pull-requests: write`, `issues: read`, `actions: read` and `actions: write` all lack a consumer here.
  - The four-scope block in the other FE templates is inherited boilerplate. The only real `pull-requests`/`issues` consumer in the FE workflows is the PR comment in `fe-pr-snapshot.yml:76-88`, which is not part of the release flow.
  - Under "drop any without a consumer", the least-privilege answer is `contents: write` on the tag job, `contents: write` on the GitHub release job, and `contents: read` everywhere else.
- **Job-scoping is largely done already.** #183 gives every job its own `permissions:` block (`guard`, `install-deps`, `build`, `e2e` = `contents: read`; `github-release` = `contents: write`). The caller's `contents: write` is only a ceiling. What 34282 adds is moving `release` to write.
  - The `release` job itself runs `npm ci` and the TypeScript artifacts tool (third-party code) in the same job that holds the write token.
  - Today that job holds the broader PAT, so the switch reduces exposure. Write scope is still not fully isolated from third-party code (see Architecture Insights).
- **The order inside the `release` job is now publish → promote → tag** (new since the first version). A tag push that fails comes after `release-X.Y` was moved on every package. The cleanup then unpublishes the version, and the promoted packages lose `release-X.Y` until the next release (README Recovery, `README.md:94-99`). A token that cannot push therefore costs more than before. Two cases that only surface at the push:
  - a missing `contents: write` on a nested job is **not** one of them: it fails at startup, before anything is published;
  - a future `version/*` tag ruleset without a bypass for GitHub Actions **would** be one.
- **The tag-push trigger goes away.** A tag pushed with `GITHUB_TOKEN` does not trigger other workflows.
  - That was the reason for the old two-run design, and why an earlier attempt was reverted (commits d6542fe/a416ad2, 2023-11). After #183 nothing needs that trigger.
  - A leftover `fe-tag-pushed.yml` / `on_tag_pushed.yaml` in a migrated tree can then no longer double-publish.
  - The README (`:54-59`) and the template header (`fe-release.yml:1-5`) already promise this for 34282 and must be updated.
- **Backend pattern** (`cplace-gh-workflows`, PAT removed in commit 18ea38f3, 2024-01-19):
  - `GITHUB_TOKEN` is written to a credential store by `prepare-git-environment`, and the checkout uses `persist-credentials: false`.
  - The `gh` CLI uses `GH_TOKEN: ${{ github.token }}`.
  - The git identity is `github.actor` / `cplace@github.com`.
  - GitHub Apps remain for cross-repo access and protected-branch pushes only.
  - The backend does not declare job-level permissions on `publish.yml`; it relies on the caller's grant. The FE flow after #183 is already stricter than the backend.

## Changes since the first version (69021ec → 87feb8e)

| Area | Change | Effect on 34282 |
|---|---|---|
| `fe-release-flow.yml` guard (`:59-68`) | The grep ignores comment lines (`^[^#]*…`); a commented-out old caller no longer fails the guard. The comment now also names old `fe-tag.yml` callers (branch push), which would tag in parallel. | The guard keeps a purpose after 34282: an old `fe-tag.yml` caller would still tag in parallel with the PAT. Only the "a PAT-pushed tag re-fires a tag-push caller" part of its rationale goes away. |
| `fe-release-flow.yml` cleanup (`:163-186`) | `git ls-remote --exit-code` result split: 0 = tag pushed, 2 = not pushed (unpublish), anything else (auth, network) = error, nothing unpublished. | The cleanup reads the remote with the persisted checkout credential. With `GITHUB_TOKEN` (`contents: read` is enough to read) this keeps working. If the credential were missing, the step would now fail loudly instead of unpublishing a release whose tag may exist. |
| Artifacts tool: staging and promote (`artifacts-handler.ts:293-309`, `nx-project.ts:356-403`) | Release packages are published under `release-X.Y-pending`. A promote phase (`npm dist-tag add`/`rm` against JFrog) moves `release-X.Y` before the tag push. | No GitHub token involved (JFrog credentials only). It raises the cost of a failed tag push: see Summary. |
| Artifacts tool: `[branch-off]` with force (`artifacts-handler.ts:118-127`) | A forced dispatch on a `[branch-off]` tip ends with the warning "FORCE is ignored". | None. |
| Artifacts tool: version calculation (`utils.ts:198-223`) | `nextVersion(branch, previous)` extracted; behaviour unchanged. | None. |
| `fe-install-deps.yml` | The job-level `concurrency` (cancel superseded runs) was removed in #183; each caller decides. | It was not a consumer of `actions:` (`concurrency` needs no token scope). The consumer `push_main.yaml:9` comment ("actions: write … for cancel-workflow-action") in cplace-fe is stale. |
| `fe-main.yml` template (`:14-16`) | The `concurrency` group was removed: every push to main must publish its snapshot. The four-scope `permissions:` block (`:8-12`) is unchanged. | See section 3a: the main chain has no consumer for any scope beyond `contents: read`. |
| README | New: the publish → promote → tag order, the staging tag, the extended Recovery section, the concurrency table. Unchanged: the 34282 migration note (`:54-59`) and the secret list (`:84-88`). | Text to update moves to new lines (section 8). |

## Detailed Findings

### 1. Current authentication in the consolidated flow (`fe-release-flow.yml`)

**Secret contract and top-level permissions**
- Declared secrets (`fe-release-flow.yml:15-31`):
  - JFrog/npm: `JFROG_BASE64_TOKEN`, `JFROG_URL`, `JFROG_USER`, `DOT_NPMRC`. Out of scope; the JFrog secret split is a separate EPIC-1963 item.
  - Shared user: `GIT_USER_TOKEN` (`:24-25`), `GIT_USER` (`:26-27`), `GIT_USER_EMAIL` (`:28-29`), all `required: true`.
  - Optional: `PERCY_TOKEN` (`:30-31`).
- There is no workflow-level `permissions:`. Every job declares its own.

**Per-job permissions and token use**

| Job | Lines | `permissions` | Token use |
|---|---|---|---|
| `guard` | 38-68 | `contents: read` (`:40-41`) | Dispatch-ref check (`:43-52`). Sparse checkout of `.github/workflows`, default token, `persist-credentials: false` (`:54-57`). Fails if a non-comment line of any workflow references `fe-release.yml@` / `fe-tag.yml@` (`:62-68`). |
| `install-deps` | 70-78 | `contents: read` (`:72-73`) | Nested `fe-install-deps.yml@master`, default-token checkout, `DOT_NPMRC` only. |
| `build` | 80-87 | `contents: read` (`:82-83`) | Nested `fe-build.yml@master`, default-token checkout. |
| `e2e` | 89-99 | `contents: read` (`:92-93`) | Nested `fe-e2e.yml@master`, `PERCY_TOKEN`. |
| `release` | 101-196 | `contents: read` (`:110-111`) | **Checkout with `token: ${{ secrets.GIT_USER_TOKEN }}`** (`:117-121`, `fetch-depth: 0`), persisted. `npm ci` on cache miss (`:139-141`). `git config user.name/email` from `GIT_USER`/`GIT_USER_EMAIL` (`:143-149`). The artifacts action publishes, promotes, then tags and pushes (`:151-159`). The failure cleanup runs `git ls-remote --exit-code --tags origin` (`:163-186`, call at `:176`), then unpublishes (`:188-196`). |
| `github-release` | 198-222 | `contents: write` (`:203-204`) | No checkout. `GH_TOKEN: ${{ github.token }}` (`:208`). Runs `gh release view` (`:214`) / `gh release create --verify-tag --generate-notes` (`:218-222`). |

**Why `contents: read` works today:** the PAT, not `GITHUB_TOKEN`, carries the tag push. After the switch the job must declare `contents: write`. A job-level block replaces whatever it would otherwise inherit.

### 2. Git operations performed by the artifacts tool

- `.github/actions/artifacts/action.yml` runs `printenv`, `npm ci`, then `npx ts-node tools/scripts/artifacts/main.ts`. It reads no GitHub token env var. `printenv` is harmless for the persisted checkout credential, because that is stored in `.git/config`, not in the environment.
- The release flow path is `tagAndPublishRelease` (`artifacts-handler.ts:225-320`):
  - It computes the next version from the previous tag of the line (`Utils.nextVersion`, `:254`) and checks affected projects unless forced.
  - It publishes all publishable projects under the staging dist-tag `release-X.Y-pending` (`:296-297`).
  - Promote phase (`:302-309`): `NxProject.promote()` runs `npm dist-tag add <pkg>@<v> release-X.Y` and `npm dist-tag rm <pkg> release-X.Y-pending` against JFrog (`nx-project.ts:371-403`).
  - Tag phase (`:311-313`): `git tag ${gitTag}`, which creates a **lightweight** tag, and `git push origin ${gitTag}`.
  - It writes the `tag` / `previous_tag` / `is_latest` outputs.
  - There is no commit, no branch push, and no REST or Octokit call.
- The version file for the cleanup is written to `$RUNNER_TEMP/fe-release-version` before publishing (`utils.ts:19`, `:366-372`).
- The legacy `bumpVersionForReleaseBranch` (`artifacts-handler.ts:203-223`, `git tag`/`git push` at `:211`/`:215`) is used only by the deprecated `fe-tag.yml` (`ONLY_BUMP_VERSION`, `fe-tag.yml:59`).
- Remote reads go through `git ls-remote --tags` in `utils.ts:228`. Affected detection (`npx nx show projects --affected`, `utils.ts:157`) needs full history (`fetch-depth: 0`) but no write access.
- `npm publish` / `npm unpublish` / `npm dist-tag` (`nx-project.ts:115`, `:276`, `:379`, `:393`) use JFrog credentials (`jfrog-credentials.ts:7-12`). This is out of scope.

### 3. Permission consumers: confirm or drop

| Scope | Ticket position | Consumer in the release flow chain | Consumer elsewhere in FE workflows |
|---|---|---|---|
| `contents: write` | baseline | Yes: tag push (`artifacts-handler.ts:313`), `gh release create` (`fe-release-flow.yml:222`) | deprecated `fe-tag.yml` (via PAT) |
| `contents: read` | — | checkouts in every job, `git ls-remote` | all |
| `checks: write` | baseline | **None.** No check-run or test-reporter step | None found. It appears only in the template boilerplate. |
| `pull-requests: write` | baseline | **None.** No PR comment or PR creation | `fe-pr-snapshot.yml:76-88` (`actions/github-script`, `issues.*Comment` on the PR). Not in the release chain. |
| `issues: read` | confirm | **None** | None |
| `actions: read` | (templates) | **None.** Cache and artifacts use the runtime token, not `GITHUB_TOKEN` | None. Since #183 removed the job-level `concurrency` from `fe-install-deps.yml`, nothing in the FE chain even looks related. |
| `actions: write` | confirm | **None.** No dispatch, cancel or cache-delete | None in this repo |

The FE templates' four-scope block appears in `fe-check-upmerge.yml:7-11`, `fe-cleanup-snapshots.yml:7-11`, `fe-licenses.yml:8-12`, `fe-main.yml:8-12`, `fe-pr.yml:7-11`, `fe-pr-close.yml:8-12` and `fe-pr-snapshot.yml:8-12`. It is the probable origin of the ticket's baseline. The new `fe-release.yml` template (`:18-19`) already narrowed to `contents: write` only.

### 3a. The main chain (`fe-main.yml` template)

New in this refresh, because the live test plan runs the main CI.
- `fe-main.yml` grants the four-scope block at workflow level (`:8-12`). Its jobs `install-deps`, `e2e-tests`, `build`, `snapshot` call `fe-install-deps`, `fe-e2e`, `fe-build`, `fe-snapshot` `@master` **without** job-level `permissions:` (`:22-56`). Every job of the main chain therefore holds `contents: write`, `pull-requests: write`, `checks: write`, `actions: read`. That includes `npm ci`, the builds and the snapshot publish.
- None of those workflows or the composite actions calls a GitHub API (grep on `87feb8e`: no `github-script`, `gh`, `GH_TOKEN`, `github.token`, `issues.`, `checks`). `fe-snapshot.yml` only checks out (default token, `:26-29`) and publishes to JFrog (`:41-49`). **The main chain needs `contents: read` and nothing else.**
- This is the same "build/install jobs run third-party code with write scope" exposure the ticket names, but on the main CI rather than the tag/release path. It is not covered by the ticket's wording (see Open Questions).
- The consumer `clone-cplace-fe`/`cplace-fe` `push_main.yaml` already grants only `contents: read` and `actions: write`; the `actions: write` comment refers to the cancel action that no longer exists.

### 4. Caller template and consumers

- `.github/workflow-templates/fe/fe-release.yml`:
  - Triggers on `push` to `release/*` and on `workflow_dispatch(force)` (`:7-16`).
  - Grants `permissions: contents: write` at workflow level (`:18-19`).
  - Uses a non-cancelling `concurrency` group `fe-release-${{ github.ref }}` (`:21-24`).
  - Its single job calls `fe-release-flow.yml@master` with `secrets: inherit` (`:26-32`).
  - The header comment (`:1-5`) says the flow "still pushes the tag with the PAT" and that "PFM-ISSUE-34282 ... removes the tag-push trigger for good". 34282 must update it.
- **The caller grant is a ceiling.** A called workflow's jobs can only narrow it; requesting a scope the caller didn't grant fails at validation, before any job starts. The backend has hit this (`cplace-gh-workflows/specs/2026-07-27_build-cache-key-output/plan.md:1081-1104`). Since 34282 needs only `contents: write`, the existing caller grant is enough. Adding `checks`/`pull-requests` to the flow's job would require changing every migrated caller, which is a further reason not to add unused scopes.
- **`secrets: inherit`** was chosen in #183 so that removing `GIT_USER_TOKEN` (34282) and `GIT_USER*` (34286) needs no caller edits (34283 design.md:236, :82-85). Inherited secrets the callee doesn't declare are simply not passed.
- **Unmigrated consumers** still use the old pair with explicit secrets and are unaffected:
  - `cplace-2lforge-scores-fe/.github/workflows/fe-release.yml`: `write-all`, explicit `GIT_USER_TOKEN`/`GIT_USER`/`GIT_USER_EMAIL`, `@release/26.1`.
  - `cplace-fe/.github/workflows/push_to_release.yaml`: four-scope block, `if: github.event.pusher.name != 'squad-fe'` at `:43`, explicit PAT, `fe-tag.yml@master`.
  - Both keep working because 34282 leaves `fe-tag.yml` (`GIT_USER_TOKEN` at `:19`, checkout `token:` at `:37`) as is. The release lines 25.4-26.4 keep the old flow and the PAT until they branch off from a master that has the new flow (34283 design.md:297).

### 5. Precedent in this repo: PFM-ISSUE-34285

Commit faa4771 (2026-10-07, #182) removed `GIT_USER_TOKEN` (declared `required: false`) from the `workflow_call.secrets` of `fe-snapshot.yml` (now `:12-18`, JFrog secrets only). Its checkout already used the default token, so the PAT was never needed there. The pattern was to drop the declaration and the `token:`, and rely on the default `github.token`.

Note: `cplace-fe/.github/workflows/push_main.yaml:45-49` still passes `GIT_USER_TOKEN` explicitly to `fe-snapshot.yml@master`, which no longer declares it (see Open Questions).

### 6. Backend pattern (`C:\rr\cplace-gh-workflows`)

Not re-checked in this refresh (outside this repo, unchanged by #183).

**Tag/release path.** `publish.yml` and `complete-build.yml`:
- Workflow env `GH_TOKEN: ${{ github.token }} # this variable is used by gh cli` (`publish.yml:34`, `complete-build.yml:111`).
- Checkout with `persist-credentials: false` and no `token:` (`publish.yml:49-53`).
- `prepare-git-environment` is called with `github_token: ${{ secrets.GITHUB_TOKEN }}` before publishing and again right before the tag push (`publish.yml:72-76`, `:87-91`).
- The action writes `https://x-access-token:${token}@github.com` to `~/.git-credentials`, sets `credential.helper store`, `user.email cplace@github.com` and `user.name ${github.actor}` (`.github/actions/prepare-git-environment/action.yml:46-60`).
- The tag push runs `git push --atomic origin "$tag"` with retries (`src/scripts/push_local_tag.sh:75`).
- The release is created with `gh release create --generate-notes` (`src/scripts/publish_github_release_notes.sh:36-49`).

**Ordering.** Publish artifacts first, then tag push, then GitHub release. #183 has the same order, with the extra promote phase between publish and tag.

**Permissions.**
- Neither `publish.yml` nor the build chain declares `permissions:`. The consumer caller supplies them.
- Job-level blocks appear only for PR/check writers, e.g. `test.yml:200-203` (`contents: read, checks: write, pull-requests: write`) and `quality-analysis.yml:50-53`.
- Job-level `contents: write` is used by `auto-pr-upmerge.yml:78-79` and `integration-e2e-orchestrator.yml:75-78`.

**History.** The backend's PAT ("patch release user and token") was removed in `18ea38f3` (2024-01-19, Vladimir Arsov). It removed `.github/actions/patch-release-configure-git` and 3 lines each from `publish.yml` and `complete-build.yml`. Leftover: `publish_github_release_notes.sh:146` still runs `export GITHUB_TOKEN=$ENV_PATCH_RELEASE_TOKEN`, a CircleCI remnant that is unset in Actions. `gh` then uses `GH_TOKEN`.

**Where Apps remain.** GitHub Apps (`actions/create-github-app-token`) are kept for:
- Cross-repo reads (`SVA_ACTIONS_READ_PRODUCT_*`).
- Pushes to protected release branches with bypass (`SVA_ACTIONS_UPMERGE_*`).
- Cross-repo PR comments (`SVA_ACTIONS_PR_WRITER_*`).
- Cross-repo dispatch and PR authoring that must trigger workflows (`SVA_CONTAINER_BUILD_BOT_*`).

None of these applies to the FE in-repo tag and release.

**Differences from the backend worth deciding on (not prescribing):**
- **Credential handling.** The backend writes a global credential store and checks out with `persist-credentials: false`. The FE flow relies on checkout's persisted credential. Both work with `GITHUB_TOKEN`. Persisting through checkout is the smaller change and keeps the 34285 precedent.
- **Git identity.** The backend uses `github.actor`/`cplace@github.com`. The FE flow uses the `GIT_USER`/`GIT_USER_EMAIL` secrets. For the release flow, the tag is lightweight (`git tag ${gitTag}`, `artifacts-handler.ts:312`), so it records no tagger or author and the identity is never used. Removing the "Configure git user" step and the `GIT_USER*` declarations is formally PFM-ISSUE-34286 scope.

### 7. `GITHUB_TOKEN` limitations checked against the flow

| Limitation | Affects the FE release flow? |
|---|---|
| Pushes made with `GITHUB_TOKEN` do not trigger `on: push` workflows | Intended. Nothing in the consolidated flow depends on a tag-push trigger (`fe-tag-pushed.yml` template removed in #183). Leftover tag callers in migrated trees become inert. |
| Cannot bypass branch protection | No branch or commit push; only a `refs/tags/version/*` push. |
| Tag rulesets | None exist today (cplace-fe has four branch rulesets only, 34283 research.md:225; `clone-cplace-fe` has none). A future `version/*` ruleset (34283 Q10) would need the GitHub Actions identity as a bypass actor instead of `squad-fe`. Because the push comes after the promote phase, such a rejection would cost `release-X.Y` on every package until the next release. |
| Single repository only | The flow only touches its own repo. Nested `uses:` references to `collaborationFactory/github-actions` are resolved by GitHub, not by the token. |
| `--verify-tag` on release creation | The tag exists before `github-release` runs (it needs `release`), so it is unaffected. |
| Re-runs | A re-run of `github-release` uses the run's own `github.token`. Idempotent via `gh release view` (`:214`). |
| Repo default token permissions | `clone-cplace-fe` has `default_workflow_permissions: read`; the explicit job-level blocks make the default irrelevant for the release flow. |

### 8. Text that must change with the switch

- `fe-release-flow.yml:24-25` (the `GIT_USER_TOKEN` declaration), `:110-111` (`contents: read` → `write`), `:121` (`token:`).
- `.github/workflow-templates/fe/fe-release.yml:1-5` header comment ("still pushes the tag with the PAT").
- `README.md:54-59` (migration note: the PAT-pushed tag re-fires old callers; "PFM-ISSUE-34282 … removes the tag-push trigger for good"), `:86-88` (secrets list includes `GIT_USER_TOKEN`; caller needs `contents: write`), and possibly `:146` (GitHub release "Created with `GITHUB_TOKEN`", which then applies to the tag too).
- The `guard` job (`fe-release-flow.yml:59-68`): its comment names two risks. The tag-push-caller risk disappears once the tag isn't PAT-pushed. The `fe-tag.yml`-caller risk (tagging in parallel with the PAT) stays. Keep the job; re-word the comment and message if wanted. Not a correctness need.

## Code References

- `.github/workflows/fe-release-flow.yml:15-31` - workflow secret contract, including `GIT_USER_TOKEN` (`:24-25`)
- `.github/workflows/fe-release-flow.yml:38-68` - `guard` job (dispatch ref, old-caller check ignoring comments)
- `.github/workflows/fe-release-flow.yml:101-196` - `release` job: `contents: read` (`:110-111`), PAT checkout (`:117-121`), `npm ci` (`:139-141`), git identity (`:143-149`), publish+promote+tag (`:151-159`), cleanup check with `ls-remote --exit-code` (`:163-186`), unpublish (`:188-196`)
- `.github/workflows/fe-release-flow.yml:198-222` - `github-release` job, already `GITHUB_TOKEN` + `contents: write`
- `.github/workflow-templates/fe/fe-release.yml:1-32` - caller template: `contents: write`, concurrency, `secrets: inherit`, 34282 comment
- `.github/workflow-templates/fe/fe-main.yml:8-16` - four-scope block, no concurrency (main chain, section 3a)
- `.github/actions/artifacts/action.yml` - composite: `printenv`, `npm ci`, ts-node
- `tools/scripts/artifacts/artifacts-handler.ts:225-320` - `tagAndPublishRelease`; staging `:296`, promote `:302-309`, `git tag` / `git push origin` at `:312-313`
- `tools/scripts/artifacts/nx-project.ts:356-403` - `getTag()` (staging tag) and `promote()` (`npm dist-tag add/rm`)
- `tools/scripts/artifacts/artifacts-handler.ts:203-223` - legacy `bumpVersionForReleaseBranch` (deprecated `fe-tag.yml` only)
- `tools/scripts/artifacts/utils.ts:228` - `git ls-remote --tags`; `:366-372` version file for the cleanup
- `.github/workflows/fe-tag.yml:19,37,59` - deprecated tagger, still PAT-based; untouched by 34282
- `.github/workflows/fe-snapshot.yml:12-18` - 34285 precedent (no `GIT_USER_TOKEN`)
- `.github/workflows/fe-pr-snapshot.yml:76-88` - only real `pull-requests`/`issues` write consumer in the FE workflows (not the release chain)
- `README.md:54-59`, `:84-88`, `:94-99`, `:146` - PAT/secret documentation, Recovery for a failed promote/tag push
- `cplace-gh-workflows/.github/workflows/publish.yml:34,49-53,72-76,87-91` - backend `GH_TOKEN`, checkout, `GITHUB_TOKEN` credential setup
- `cplace-gh-workflows/.github/actions/prepare-git-environment/action.yml:46-60` - backend credential store + identity
- `cplace-gh-workflows/src/scripts/push_local_tag.sh:75` - backend tag push
- `cplace-gh-workflows/src/scripts/publish_github_release_notes.sh:36-49,146` - backend `gh release create`; leftover `ENV_PATCH_RELEASE_TOKEN` export

## Architecture Insights

- **Job-scoped least privilege is already the structure.** The caller grants a ceiling (`contents: write`), and every job in `fe-release-flow.yml` narrows explicitly. 34282 changes a single job's scope rather than introducing the pattern. This is stricter than the backend, which leaves permissions entirely to the caller. The main chain (`fe-main.yml`) has no such narrowing (section 3a).
- **Write scope next to third-party code.** The `release` job restores `node_modules` from cache, runs `npm ci` (`:139-141`) and runs the artifacts tool (another `npm ci` plus ts-node) in the same job that pushes the tag. The persisted credential in `.git/config` is readable by that code. Switching from the PAT (broad, long-lived, cross-repo) to `GITHUB_TOKEN` (this repo only, `contents: write`, expires with the job) is a large reduction in exposure, but not full isolation. Fuller isolation would need one of:
  - (a) checkout with `persist-credentials: false`, plus credentials injected only for the push. The push currently happens inside the TS tool, so it would have to move out of the tool or receive the token in env. The cleanup's `ls-remote` would need the same credential (read is enough).
  - (b) moving the tag push into a separate job without `npm`. That conflicts with #183's "publish, promote, tag, unpublish on failure" design, which needs publish and tag in one job to decide cleanup (`:163-196`).

  This is a design decision, not a research finding. The ticket's wording ("build/test/install jobs ... do not inherit write scope") is met by the current job split.
- **The tag push is the last and most expensive failure point.** With the promote phase, a push failure leaves the version unpublished and `release-X.Y` removed from every promoted package. Anything that makes the token's push rights verifiable before publishing (for example a `git push --dry-run` of the tag ref early in the job; not verified whether GitHub checks push rights on a dry run) would move a rejection before the publish. This is a design option, not a requirement of the ticket.
- **The PAT's original reason is gone.** The PAT existed so the pushed tag would start the second run. #183 removed the second run, so the PAT has no remaining function in this flow. Also, `squad-fe` pusher guards in old consumer callers (`cplace-fe push_to_release.yaml:43`) become moot once tags are not pushed by `squad-fe`. Tags never retrigger a `push: branches` workflow anyway.
- **Secret-contract changes are decoupled from consumers** through `secrets: inherit`. The new flow can drop declarations freely. The deprecated reusables keep their contracts for explicit-secret callers.

## Historical Context (from specs/)

- `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/research.md:57,254-255` - the two-run split exists only because a `GITHUB_TOKEN` tag push triggers nothing. The 2023 attempt (d6542fe) was reverted (a416ad2). Pushing the tag with `GITHUB_TOKEN` "would avoid the trigger entirely", which was deliberately left to 34282.
- `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/design.md:40,294` - 34283 works "under the current auth": the PAT pushes the tag and only the release uses `GITHUB_TOKEN`.
- `.../design.md:66,82-85,228-236` - per-job permissions; `secrets: inherit` chosen so 34282 / 34286 / the JFrog split need no caller edits.
- `.../design.md:97,100-101` - out of scope / handed off: 34282 (GITHUB_TOKEN tag push), 34286 (retire `GIT_USER*`), 34284 (immutable releases), 34287 (pilot), Q10 (`version/*` tag ruleset, unowned).
- `.../clone-cplace-fe-live-tests.md` - the live-test environment in `collaborationFactory/clone-cplace-fe` (JFrog `cplace-npm-test`). Phase A (PAT tag push) passed A1–A12 on 2026-11-02/03 with retests on 2026-11-06; the A8 first run led to the staging tag; A9 documented cancelling as unsupported. Its Phase B sketch is superseded by this ticket's `live-test-plan.md`.
- `specs/2026-06-05_node24-workflow-migration/validation-log.md:33-41,71` - never test on real `release/*`; use `test/*` or throwaway lines. The FE flow has since been validated live in `clone-cplace-fe`.
- `specs/2026-06-05_node24-workflow-migration/plan.md:264` - `fe-pr-snapshot` PR comment already uses the default `github.token` via `actions/github-script` (the PR-decoration part of 33676).

## Related Research

- `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/` (research, design, plan, live tests) - the base this ticket builds on
- `specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/live-test-plan.md` - the live test plan for this ticket
- `specs/2026-06-05_node24-workflow-migration/` - action pinning, concurrency origin, validation rules
- `C:\rr\cplace-gh-workflows\specs\2026-07-27_build-cache-key-output\plan.md:1081-1104` - caller permission ceiling failure mode (backend)
- `C:\rr\cplace-gh-workflows\specs\2026-09-25_PFM-TASK-8475_e2e-via-integration-pr\design.md:59-61,248` - `GITHUB_TOKEN` trigger limitations; when an App is required

## Open Questions

1. **Permission baseline vs. "drop any without a consumer".** No consumer for `checks: write` or `pull-requests: write` (or `issues`, `actions`) in the release flow. Should the release/tag job get `contents: write` only? The ticket lists `checks`/`pull-requests` as baseline, but its third requirement asks to drop unused scopes. Adding them would also require every migrated caller to grant them.
2. **Isolation of the write token inside the `release` job.** Is the PAT → job-scoped `GITHUB_TOKEN` reduction enough, or should the push credential be kept away from `npm ci` / the artifacts tool? Options: `persist-credentials: false` with a push-only credential (the cleanup's `ls-remote` needs a read credential too), or a separate push step outside the TS tool (conflicts with publish → promote → tag in one job).
3. **Git identity and `GIT_USER` / `GIT_USER_EMAIL`.** These are unused for a lightweight tag. Remove the "Configure git user" step and the declarations in 34282, or leave them for 34286 as planned?
4. **Credential style.** Persisted checkout credential (FE today, 34285 precedent) or the backend's `persist-credentials: false` + credential-store approach? The second implies a reusable action that this repo doesn't have.
5. **Caller template ceiling.** Keep `permissions: contents: write` at workflow level in the template, which is required as the ceiling for the release jobs, and update only the comments? Any template change only reaches consumers when they re-copy it.
6. **Guard job after the switch.** Keep it, and re-word its rationale: the tag-push-caller risk goes, the parallel-`fe-tag.yml` risk stays.
7. **Early push-rights check.** With publish → promote → tag, should the job verify it can push the tag before publishing (e.g. a dry-run push), so a rejection (a future tag ruleset) costs nothing? Needs a live check of what GitHub validates on a dry run.
8. **Main chain permissions (new).** The `fe-main.yml` template gives every main-CI job the four-scope block, but the chain needs only `contents: read` (section 3a). Narrowing it fits the ticket's intent but not its "tag and release" scope. Include in 34282, or leave to another EPIC-1963 item?
9. **Validation.** Covered by `live-test-plan.md` in `clone-cplace-fe` (release on `release/26.4`, main CI and forced release flow on `main`).
10. **Out of scope, observed:** `cplace-fe/.github/workflows/push_main.yaml:45-49` still passes `GIT_USER_TOKEN` explicitly to `fe-snapshot.yml@master`, which no longer declares it since 34285. GitHub may reject explicitly passed undeclared secrets. Worth checking that cplace-fe's main snapshot run still succeeds (separate from 34282).
