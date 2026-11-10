---
date: 2026-10-26T17:16:49+01:00
git_commit: 69021ec6a062b63e0b36e2c3ac6a250aba00038d
branch: improvement/PFM-ISSUE-34283-Consolidate-the-FE-2-0-release-flow-into-a-master
topic: "PFM-ISSUE-34282 - Use GITHUB_TOKEN with scoped permissions for in-repo tag and release"
tags: [research, codebase, github-actions, fe-release-flow, github-token, permissions, pat, git-user-token]
status: complete
last_updated: 2026-10-26
---

# Research: Use GITHUB_TOKEN with scoped permissions for in-repo tag and release

**Date**: 2026-10-26T17:16:49+01:00
**Git Commit**: 69021ec6a062b63e0b36e2c3ac6a250aba00038d
**Branch**: improvement/PFM-ISSUE-34283-Consolidate-the-FE-2-0-release-flow-into-a-master (PR #183)

## Research Question

How does the FE 2.0 release flow authenticate its in-repo tag and release today? What has to change to move it to the built-in `GITHUB_TOKEN` with least-privilege, job-scoped permissions, following the backend pattern? Which of the ticket's candidate permissions actually have a consumer?

The research builds on PR #183 (PFM-ISSUE-34283). That PR replaces `fe-tag.yml` + `fe-release.yml` with one consolidated flow: the reusable `.github/workflows/fe-release-flow.yml`, called from the `.github/workflow-templates/fe/fe-release.yml` caller template. 34282 applies to that consolidated flow, not to the deprecated pair.

## PFM Ticket Context

- **Ticket**: [PFM-ISSUE-34282](https://base.cplace.io/pages/p9vu89ujy61fxb2nrrp6focwy/PFM-ISSUE-34282-Use-GITHUB-TOKEN-with-scoped-permissions-for-in-repo-tag-and-release)
- **Title**: Use GITHUB_TOKEN with scoped permissions for in-repo tag and release
- **Type**: PFM Issue, Groundwork (priority medium, status Working)
- **Target Release**: not set
- **Assignee**: Vladimir Arsov
- **Epic**: EPIC-1963 Modernize FE 2.0 Frontend Workflow Authentication
- **Relations**: blocked by PFM-ISSUE-34283 (release-flow consolidation, PR #183); relates to PFM-ISSUE-33676 (replace the shared GitHub user account in frontend workflows)
- **Suggested Branch**: `improvement/PFM-ISSUE-34282-Use-GITHUB_TOKEN-with-scoped-permissions-for`
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

- **One remaining PAT use.** On this branch, the shared user PAT is used for tagging/releasing in exactly one place: the `release` job's checkout, `token: ${{ secrets.GIT_USER_TOKEN }}` (`fe-release-flow.yml:119`). Checkout persists that credential into `.git/config`. The artifacts tool's `git push origin <tag>` (`artifacts-handler.ts:297`) and the failure cleanup's `git ls-remote` (`fe-release-flow.yml:171`) then use it implicitly. Nothing in the tool handles a token itself. The GitHub release is already created with `github.token` in the `github-release` job (`fe-release-flow.yml:188-212`).
- **The switch is small.**
  - Drop `token:` from the release checkout. The default is `github.token`.
  - Raise the `release` job from `contents: read` to `contents: write`.
  - Remove the `GIT_USER_TOKEN` secret declaration from `fe-release-flow.yml:24-25`.
  - The caller template already grants `contents: write` at workflow level and uses `secrets: inherit`. No consumer change is needed, so removing a declared secret is safe.
- **Permissions without a consumer.** Of the ticket's baseline, only `contents: write` has a consumer in the release flow. Nothing in `fe-release-flow.yml` or the nested `fe-install-deps` / `fe-build` / `fe-e2e` workflows calls the Checks, Pull Requests, Issues or Actions APIs.
  - `checks: write`, `pull-requests: write`, `issues: read`, `actions: read` and `actions: write` all lack a consumer here.
  - The four-scope block in the other FE templates (`contents/pull-requests: write`, `actions: read`, `checks: write`) is inherited boilerplate. The only real `pull-requests` consumer in the FE workflows is the PR comment in `fe-pr-snapshot.yml`, which is not part of the release flow.
  - Under "drop any without a consumer", the least-privilege answer is `contents: write` on the tag job, `contents: write` on the GitHub release job, and `contents: read` everywhere else.
- **Job-scoping is largely done already.** #183 gives every job its own `permissions:` block (`guard`, `install-deps`, `build`, `e2e` = `contents: read`; `github-release` = `contents: write`). The caller's `contents: write` is only a ceiling. What 34282 adds is moving `release` to write. The `release` job itself runs `npm ci` and the TypeScript artifacts tool (third-party code) in the same job that holds the write token. Today it holds the broader PAT there, so the switch reduces exposure, but write scope is not fully isolated from third-party code. See Architecture Insights.
- **The tag-push trigger goes away.** A tag pushed with `GITHUB_TOKEN` does not trigger other workflows. That was the reason for the old two-run design and why an earlier attempt was reverted (commits d6542fe/a416ad2, 2023-11). After #183 nothing needs that trigger. A leftover `fe-tag-pushed.yml` / `on_tag_pushed.yaml` in a migrated tree can then no longer double-publish. The README and template comments already promise this for 34282 and must be updated.
- **Backend pattern** (`cplace-gh-workflows`, PAT removed in commit 18ea38f3, 2024-01-19):
  - `GITHUB_TOKEN` is written to a credential store by `prepare-git-environment`, and the checkout uses `persist-credentials: false`.
  - The `gh` CLI uses `GH_TOKEN: ${{ github.token }}`.
  - The git identity is `github.actor` / `cplace@github.com`.
  - GitHub Apps remain for cross-repo access and protected-branch pushes only.
  - The backend does not declare job-level permissions on `publish.yml`; it relies on the caller's grant. The FE flow after #183 is already stricter than the backend.

## Detailed Findings

### 1. Current authentication in the consolidated flow (`fe-release-flow.yml`)

**Secret contract and top-level permissions**
- Declared secrets (`fe-release-flow.yml:15-31`):
  - JFrog/npm: `JFROG_BASE64_TOKEN`, `JFROG_URL`, `JFROG_USER`, `DOT_NPMRC`. Out of scope; the JFrog secret split is a separate EPIC-1963 item.
  - Shared user: `GIT_USER_TOKEN` (`:24`), `GIT_USER` (`:26`), `GIT_USER_EMAIL` (`:28`).
  - Optional: `PERCY_TOKEN` (`:30`).
- There is no workflow-level `permissions:`. Every job declares its own.

**Per-job permissions and token use**

| Job | Lines | `permissions` | Token use |
|---|---|---|---|
| `guard` | 38-66 | `contents: read` (`:40-41`) | Sparse checkout of `.github/workflows`, default token, `persist-credentials: false`. Fails if any workflow still references `fe-release.yml@` / `fe-tag.yml@`. |
| `install-deps` | 68-76 | `contents: read` (`:70-71`) | Nested `fe-install-deps.yml@master`, default-token checkout, `DOT_NPMRC` only. |
| `build` | 78-85 | `contents: read` (`:80-81`) | Nested `fe-build.yml@master`, default-token checkout. |
| `e2e` | 87-97 | `contents: read` (`:90-91`) | Nested `fe-e2e.yml@master`, `PERCY_TOKEN`. |
| `release` | 99-186 | `contents: read` (`:108-109`) | **Checkout with `token: ${{ secrets.GIT_USER_TOKEN }}`** (`:115-119`, `fetch-depth: 0`), persisted. `git config user.name/email` from `GIT_USER`/`GIT_USER_EMAIL` (`:141-147`). The artifacts action publishes, then tags and pushes (`:149-157`). Failure cleanup does `git ls-remote --tags origin` (`:171`), then unpublishes (`:178-186`). |
| `github-release` | 188-212 | `contents: write` (`:193-194`) | No checkout. `GH_TOKEN: ${{ github.token }}` (`:198`). Runs `gh release view` / `gh release create --verify-tag --generate-notes` (`:204-212`). |

**Why `contents: read` works today:** the PAT, not `GITHUB_TOKEN`, carries the tag push. After the switch the job must declare `contents: write`. A job-level block replaces whatever it would otherwise inherit.

### 2. Git operations performed by the artifacts tool

- `.github/actions/artifacts/action.yml:13-22` runs `printenv`, `npm ci`, then `npx ts-node tools/scripts/artifacts/main.ts`. It reads no GitHub token env var. `printenv` is harmless for the persisted checkout credential, because that is stored in `.git/config`, not in the environment.
- The release flow path is `tagAndPublishRelease` (`artifacts-handler.ts:219-302`):
  - It publishes all publishable projects first (`:290`).
  - Then it runs `git tag ${gitTag}` (`:296`), which creates a **lightweight** tag, and `git push origin ${gitTag}` (`:297`).
  - It writes the `tag` / `previous_tag` / `is_latest` outputs.
  - There is no commit, no branch push, and no REST or Octokit call.
- The legacy `bumpVersionForReleaseBranch` (`artifacts-handler.ts:197-217`) is used only by the deprecated `fe-tag.yml` (`ONLY_BUMP_VERSION`, `fe-tag.yml:59`).
- Remote reads go through `git ls-remote --tags` in `utils.ts:221`. Affected detection (`npx nx show projects --affected`, `utils.ts:157`) needs full history (`fetch-depth: 0`) but no write access.
- `npm publish` / `npm unpublish` (`nx-project.ts:112`, `:272`) use JFrog credentials (`jfrog-credentials.ts:7-12`). This is out of scope.

### 3. Permission consumers: confirm or drop

| Scope | Ticket position | Consumer in the release flow chain | Consumer elsewhere in FE workflows |
|---|---|---|---|
| `contents: write` | baseline | Yes: tag push (`artifacts-handler.ts:297`), `gh release create` (`fe-release-flow.yml:212`) | deprecated `fe-tag.yml` (via PAT) |
| `contents: read` | — | checkouts in every job, `git ls-remote` | all |
| `checks: write` | baseline | **None.** No check-run or test-reporter step | None found. It appears only in the template boilerplate. |
| `pull-requests: write` | baseline | **None.** No PR comment or PR creation | `fe-pr-snapshot.yml:75-88` (`actions/github-script`, `issues.*Comment` on the PR). Not in the release chain. |
| `issues: read` | confirm | **None** | None |
| `actions: read` | (templates) | **None.** Cache and artifacts use the runtime token, not `GITHUB_TOKEN` | None. The `cplace-fe/push_main.yaml:9` comment about cancel-workflow-action is stale. |
| `actions: write` | confirm | **None.** No dispatch, cancel or cache-delete | None in this repo |

The FE templates' four-scope block appears in `fe-check-upmerge.yml:7-11`, `fe-cleanup-snapshots.yml:7-11`, `fe-licenses.yml:8-12`, `fe-main.yml:8-12`, `fe-pr.yml:7-11`, `fe-pr-close.yml:8-12` and `fe-pr-snapshot.yml:8-12`. It is the probable origin of the ticket's baseline. The new `fe-release.yml` template (`:18-19`) already narrowed to `contents: write` only.

### 4. Caller template and consumers

- `.github/workflow-templates/fe/fe-release.yml`:
  - Triggers on `push` to `release/*` and on `workflow_dispatch(force)` (`:7-16`).
  - Grants `permissions: contents: write` at workflow level (`:18-19`).
  - Uses a non-cancelling `concurrency` group `fe-release-${{ github.ref }}` (`:21-24`).
  - Its single job calls `fe-release-flow.yml@master` with `secrets: inherit` (`:26-32`).
  - The header comment (`:1-5`) says the flow "still pushes the tag with the PAT" and that "PFM-ISSUE-34282 ... removes the tag-push trigger for good". 34282 must update it.
- **The caller grant is a ceiling.** A called workflow's jobs can only narrow it; requesting a scope the caller didn't grant fails at validation. The backend has hit this (`cplace-gh-workflows/specs/2026-07-27_build-cache-key-output/plan.md:1081-1104`). Since 34282 needs only `contents: write`, the existing caller grant is enough. Adding `checks`/`pull-requests` to the flow's job would require changing every migrated caller, which is a further reason not to add unused scopes.
- **`secrets: inherit`** was chosen in #183 so that removing `GIT_USER_TOKEN` (34282) and `GIT_USER*` (34286) needs no caller edits (34283 design.md:236, :82-85). Inherited secrets the callee doesn't declare are simply not passed.
- **Unmigrated consumers** still use the old pair with explicit secrets and are unaffected:
  - `cplace-2lforge-scores-fe/.github/workflows/fe-release.yml`: `write-all`, explicit `GIT_USER_TOKEN`/`GIT_USER`/`GIT_USER_EMAIL`, `@release/26.1`.
  - `cplace-fe/.github/workflows/push_to_release.yaml`: four-scope block, `if: github.event.pusher.name != 'squad-fe'` at `:43`, explicit PAT, `fe-tag.yml@master`.
  - Both keep working because 34282 leaves `fe-tag.yml` as is. The release lines 25.4-26.4 keep the old flow and the PAT until they branch off from a master that has the new flow (34283 design.md:297).

### 5. Precedent in this repo: PFM-ISSUE-34285

Commit faa4771 (2026-10-07, #182) removed `GIT_USER_TOKEN` (declared `required: false`) from the `workflow_call.secrets` of `fe-snapshot.yml`. Its checkout already used the default token, so the PAT was never needed there. The pattern was to drop the declaration and the `token:`, and rely on the default `github.token`.

Note: `cplace-fe/.github/workflows/push_main.yaml:45-49` still passes `GIT_USER_TOKEN` explicitly to `fe-snapshot.yml@master` (see Open Questions).

### 6. Backend pattern (`C:\rr\cplace-gh-workflows`)

**Tag/release path.** `publish.yml` and `complete-build.yml`:
- Workflow env `GH_TOKEN: ${{ github.token }} # this variable is used by gh cli` (`publish.yml:34`, `complete-build.yml:111`).
- Checkout with `persist-credentials: false` and no `token:` (`publish.yml:49-53`).
- `prepare-git-environment` is called with `github_token: ${{ secrets.GITHUB_TOKEN }}` before publishing and again right before the tag push (`publish.yml:72-76`, `:87-91`).
- The action writes `https://x-access-token:${token}@github.com` to `~/.git-credentials`, sets `credential.helper store`, `user.email cplace@github.com` and `user.name ${github.actor}` (`.github/actions/prepare-git-environment/action.yml:46-60`).
- The tag push runs `git push --atomic origin "$tag"` with retries (`src/scripts/push_local_tag.sh:75`).
- The release is created with `gh release create --generate-notes` (`src/scripts/publish_github_release_notes.sh:36-49`).

**Ordering.** Publish artifacts first, then tag push, then GitHub release. #183 has the same order ("publish before tag").

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
- **Git identity.** The backend uses `github.actor`/`cplace@github.com`. The FE flow uses the `GIT_USER`/`GIT_USER_EMAIL` secrets. For the release flow, the tag is lightweight (`git tag ${gitTag}`, `artifacts-handler.ts:296`), so it records no tagger or author and the identity is never used. Removing the "Configure git user" step and the `GIT_USER*` declarations is formally PFM-ISSUE-34286 scope.

### 7. `GITHUB_TOKEN` limitations checked against the flow

| Limitation | Affects the FE release flow? |
|---|---|
| Pushes made with `GITHUB_TOKEN` do not trigger `on: push` workflows | Intended. Nothing in the consolidated flow depends on a tag-push trigger (`fe-tag-pushed.yml` template removed in #183). Leftover tag callers in migrated trees become inert. |
| Cannot bypass branch protection | No branch or commit push; only a `refs/tags/version/*` push. |
| Tag rulesets | None exist today (cplace-fe has four branch rulesets only, 34283 research.md:225). A future `version/*` ruleset (34283 Q10) would need the GitHub Actions identity as a bypass actor instead of `squad-fe`. |
| Single repository only | The flow only touches its own repo. Nested `uses:` references to `collaborationFactory/github-actions` are resolved by GitHub, not by the token. |
| `--verify-tag` on release creation | The tag exists before `github-release` runs (it needs `release`), so it is unaffected. |
| Re-runs | A re-run of `github-release` uses the run's own `github.token`. Idempotent via `gh release view` (`:204`). |

### 8. Text that must change with the switch

- `fe-release-flow.yml:24-25` (the `GIT_USER_TOKEN` declaration), `:108-109` (`contents: read` → `write`), `:119` (`token:`).
- `.github/workflow-templates/fe/fe-release.yml:1-5` header comment ("still pushes the tag with the PAT").
- `README.md:43-48` (migration note on the PAT-pushed tag re-firing old callers), `:71-73` (secrets list includes `GIT_USER_TOKEN`; caller needs `contents: write`).
- The `guard` job (`fe-release-flow.yml:59-66`) and its failure message lose their double-publish rationale once the tag is pushed with `GITHUB_TOKEN`. They still catch a leftover caller of the deprecated reusables, which is still useful to flag. Keep it, or re-word it; not a correctness need.

## Code References

- `.github/workflows/fe-release-flow.yml:15-31` - workflow secret contract, including `GIT_USER_TOKEN` (`:24`)
- `.github/workflows/fe-release-flow.yml:38-66` - `guard` job (old-caller check)
- `.github/workflows/fe-release-flow.yml:99-186` - `release` job: `contents: read` (`:108-109`), PAT checkout (`:115-119`), git identity (`:141-147`), publish+tag (`:149-157`), failure cleanup (`:159-186`)
- `.github/workflows/fe-release-flow.yml:188-212` - `github-release` job, already `GITHUB_TOKEN` + `contents: write`
- `.github/workflow-templates/fe/fe-release.yml:1-32` - caller template: `contents: write`, concurrency, `secrets: inherit`, 34282 comment
- `.github/actions/artifacts/action.yml:13-22` - composite: `printenv`, `npm ci`, ts-node
- `tools/scripts/artifacts/artifacts-handler.ts:219-302` - `tagAndPublishRelease`; `git tag` / `git push origin` at `:296-297`
- `tools/scripts/artifacts/artifacts-handler.ts:197-217` - legacy `bumpVersionForReleaseBranch` (deprecated `fe-tag.yml` only)
- `tools/scripts/artifacts/utils.ts:221` - `git ls-remote --tags`
- `.github/workflows/fe-tag.yml:19,37,50-51,59` - deprecated tagger, still PAT-based; untouched by 34282
- `.github/workflows/fe-snapshot.yml:12-18` - 34285 precedent (no `GIT_USER_TOKEN`)
- `.github/workflows/fe-pr-snapshot.yml:75-88` - only real `pull-requests`/`issues` write consumer in the FE workflows (not the release chain)
- `.github/workflow-templates/fe/fe-main.yml:8-12` (and siblings) - the four-scope boilerplate block
- `README.md:43-48`, `:69-73` - PAT/secret documentation to update
- `cplace-gh-workflows/.github/workflows/publish.yml:34,49-53,72-76,87-91` - backend `GH_TOKEN`, checkout, `GITHUB_TOKEN` credential setup
- `cplace-gh-workflows/.github/actions/prepare-git-environment/action.yml:46-60` - backend credential store + identity
- `cplace-gh-workflows/src/scripts/push_local_tag.sh:75` - backend tag push
- `cplace-gh-workflows/src/scripts/publish_github_release_notes.sh:36-49,146` - backend `gh release create`; leftover `ENV_PATCH_RELEASE_TOKEN` export

## Architecture Insights

- **Job-scoped least privilege is already the structure.** The caller grants a ceiling (`contents: write`), and every job in `fe-release-flow.yml` narrows explicitly. 34282 changes a single job's scope rather than introducing the pattern. This is stricter than the backend, which leaves permissions entirely to the caller.
- **Write scope next to third-party code.** The `release` job restores `node_modules` from cache, runs `npm ci` (`:137-139`) and runs the artifacts tool (another `npm ci` plus ts-node) in the same job that pushes the tag. The persisted credential in `.git/config` is readable by that code. Switching from the PAT (broad, long-lived, cross-repo) to `GITHUB_TOKEN` (this repo only, `contents: write`, expires with the job) is a large reduction in exposure, but not full isolation. Fuller isolation would need one of:
  - (a) checkout with `persist-credentials: false`, plus credentials injected only for the push. The push currently happens inside the TS tool, so it would have to move out of the tool or receive the token in env.
  - (b) moving the tag push into a separate job without `npm`. That conflicts with #183's "publish before tag, unpublish on failure" design, which needs publish and tag in one job to decide cleanup (`:159-186`).

  This is a design decision, not a research finding. The ticket's wording ("build/test/install jobs ... do not inherit write scope") is met by the current job split.
- **The PAT's original reason is gone.** The PAT existed so the pushed tag would start the second run. #183 removed the second run, so the PAT has no remaining function in this flow. Also, `squad-fe` pusher guards in old consumer callers (`cplace-fe push_to_release.yaml:43`) become moot once tags are not pushed by `squad-fe`. Tags never retrigger a `push: branches` workflow anyway.
- **Secret-contract changes are decoupled from consumers** through `secrets: inherit`. The new flow can drop declarations freely. The deprecated reusables keep their contracts for explicit-secret callers.

## Historical Context (from specs/)

- `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/research.md:57,254-255` - the two-run split exists only because a `GITHUB_TOKEN` tag push triggers nothing. The 2023 attempt (d6542fe) was reverted (a416ad2). Pushing the tag with `GITHUB_TOKEN` "would avoid the trigger entirely", which was deliberately left to 34282.
- `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/design.md:40,294` - 34283 works "under the current auth": the PAT pushes the tag and only the release uses `GITHUB_TOKEN`.
- `.../design.md:66,82-85,228-236` - per-job permissions; `secrets: inherit` chosen so 34282 / 34286 / the JFrog split need no caller edits.
- `.../design.md:97,100-101` - out of scope / handed off: 34282 (GITHUB_TOKEN tag push), 34286 (retire `GIT_USER*`), 34284 (immutable releases), 34287 (pilot), Q10 (`version/*` tag ruleset, unowned).
- `.../plan.md:679-682` - guard job + deprecation notices + README link to 34282 (PR review follow-ups).
- `specs/2026-06-05_node24-workflow-migration/validation-log.md:33-41,71` - never test on real `release/*`; use `test/*` or throwaway lines (e.g. `release/99.1` in cplace-remote-filesystem-fe). No live release-pipeline run has been done for the FE flow.
- `specs/2026-06-05_node24-workflow-migration/plan.md:264` - `fe-pr-snapshot` PR comment already uses the default `github.token` via `actions/github-script` (the PR-decoration part of 33676).

## Related Research

- `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/` (research, design, plan) - the base this ticket builds on
- `specs/2026-06-05_node24-workflow-migration/` - action pinning, concurrency origin, validation rules
- `C:\rr\cplace-gh-workflows\specs\2026-07-27_build-cache-key-output\plan.md:1081-1104` - caller permission ceiling failure mode (backend)
- `C:\rr\cplace-gh-workflows\specs\2026-09-25_PFM-TASK-8475_e2e-via-integration-pr\design.md:59-61,248` - `GITHUB_TOKEN` trigger limitations; when an App is required

## Open Questions

1. **Permission baseline vs. "drop any without a consumer".** The research finds no consumer for `checks: write` or `pull-requests: write` (or `issues`, `actions`) in the release flow. Should the release/tag job get `contents: write` only? The ticket lists `checks`/`pull-requests` as baseline, but its third requirement asks to drop unused scopes. Adding them would also require every migrated caller to grant them.
2. **Isolation of the write token inside the `release` job.** Is the PAT → job-scoped `GITHUB_TOKEN` reduction enough, or should the push credential be kept away from `npm ci` / the artifacts tool? Options are `persist-credentials: false` with a push-only credential, or a separate push step outside the TS tool. See Architecture Insights.
3. **Git identity and `GIT_USER` / `GIT_USER_EMAIL`.** These are unused for a lightweight tag. Remove the "Configure git user" step and the declarations in 34282, or leave them for 34286 as planned?
4. **Credential style.** Persisted checkout credential (FE today, 34285 precedent) or the backend's `persist-credentials: false` + credential-store approach? The second implies a reusable action that this repo doesn't have.
5. **Caller template ceiling.** Keep `permissions: contents: write` at workflow level in the template, which is required as the ceiling for the release jobs, and update only the comments? Any template change only reaches consumers when they re-copy it.
6. **Guard job after the switch.** Keep it as is, re-word its rationale, or reduce it? Its double-publish rationale disappears once the tag isn't PAT-pushed.
7. **Validation.** The switch has to be validated live on a throwaway line (e.g. `release/99.1` in cplace-remote-filesystem-fe, per the node24 validation rules), together with or after the 34287 pilot. The org/repo default workflow-token permissions and any `version/*` tag ruleset there need checking.
8. **Out of scope, observed:** `cplace-fe/.github/workflows/push_main.yaml:45-49` still passes `GIT_USER_TOKEN` explicitly to `fe-snapshot.yml@master`, which no longer declares it since 34285. GitHub may reject explicitly passed undeclared secrets. Worth checking that cplace-fe's main snapshot run still succeeds (separate from 34282).
