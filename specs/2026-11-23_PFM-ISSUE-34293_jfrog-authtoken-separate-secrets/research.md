---
date: 2026-11-23T14:45:45+01:00
git_commit: 3e8a45b364d0e9f6aae577fe230a0f85be09791c
branch: master
topic: "PFM-ISSUE-34293 — Introduce separate JFrog user and token secrets (plain _authToken)"
tags: [research, codebase, jfrog, npm-auth, secrets, artifacts-action, use-npmrc, dot-npmrc, fe-workflows, fe-repos]
status: complete
last_updated: 2026-11-23
---

# Research: PFM-ISSUE-34293 — Introduce separate JFrog user and token secrets (plain `_authToken`)

**Date**: 2026-11-23T14:45:45+01:00
**Git Commit**: 3e8a45b364d0e9f6aae577fe230a0f85be09791c
**Branch**: master

## Research Question
How do the shared FE workflows (`collaborationFactory/github-actions`) and the 15 frontend repos that call them authenticate against JFrog npm today? Specifically:
- where `JFROG_BASE64_TOKEN` (a combined user+token `_auth` blob) is used;
- what would need to change to use `//<registry>/:_authToken=${JFROG_TOKEN}` with separate, correctly named user and token secrets;
- how `DOT_NPMRC` relates to this. The user expects `DOT_NPMRC` to stay in use after the change, because the JFrog secret is used only inside the publish scripts.

Scope confirmed with the user:
- include `DOT_NPMRC` usage;
- ignore `specs/2026-11-16_PFM-ISSUE-34301_*` (unrelated);
- look up the caller workflows in all 15 FE repos.

## PFM Ticket Context
- **Ticket**: [PFM-ISSUE-34293](https://base.cplace.io/pages/writuvh8xnwnf0bzeo6c6u2hc/PFM-ISSUE-34293-Introduce-separate-JFrog-user-and-token-secrets-plain-auth-token)
- **Title**: Introduce separate JFrog user and token secrets (plain auth token)
- **Type**: PFM-ISSUE, groundwork. Priority high, status 50.working.
- **Target Release**: not set on the ticket. The planned date is 2026-10-26.
- **Assignee**: Vladimir Arsov
- **Epic**: WP-1963, Modernize FE 2.0 Frontend Workflow Authentication
- **Related**: PFM-ISSUE-33675, "Standardize JFrog npm read and publish authentication in frontend workflows" (relates to)
- **Suggested Branch**: `improvement/PFM-ISSUE-34293-Introduce-separate-JFrog-user-and-token-secrets`. The branch did not exist locally or on the remote at research time.
- **Description**:
  > Replace the base64 auth blob with the standard `_authToken` pattern, storing the JFrog user and token as **separate, correctly named secrets**. Storing them separately inherently retires the misnamed `JFROG_BASE64_TOKEN` (which actually holds a full user+token auth string), so no separate rename is needed.
  >
  > **Requirements**
  > - Use the `//<registry>/:_authToken=${JFROG_TOKEN}` pattern.
  > - Store the JFrog **user and token as separate secrets**; drop the combined base64 blob and the misleading `JFROG_BASE64_TOKEN` name.
  > - Update `.github/actions/artifacts` and any consuming workflows to use the new secrets.
  >
  > **Acceptance Criteria**
  > - NPM authentication uses a plain `_authToken` sourced from separate, correctly named secrets.
  > - The base64 blob and the `JFROG_BASE64_TOKEN` secret are no longer used.
  >
  > **Dependencies**
  > **First in Workstream B.** Tightly coupled with the `DOT_NPMRC` removal — introducing/using the new secrets and removing `DOT_NPMRC` should be executed as one coordinated cutover. Relates to PFM-ISSUE-33675.

## Summary

The shared workflows have **two independent npm auth paths**:

1. **Install/read path: `DOT_NPMRC`.**
   - The secret is an opaque, per-repo whole `.npmrc`.
   - The `use-npmrc` composite writes it verbatim to `~/.npmrc` and appends `replace-registry-host=never`.
   - It feeds `npm ci` in install-deps, licenses, sonar, release, pr-snapshot and pr-close, and `npm search`/`npm view` in cron snapshot cleanup.
   - The TypeScript tooling never reads it.
2. **Publish/delete path: `JFROG_URL`, `JFROG_USER`, `JFROG_BASE64_TOKEN`.**
   - Workflows pass these as step `env:` into the `artifacts`/`snapshots` composites.
   - `tools/scripts/artifacts/nx-project.ts:293-313` (`writeNPMRCInDist`) is the **single place** that writes `_auth=`. It produces a per-project `dist/<...>/.npmrc` containing `<scope>:registry=`, `_auth=<JFROG_BASE64_TOKEN>`, `always-auth=true` and `email=<JFROG_USER>`.
   - `npm publish`/`unpublish`/`show`/`dist-tag` run with that dist directory as `cwd`.
   - No JFrog REST API calls exist anywhere. Auth is purely npm-CLI driven.

Consequences for the ticket:
- **The code-level change for `_authToken` is small and well-contained.** It touches `jfrog-credentials.ts`, `nx-project.ts:writeNPMRCInDist`, the test fixture `test-data.ts:84-88`, and the env setup in four `artifacts-handler*.test.ts` files.
- **`JFROG_USER` is used only for the `email=` line today**, not for auth.
- **No `JFROG_TOKEN` exists anywhere yet.** It is not in the repo, not in any FE repo, and not at org level.
- **The research confirms the user's expectation that `DOT_NPMRC` stays in use after this ticket.** It is the only install auth, and in `cplace-fe` and `project-planning-fe` it also carries the third-party Bryntum registry token. It is consumed directly by many workflows in `cplace-fe`, `project-planning-fe` and `cplace-e2e` that never touch the shared workflows.
- **Rollout is the hard part, not the code.** All 14 workflow-calling FE repos pass secrets **explicitly** (no `secrets: inherit` today). The secret mapping is identical in every repo. Default branches follow `@master` live and `release/26.4` follows `@release/26.4`.
  - Adding a new **required** secret, or dropping a declared secret that callers still pass, breaks callers immediately.
  - The `fe-release-flow.yml` + `secrets: inherit` model from PFM-ISSUE-34283 is not yet rolled out to any of the 15 repos.

## Detailed Findings

### 1. TypeScript publish tooling (`tools/scripts/artifacts/`)

**Credential source**
- `jfrog-credentials.ts:7-13`: `JfrogCredentials` reads `JFROG_URL` → `url`, `JFROG_USER` → `user` and `JFROG_BASE64_TOKEN` → `base64Token`. Each defaults to `''`.
- `jfrog-credentials.ts:16-18`: `getJfrogUrlNoHttp()` strips `https:` to produce the nerf-dart key prefix `//host/...`.
- `configuration.ts:1-5`: `getJfrogUrl()` re-reads `JFROG_URL` with the default `https://cplace.jfrog.io/artifactory/cplace-npm-local` (the publish/local repo). It is used for `--registry=` on `npm show` and `npm dist-tag` (`nx-project.ts:187,379,395`) and in `getJfrogNpmArtifactUrl` (`nx-project.ts:98-100`).
- No `JFROG_TOKEN`, `NPM_TOKEN` or `NODE_AUTH_TOKEN` is read anywhere.

**The only `_auth` writer: `nx-project.ts:293-313`**
```
<scope>:registry=<JFROG_URL> \n
<//host/...>:_auth=<JFROG_BASE64_TOKEN> \n
<//host/...>:always-auth=true \n
<//host/...>:email=<JFROG_USER>
```
- Every line except the last ends with a literal trailing space.
- The key prefix has **no trailing slash**: `//host/artifactory/cplace-npm-local:_auth=…`.
- The full content is `console.log`ged at `nx-project.ts:306`. Today GitHub masks the secret value in the log.
- It is written to `<dist>/<apps|libs>/<proj>/.npmrc` (`getNpmrcPathInDist`, `nx-project.ts:419-421`).
- `package.json` in dist gets `publishConfig.registry = JFROG_URL`, `access: restricted` and a tag (`nx-project.ts:326-363`).

**Call sites**
- `artifacts-handler.ts:43` constructs `JfrogCredentials`.
- `artifacts-handler.ts:158` calls `writeNPMRCInDist(jfrogCredentials, scope)`, then `setVersionOrGeneratePackageJsonInDist(version, jfrogCredentials.url)` (`:160-163`), then `publish()` (`:166`).
- `artifacts-handler.ts:151-155` (`ONLY_DELETE_ARTIFACTS`) calls `deleteArtifact(currentVersion, jfrogCredentials)`.
- `artifacts-handler.ts:164-165` (PR snapshot) calls `deleteArtifact(currentVersion)` **without** credentials. It relies on the dist `.npmrc` written at `:158`.
- `nx-project.ts:236-291`, `deleteArtifact`: if dist is missing and credentials are passed, it writes the dist `.npmrc` (`:243-258`), then runs `packageExists` (`npm show`, `:186-218`) and `npm unpublish … --force` (`:275-282`).
- `nx-project.ts:371-403`, `promote()`: `npm dist-tag add/rm --registry=getJfrogUrl()` with `cwd` = dist.
- `nx-project.ts:164-175`, `deleteSnapshots(jfrogCredentials)`: accepts credentials but ignores them.
- `cleanup-snapshots.ts:88,101` constructs `JfrogCredentials` and calls `deleteArtifact(project.version, creds)`.

**Calls that do NOT use the JFrog secrets (they rely on `~/.npmrc` from `DOT_NPMRC`)**
- `cleanup-snapshots.ts:31-33`: `npm view <name> --json`, with no `cwd` and no `--registry`.
- `cleanup-snapshots.ts:69-71`: `npm search <scope> --json`, run from the repo root.
- `utils.ts:338`: `npm view <scope>/<pkg> --json`. Its `cwd`/options were not fully analyzed.

**Tests and fixtures that encode the current format**
- `test-data.ts:84-88` holds the exact expected 4-line `npmrc` (`jfrog_url:_auth=jfrog_base64_token`, `…:email=jfrog_user`).
- `artifacts-handler.test.ts:27-29` sets `JFROG_BASE64_TOKEN`, `JFROG_URL` and `JFROG_USER`. It asserts `npmrcContent` at `:100-101` (empty) and `:145-146` (equals the fixture).
- `artifacts-handler-branch-off.test.ts:6-8`, `artifacts-handler-release-flow.test.ts:8-10` and `artifacts-handler-tag.test.ts:9-11` set the same env vars.
- `nx-project.test.ts` asserts the `--registry=https://cplace.jfrog.io/artifactory/cplace-npm-local` commands (`:123,163,222,250-251`) but not the `.npmrc`.
- No test covers `jfrog-credentials.ts` directly.
- The `tools/scripts/lockfile/*.sh` scripts have no auth handling. They only compare `resolved` URLs against the proxy `https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/` (`lib.sh:20`).

### 2. Composite actions

| Action | Inputs | `.npmrc` handling | Env to TS |
|---|---|---|---|
| `.github/actions/use-npmrc/action.yml` | `dot-npmrc` (required, `:4-6`) | `echo "$DOT_NPMRC" > ~/.npmrc` (`:15`), then appends `replace-registry-host=never` (`:31`); then runs the advisory `warn-foreign-registry.sh` (`:33-47`) | none |
| `.github/actions/artifacts/action.yml` | none (outputs `tag`, `previous_tag`, `is_latest`) | none | `printenv` (`:16`), then `npm ci` in the github-actions checkout (`:18`), then `ts-node tools/scripts/artifacts/main.ts` (`:21`) with the caller step's `env:` |
| `.github/actions/snapshots/action.yml` | none | none | `printenv`, then `npm ci`, then `main-snapshots.ts` (`:6-11`) |
| `run-many`, `upmerge` | — | none | no JFrog/npmrc involvement |

Neither `artifacts` nor `snapshots` declares JFrog inputs. Credentials reach the TS only through the calling step's `env:`, so the "update `.github/actions/artifacts`" requirement mostly means updating the TS and the workflow `env:` blocks. `printenv` dumps the whole env, including any new token env var, into the log. Registered secrets are masked, but **derived** values are not.

### 3. Reusable workflows — declared secrets and consumption

All declarations are `on.workflow_call.secrets` with `required: true` unless noted.

| Workflow | JFrog/npm secrets declared | Consumption / purpose |
|---|---|---|
| `fe-install-deps.yml` | `DOT_NPMRC` (`:9-11`) | `use-npmrc`, then `npm ci` (`:32-39`). Install. |
| `fe-licenses.yml` | `DOT_NPMRC` (`:12-14`) | `use-npmrc`, then `npm ci`, then license check (`:38-54`). |
| `fe-sonar.yml` | `DOT_NPMRC` (+ `SONAR_CLOUD_TOKEN`) (`:6-12`) | `use-npmrc` only on a cache miss (`:56-61`). |
| `fe-snapshot.yml` | `JFROG_BASE64_TOKEN`, `JFROG_URL`, `JFROG_USER` (`:12-18`) | `artifacts` with `SNAPSHOT: true` (`:41-49`). **No `use-npmrc` and no `DOT_NPMRC`.** |
| `fe-pr-snapshot.yml` | 3× JFrog + `DOT_NPMRC` (`:9-17`) | `use-npmrc`, then `npm ci`, then `artifacts` (`:56-73`). |
| `fe-pr-close.yml` | 3× JFrog + `DOT_NPMRC` (`:9-17`) | `use-npmrc`, then `npm ci`, then `artifacts` with `ONLY_DELETE_ARTIFACTS` (`:38-56`). |
| `fe-cleanup-snapshots.yml` | 3× JFrog + `DOT_NPMRC` (`:5-13`) | `use-npmrc` (needed for `npm search`/`npm view` in the TS), then `snapshots` (`:36-46`). |
| `fe-release.yml` (deprecated) | 3× JFrog + `DOT_NPMRC` (`:5-13`) | `use-npmrc`, then `npm ci`, then `artifacts` with `TAG` (`:42-57`). |
| `fe-tag.yml` (deprecated) | 3× JFrog + `GIT_USER_TOKEN`/`GIT_USER`/`GIT_USER_EMAIL` (`:12-24`) | `artifacts` with `ONLY_BUMP_VERSION` (`:53-61`). It does not publish but still requires the JFrog secrets. |
| `fe-release-flow.yml` | 3× JFrog + `DOT_NPMRC` + `GIT_USER` + `GIT_USER_EMAIL` (`:15-27`); `PERCY_TOKEN` optional (`:28-29`) | `install-deps` job passes `DOT_NPMRC` (`:68-76`). `release` job: `use-npmrc` (`:131-134`), then `npm ci`, then `artifacts` publish (`:148-156`), plus the failure-cleanup `artifacts` unpublish (`:185-193`). |
| `fe-build`, `fe-code-quality`, `fe-e2e`, `pr-checks`, `fe-check-upmerge` | none JFrog/npm-related | They rely on the node_modules cache. |

**Starter templates** (`.github/workflow-templates/fe/`) pass the secrets explicitly by name:
- `fe-main.yml:28` (DOT_NPMRC) and `:54-56` (3× JFrog);
- `fe-pr.yml:28`;
- `fe-pr-snapshot.yml:20-23`, `fe-pr-close.yml:20-23` and `fe-cleanup-snapshots.yml:17-20`;
- `fe-licenses.yml:25`.

The exception is `fe-release.yml:32`, which uses `secrets: inherit` against `fe-release-flow.yml@master`.

**README**: `README.md:83-91` ("Required secrets") lists `JFROG_BASE64_TOKEN`, `JFROG_URL`, `JFROG_USER`, `DOT_NPMRC`, `GIT_USER`, `GIT_USER_EMAIL` and optional `PERCY_TOKEN`. `README.md:12-13` describes `use-npmrc`. Neither says what the secrets contain.

**Secret-to-purpose matrix**

| Secret | Purpose today |
|---|---|
| `JFROG_BASE64_TOKEN` | `_auth` in the dist `.npmrc`. Used for publish (snapshot, PR snapshot, release), unpublish (PR close, cron cleanup, failed-release cleanup), `npm show` and `dist-tag` promote. Passed but unused for auth in `fe-tag` (`ONLY_BUMP_VERSION`). |
| `JFROG_USER` | Only the `email=` line of the dist `.npmrc`. |
| `JFROG_URL` | Publish target and key prefix: `<scope>:registry=`, `publishConfig.registry`, `--registry=`. |
| `DOT_NPMRC` | All install auth (`npm ci`) and `npm search`/`view` in cleanup. Never used for publish. |
| `JFROG_TOKEN` | Does not exist yet. |

### 4. The 15 FE repos — caller workflows

The full raw notes are in the session scratchpad (`fe-callers.md`) and are not committed. Both the default branch and `release/26.4` were checked for every repo.

**The caller → secret mapping is identical in all 14 workflow-calling repos. None uses `secrets: inherit`.**

| Shared workflow | Secrets passed by callers |
|---|---|
| fe-install-deps | `DOT_NPMRC` |
| fe-licenses | `DOT_NPMRC` |
| fe-sonar | `SONAR_CLOUD_TOKEN` + `DOT_NPMRC` |
| fe-snapshot | `JFROG_BASE64_TOKEN` + `JFROG_URL` + `JFROG_USER`. On most `release/26.4` branches also `GIT_USER_TOKEN`, which is still optionally declared there. |
| fe-tag | 3× JFrog + `GIT_USER_TOKEN` + `GIT_USER` + `GIT_USER_EMAIL` |
| fe-release | 3× JFrog + `DOT_NPMRC` |
| fe-pr-snapshot, fe-pr-close, fe-cleanup-snapshots | 3× JFrog + `DOT_NPMRC` |

- Default branches reference `@master` and `release/26.4` references `@release/26.4`. Nothing is pinned to a SHA or an older ref.
- `master` is the default branch for most repos. `cplace-fe`, `cplace-loomeo-fe` and `cplace-dataciders-portfolio-management-fe` use `main`.

**Per-repo specifics**

| Repo | Notes |
|---|---|
| cplace-2lforge-toolbar-fe, cplace-2lforge-trees-fe, cplace-citizen-ai-fe, cplace-time-bounded-values-fe | Standard set: main, pr, release, tag-pushed, pr-snapshot, pr-close, licenses, cleanup-snapshots. |
| cplace-dataciders-portfolio-management-fe | Standard set; `fe-release` has no e2e. |
| cplace-loomeo-fe | main, pr, release, tag_pushed, pr-snapshot, pr-close. No e2e, licenses or cleanup. |
| cplace-lowcode-widget-builder-fe, cplace-paw-fe, cplace-remote-filesystem-fe | Standard set + sonar-scan (paw also has check-upmerge). |
| cplace-office-reports-fe, cplace-workflow-fe | Different file names (pr_open, push_main, push_release, …), same mapping. |
| cplace-project-planning-fe | No cleanup-snapshots; + sonar. **`bryntum-update.yml` uses `bduff9/use-npmrc@v1.1` with `DOT_NPMRC` directly.** It also has an extra `DOT_NPMRC_TEST` secret. |
| cplace-resource-management-fe | No cleanup-snapshots; + sonar. |
| **cplace-fe** | Full set under its own file names. Many **direct** `DOT_NPMRC` uses outside the shared workflows:<br>• pull_request_windows (bduff9 v1.2)<br>• four pull_request_visual_regression* workflows and xray-scan (bduff9 v2.0.0 pinned to a SHA)<br>• `devkit-test-template`, which receives `DOT_NPMRC` as a `workflow_call` secret from six `pull_request_devkit_*` callers and writes `~/.npmrc` with `printf`<br>• `deploy_storybook`, which uses the shared `use-npmrc@master` and passes `DOT_NPMRC_CONTENT` to `tools/storybook` CLIs. |
| **cplace-e2e** | **Calls no `github-actions` workflow.** `code-formatter.yml` and `continuous-integration.yml` use `bduff9/use-npmrc@v1.2` with `DOT_NPMRC`. Upmerge uses `cplace-gh-workflows@release/2.0` with `inherit`. It has **only `DOT_NPMRC`**: no `JFROG_*` and no `GIT_*` secrets. |

**Secret storage**
- Every FE repo holds its **own** copies of `JFROG_BASE64_TOKEN`, `JFROG_URL`, `JFROG_USER` and `DOT_NPMRC`.
- There is no org-level `JFROG_*`/`DOT_NPMRC` secret, and no repo variables exist.
- The org does have `ENV_CPLACE_ARTIFACTORY_ACTOR` and `ENV_CPLACE_ARTIFACTORY_TOKEN` (visible to all 15 repos, already used by `cplace-fe` xray-scan/devkit), plus the variable `CB_ENABLE_REWRITE_NPM_REGISTRY_URLS`.
- No committed `.npmrc` in any FE repo contains auth or registry lines. Four repos set `publishConfig` to `cplace-npm-local` in `package.json`.

### 5. Content of the current secrets

This comes from the user's local secrets comparison (`C:\cplace-dev\secrets fe repos\secrets-comparison.md`, outside the repo; no values are reproduced here).
- **`DOT_NPMRC` uses two auth styles.** Most repos use `_auth` (basic, base64 `user:password`). `cplace-e2e` and `cplace-resource-management-fe` already use `_authToken` with a JFrog **reference token**. This is evidence that JFrog npm accepts `_authToken` reference tokens for this instance.
- **`DOT_NPMRC` registries.**
  - `cplace-npm` (virtual, install) is used by all repos.
  - `cplace-npm-local` (publish) is used by most repos, sometimes bound to a package scope.
  - `npm.bryntum.com` uses `_authToken` (a long-lived JWT) in `cplace-fe` and `cplace-project-planning-fe`. Because of this third-party registry, `DOT_NPMRC` cannot simply be replaced by a JFrog-only `_authToken` line in those repos.
- **`JFROG_USER` does not match the `DOT_NPMRC` `_auth` identity in several repos** (office-reports, workflow, project-planning).
- **Several repos share one service account**: the two 2lforge repos; loomeo + dataciders; citizen-ai + office-reports + workflow at `.npmrc` level; and the generic squad account in fe, paw, project-planning, time-bounded-values and resource-management.

## Code References
- `tools/scripts/artifacts/jfrog-credentials.ts:7-18`: env read of `JFROG_URL`/`JFROG_USER`/`JFROG_BASE64_TOKEN` and the `getJfrogUrlNoHttp()` key prefix
- `tools/scripts/artifacts/configuration.ts:1-5`: `getJfrogUrl()` with the default `cplace-npm-local` URL
- `tools/scripts/artifacts/nx-project.ts:293-313`: `writeNPMRCInDist`, the only `_auth`/`always-auth`/`email` writer; logs the content at `:306`
- `tools/scripts/artifacts/nx-project.ts:186-218, 236-291, 371-403`: `packageExists`, `deleteArtifact`, `promote` (npm show/unpublish/dist-tag with dist `cwd`)
- `tools/scripts/artifacts/artifacts-handler.ts:43, 151-166`: credential construction, delete/publish sequence
- `tools/scripts/artifacts/cleanup-snapshots.ts:31-33, 69-71, 88, 101`: `npm view`/`npm search` via `~/.npmrc`; `deleteArtifact` with credentials
- `tools/scripts/artifacts/test-data.ts:84-88`: expected `.npmrc` fixture
- `tools/scripts/artifacts/artifacts-handler*.test.ts`: JFrog env setup and `npmrcContent` assertions
- `.github/actions/use-npmrc/action.yml:4-47`: writes `DOT_NPMRC` to `~/.npmrc` and appends `replace-registry-host=never`
- `.github/actions/artifacts/action.yml:16-22` and `.github/actions/snapshots/action.yml:6-11`: `printenv`, `npm ci`, `ts-node`
- `.github/workflows/fe-{snapshot,pr-snapshot,pr-close,cleanup-snapshots,release,tag,release-flow}.yml`: JFrog secret declarations and `env:` into the actions (lines in §3)
- `.github/workflows/fe-{install-deps,licenses,sonar}.yml`: `DOT_NPMRC`-only consumers
- `.github/workflow-templates/fe/*.yml`: explicit secret passing in caller templates; `fe-release.yml:32` uses `inherit`
- `README.md:12-13, 83-91`: `use-npmrc` description and the "Required secrets" contract

## Architecture Insights
- **Install and publish auth are already separated.** `DOT_NPMRC` serves installs; the `JFROG_*` trio drives publish through a generated per-project dist `.npmrc`. The ticket only replaces the publish half's credential format. Removing `DOT_NPMRC` is a separate, much wider change.
- **The single `_auth` writer makes the code change a small, contained edit.** There are no REST calls, so there is no Basic-vs-Bearer header logic to migrate. npm sends `_authToken` as `Bearer`, and JFrog accepts it for access/reference tokens, as `cplace-e2e` and `resource-management-fe` already do via `DOT_NPMRC`.
- **Key-prefix shape.**
  - Today's keys have no trailing slash: `//host/artifactory/cplace-npm-local:_auth`.
  - npm matches credentials by the registry URL prefix. The ticket's pattern `//<registry>/:_authToken=` has a trailing slash, so `getJfrogUrlNoHttp()` and `JFROG_URL` normalization must line up.
  - `JFROG_URL` is a secret whose exact value (with or without `/api/npm/`, with or without a trailing slash) is not visible in the repo.
- **Literal `${JFROG_TOKEN}` vs. the expanded value.** npm expands `${VAR}` in `.npmrc` at runtime. Writing the line literally as `_authToken=${JFROG_TOKEN}`, as the ticket's pattern suggests, would keep the secret out of the dist file and out of the `console.log` at `nx-project.ts:306`. It requires the env var to be present for every npm call made from the dist `cwd`. Today they run in the same step env, so it would be.
- **Callers pass secrets explicitly, which constrains rollout.**
  - A secret is "required" at the callee, and callers pass named secrets. So adding a required secret, or removing a declared secret that callers still pass, fails every caller on that ref at once.
  - Callers on default branches follow `@master` live.
  - The PFM-ISSUE-34283 move to `secrets: inherit` for `fe-release-flow.yml` was designed so that later secret changes in this epic need no caller edits. It is not rolled out to the 15 repos yet; PFM-ISSUE-34287 is the pilot on `cplace-remote-filesystem-fe`.
- **Branch-pinned refs.** Composite and workflow refs are `@master` on default branches and `@release/X.Y` on release branches; cf-devkit rewrites them at branch-off. A master-only change reaches release lines only at the next branch-off unless it is backported.

## Historical Context (from specs/)
- `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/design.md` ("Secrets and permissions contract", Decision 6)
  - Introduced `secrets: inherit` for `fe-release-flow.yml` explicitly so that the epic's later secret changes (JFrog split, 34282, 34286) need no caller edits.
  - Landed on master only; release lines 25.4–26.4 keep the deprecated reusables.
  - Kept the legacy artifacts-tool modes "byte-for-byte unchanged".
- `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/research.md` §4–5
  - Roughly 23 caller repos and roughly 120 caller files.
  - Branch-ref conventions.
  - Template edits reach consumers only by manual re-copy.
- `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/clone-cplace-fe-live-tests.md`
  - Live validation harness: `collaborationFactory/clone-cplace-fe` publishing to the JFrog `cplace-npm-test` repo.
  - JFrog safety rules: own versions only, exact paths, show hits before delete.
  - The dist `.npmrc` log line (`:84-86`).
- `specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/` (design, research, plan, live-test-plan)
  - Pattern for retiring a secret: drop the declaration in the callee (precedent PFM-ISSUE-34285, commit `faa4771`, for `fe-snapshot.yml`).
  - Keep repo secrets until no branch of that repo uses the deprecated reusables.
  - Roll back by reverting the commit while old secrets still exist.
  - Secret-deletion test R6 requires the user's consent.
  - Open question #10: `cplace-fe` `push_main.yaml` still passes `GIT_USER_TOKEN` explicitly to `fe-snapshot.yml@master`, which no longer declares it. That is the exact failure mode of explicit passing.
- `specs/2026-06-05_node24-workflow-migration/` (research, design, plan, validation-log)
  - `use-npmrc` composite details and its 7 call sites.
  - The per-branch composite-ref rule.
  - The **never test on real `release/*` branches** rule (2026-06-08 incident).
  - The opposite rollout precedent: upmerge through every release line, one PR per branch.

## Related Research
- `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/research.md`
- `specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/research.md`
- `specs/2026-06-05_node24-workflow-migration/research.md`

## Open Questions
1. **Where the user/token values come from, and their type.**
   - `JFROG_BASE64_TOKEN` is base64(`user:secret`). Is that secret a JFrog access/reference token that works as `_authToken` (Bearer), or a password/API key that only works with Basic?
   - Will new per-repo tokens be minted? (The publish identity needs deploy, delete and dist-tag rights on `cplace-npm-local`.)
2. **Secret names.**
   - Should the existing `JFROG_USER` be reused as "the user" secret, or should a new name be introduced?
   - Is the token secret named `JFROG_TOKEN`, as in the ticket's pattern?
   - With `_authToken`, the user is not needed for npm auth at all. Today it is only the `email=` line. What is the user secret used for afterwards (`email=`, a JFrog CLI/REST call, documentation)?
3. **`JFROG_URL` normalization.** What is the actual secret value format (`…/artifactory/cplace-npm-local` vs `…/artifactory/api/npm/cplace-npm-local/`)? How should the `//<registry>/` key with a trailing slash be derived so it matches what npm uses for publish/show/unpublish/dist-tag?
4. **Transition strategy, given explicit secret passing.** Options:
   - Introduce `JFROG_TOKEN` as `required: false` alongside an optional `JFROG_BASE64_TOKEN` (prefer the token when present). Then create the secret in all repos, switch the callers, and remove the old declaration last.
   - Couple this with rolling out `secrets: inherit` (34283/34287) first.

   The ticket asks for "one coordinated cutover" with the `DOT_NPMRC` removal. Is that still the intent, given that `DOT_NPMRC` stays for installs, Bryntum and cplace-fe's direct uses?
5. **Scope of the `DOT_NPMRC` coupling.** Research confirms that `DOT_NPMRC` stays in use after this ticket for:
   - installs;
   - `npm search`/`npm view` in cleanup-snapshots;
   - Bryntum;
   - direct uses in cplace-fe, project-planning-fe and cplace-e2e.

   Which `DOT_NPMRC` work, if any, belongs in this ticket vs PFM-ISSUE-33675 or another Workstream B ticket? For example: generating the JFrog read part from user/token secrets instead of an opaque `.npmrc`, or removing `use-npmrc` from publish-only paths.
6. **Release-line backport.** Should the change be master-only (34283 precedent), or backported to `release/26.4` (and older) like the Node 24 migration? `release/26.4` callers pass the same explicit secrets to `@release/26.4`.
7. **Deprecated reusables** (`fe-tag.yml`, `fe-release.yml`). Are they switched too, or left on `JFROG_BASE64_TOKEN`? `fe-tag.yml` only bumps the version but still requires the JFrog secrets.
8. **cplace-e2e.** It has no `JFROG_*` secrets and does not use the shared workflows. Is it in scope for this ticket, which is about publish auth, or only for the `DOT_NPMRC` work?
9. **Log exposure.** `printenv` in `artifacts`/`snapshots` and `console.log(npmrcContent)` at `nx-project.ts:306`. Masking holds only for registered secrets. Confirm that no derived token value is ever logged. Writing literal `${JFROG_TOKEN}` would avoid it.
10. **Validation.** Use `clone-cplace-fe` against `cplace-npm-test`, as in 34282/34283. Swapping or deleting the clone repo's secrets requires the user's consent.
