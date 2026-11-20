# Code Review: Real-Backend E2E on Frontend PRs

## Iteration 1 — 2026-11-20

*Reviewed two repositories against `plan.md`. github-actions: `origin/master...HEAD` (4 files); cplace-fe: `origin/main...HEAD` (2 files). cplace-paw-fe was skipped because it is on `master` (its work is in Phase 6). Agents: plan-conformance, correctness, craft, test and security in github-actions; plan-conformance, correctness, craft and security in cplace-fe. best-practices did not run in either repo: github-actions has no rule index, and cplace-fe's rule symlinks are broken. 7 findings kept, 0 dropped in verification, 1 merged.*

Merged:
- github-actions / craft — "Hardcoded FIXME ref in the action reference" — into [1.1]

### [1.1] 🙏 Secrets-bearing reusable workflow pinned to a mutable feature branch

- [x] Resolved — No code change: the branch ref is intentional staging per plan.md Implementation Approach; Phase 6 resets it to `@master` and its automated criterion (grep for `feature/fe-backend-e2e` / `FIXME remove before merging` in `.github`) is the merge gate.

**Agent(s):** security, craft

**Repo:** github-actions

**File(s):**
- [fe-pr-snapshot.yml:82](/.github/workflows/fe-pr-snapshot.yml#L82)

**Reference(s):**
- [fe-pr-snapshot.yml:16](/.github/workflow-templates/fe/fe-pr-snapshot.yml#L16)

The artifacts step receives `JFROG_BASE64_TOKEN`, `JFROG_URL` and `JFROG_USER`, and it now loads its action from `@feature/fe-backend-e2e`. A branch ref is mutable, so anyone who can push to that branch controls the code that gets the publish credentials. The template consumers call `fe-pr-snapshot.yml@master`. If this merges unchanged, all of them would run branch code, and deleting the branch would break them. The plan stages the ref on purpose and resets it in Phase 6. Treat it as a merge blocker, for example with a CI check that rejects `FIXME remove before merging` or a non-`master` ref.

### [1.2] 🙏 Branch-off tip commit on a PR returns early and emits no `version` or `packages` outputs

- [x] Resolved — Reworded the `version` and `packages` output descriptions in fe-pr-snapshot.yml to state they are empty when the job is skipped or the tip is a branch-off commit; consumers guard empty values (Phase 3 `resolve-consumers.sh` treats empty `PACKAGES` as `[]`), since a code-side `[]` could not cover the skipped-job case anyway.

**Agent(s):** correctness

**Repo:** github-actions

**File(s):**
- [artifacts-handler.ts:142](/tools/scripts/artifacts/artifacts-handler.ts#L142)
- [fe-pr-snapshot.yml:35](/.github/workflows/fe-pr-snapshot.yml#L35)

**Reference(s):**
- [artifacts-handler.ts:117](/tools/scripts/artifacts/artifacts-handler.ts#L117)

On a branch-off tip commit, `handle()` returns before `initProjects`, so `writePrSnapshotOutputs` never runs. The workflow's `version` and `packages` outputs are then empty strings, not `[]`, which contradicts the output description ("[] when nothing was published"). A skipped job (label required and missing) also yields empty outputs. Either write `packages=[]` on that path, or reword the output description and have consumers guard against empty values. The plan's Phase 3 `resolve-consumers.sh` already treats an empty `PACKAGES` as `[]` (plan.md:474).

### [1.3] 💡 Unrelated hardening mixed into the snapshot workflow change

- [x] Resolved — No code change: `timeout-minutes: 60` is required by plan.md Phase 1 §4 and the `"$GITHUB_ENV"` quoting is the recorded actionlint fix; both stay and get a line in the PR description.

**Agent(s):** craft

**Repo:** github-actions

**File(s):**
- [fe-pr-snapshot.yml:34](/.github/workflows/fe-pr-snapshot.yml#L34)
- [fe-pr-snapshot.yml:63](/.github/workflows/fe-pr-snapshot.yml#L63)

**Reference(s):**
- [fe-e2e.yml:22](/.github/workflows/fe-e2e.yml#L22)

`timeout-minutes: 60` and the `"$GITHUB_ENV"` quoting have nothing to do with the new outputs or the label toggle, and they widen the diff. Note that plan.md Phase 1 §4 does ask for `timeout-minutes: 60`, and the Phase 1 verification notes record the quoting as the actionlint fix. Mentioning both in the PR description would be enough.

### [1.4] 💡 Comment on `writePrSnapshotOutputs` assumes the failure path

- [x] Resolved — Declined: the comment already states the invariant (a failed publish exits the process); tracking published packages separately adds state for a failure mode the handler does not have.

**Agent(s):** craft

**Repo:** github-actions

**File(s):**
- [artifacts-handler.ts:149](/tools/scripts/artifacts/artifacts-handler.ts#L149)

The `packages` output is correct only as long as a failed publish exits the process. If the handler ever tolerates a failed publish, the output will list packages that were never published, and nothing will flag it. Consider having `buildAndPublishProjects` record what it actually published, or keep this invariant next to the exit logic.

### [1.5] 💡 PR-snapshot output guard sits inline in `handle()`

- [x] Resolved — Moved the `PR_SNAPSHOT && !onlyDeleteArtifacts` guard into `writePrSnapshotOutputs` as an early return; `handle()` now calls it unconditionally after publishing. Artifacts PR-snapshot tests still pass.

**Agent(s):** craft

**Repo:** github-actions

**File(s):**
- [artifacts-handler.ts:154](/tools/scripts/artifacts/artifacts-handler.ts#L154)

**Reference(s):**
- [artifacts-handler.ts:327](/tools/scripts/artifacts/artifacts-handler.ts#L327)

The helper usage matches the release flow, which writes its outputs inside its own method. The `TASK.PR_SNAPSHOT && !this.onlyDeleteArtifacts` guard, however, sits inline in `handle()`. Moving it into `writePrSnapshotOutputs` would keep `handle()` free of the special case.

### [1.6] 💡 Trial workflow forwards JFrog and npm secrets to a branch-pinned reusable workflow

- [x] Resolved — No code change: the trial PR is a never-merged draft and must track the moving `feature/fe-backend-e2e` branch across Phases 2-5, so a SHA pin would need re-pinning on every push; the branch is deleted after Phase 6.

**Agent(s):** security

**Repo:** cplace-fe

**File(s):**
- [pull_request.yaml:120](../cplace-fe/.github/workflows/pull_request.yaml#L120)
- [pull_request.yaml:125](../cplace-fe/.github/workflows/pull_request.yaml#L125)

The `snapshot` job sends `JFROG_BASE64_TOKEN` and `DOT_NPMRC` to `fe-pr-snapshot.yml@feature/fe-backend-e2e`, which is a mutable, unreviewed ref. The trial PR is never merged, so the exposure is limited to the trial. Still, consider pinning to a commit SHA for the trial, and protecting or deleting the branch afterwards.

### [1.7] ℹ️ Trial consumer has no `backend-e2e` job yet (Phase 2 item 6 not done)

- [x] Resolved — Acknowledged: Phase 2 is in progress; the `backend-e2e` trial job lands with Phase 2 item 6.

**Agent(s):** plan-conformance

**Repo:** cplace-fe

**File(s):**
- [pull_request.yaml](../cplace-fe/.github/workflows/pull_request.yaml)

**Reference(s):**
- [plan.md:412](/specs/2026-11-19_fe-pr-e2e-reusable-workflow/plan.md#L412)

The trial branch has only the Phase 1 pieces (`snapshot` and the `snapshot-outputs` echo job) plus Phase 2's trivial `cf-platform` change. The `backend-e2e` caller is not there yet. None of Phase 2's criteria are checked off, so this is work in progress, not a gap. It is recorded so nobody reads the trial branch as covering Phase 2.

## Iteration 2 — 2026-11-20

*Reviewed two repositories against `plan.md`. github-actions: `origin/master...HEAD` (14 files); cplace-fe: `origin/main...HEAD` (3 files). cplace-paw-fe was skipped because its work is in Phase 6, which has not started. The untracked `dist/` in github-actions was not reviewed. Agents: plan-conformance, correctness, craft, best-practices, test and security in github-actions; plan-conformance, correctness, craft and security in cplace-fe. best-practices used the sibling `cplace-best-practices` backend index, because github-actions has no rule index of its own. In cplace-fe it did not run: the only change outside workflows is a deliberate trial FIXME comment. plan-conformance returned nothing in either repo, and craft and security returned nothing in cplace-fe. 7 findings kept, 0 dropped in verification, 0 merged.*

### [2.1] 💡 Resolve action's `run` output is hard-coded to `true`

- [x] Resolved — Declined: plan.md Phase 2 §3 requires the constant `true` and Phase 3 replaces the step with the `resolve-consumers.sh` skip condition; a placeholder comment would only describe plan history.

**Agent(s):** craft

**Repo:** github-actions

**File(s):**
- [action.yml:44](/.github/actions/backend-e2e-resolve/action.yml#L44)
- [fe-backend-e2e.yml:85](/.github/workflows/fe-backend-e2e.yml#L85)

The `run` step always writes `run=true`, so the output and the `if:` gates on `build`, `e2e` and `report` can never be false. plan.md Phase 2 §3 asks for exactly this ("always `true` in this phase"), and Phase 3 wires the real skip condition. A one-line comment saying it is a placeholder until Phase 3 would stop it reading as a bug.

### [2.2] 💡 npm registry auth step is copied verbatim into two jobs

- [x] Resolved — Declined: a composite action for a 9-line step used twice in one file would add another `@feature/fe-backend-e2e` FIXME ref for Phase 6 to rewrite; both copies stay side by side in fe-backend-e2e.yml.

**Agent(s):** craft

**Repo:** github-actions

**File(s):**
- [fe-backend-e2e.yml:138](/.github/workflows/fe-backend-e2e.yml#L138)
- [fe-backend-e2e.yml:284](/.github/workflows/fe-backend-e2e.yml#L284)

**Reference(s):**
- [action.yml:1](/.github/actions/backend-e2e-pin/action.yml#L1)

The `build` and `e2e` jobs contain the same 9-line `.npmrc` setup, including the registry URL and the token format, so changing either means editing two places. This PR already puts small shared steps in `backend-e2e-*` composite actions, and the auth step could become one more.

### [2.3] 💡 Backend E2E can go green without pinning anything from the PR

- [x] Resolved — The pin action now fails with `::error::` when no directory matches its globs (layout drift); an empty pin list stays a summary line because Phase 4 reuses the action on the cplace-e2e checkout, where consuming nothing is legitimate, and Phase 3's `resolve-consumers.sh` skips runs with no consumer.

**Agent(s):** correctness

**Repo:** github-actions

**File(s):**
- [action.yml:32](/.github/actions/backend-e2e-pin/action.yml#L32)
- [pin-snapshots.sh:31](/tools/scripts/backend-e2e/pin-snapshots.sh#L31)
- [fe-backend-e2e.yml:154](/.github/workflows/fe-backend-e2e.yml#L154)

The pin step succeeds when nothing is pinned: no matching dir, empty or `[]` packages, or no assets dir that consumes a published package. The build and every node then run against the backend's stock versions, and the check reports green with only a warning or summary line as signal. Phase 3's `resolve-consumers.sh` skip covers the "nothing consumed" case at resolve time. A glob that matches nothing, or a layout drift after resolve, would still pass silently. Consider failing the pin step when the resolve step expected pins but none were applied.

### [2.4] 💡 Inline shell for NODES validation and pin-dir globbing has no test

- [x] Resolved — Plan Phase 7: the glob expansion and its no-match failure moved into `pin-snapshots.sh` and the NODES check into the new `node-indexes.sh` (called first by `backend-e2e-resolve`), both covered by bats in `pr-checks.yml`.

**Agent(s):** test

**Repo:** github-actions

**File(s):**
- [fe-backend-e2e.yml:78](/.github/workflows/fe-backend-e2e.yml#L78)
- [action.yml:32](/.github/actions/backend-e2e-pin/action.yml#L32)

**Reference(s):**
- [pr-checks.yml:58](/.github/workflows/pr-checks.yml#L58)

bats and shellcheck only cover `tools/scripts/backend-e2e/*`. The `NODES` validation (the `0*` arm is easy to get subtly wrong) and the glob and no-match branch of the pin action are inline workflow shell, so they are never exercised. Moving them into scripts under `tools/scripts/backend-e2e/` would let the existing bats setup test them.

### [2.5] 💡 Blanket `|| true` on the analytics `zip -d` hides a missing or corrupt archive

- [x] Resolved — Replaced `|| true` with an exit-code check that tolerates only zip's "nothing to do" (12) and fails with an `::error::` naming the exit code otherwise.

**Agent(s):** best-practices

**Repo:** github-actions

**File(s):**
- [fe-backend-e2e.yml:190](/.github/workflows/fe-backend-e2e.yml#L190)

**Reference(s):**
- [shell-scripts.md:16](../cplace-best-practices/details/backend/shell-scripts.md#L16)

This breaks [SH-01] (never blanket-suppress a step whose success matters). `zip -d` exits non-zero both when nothing matches, which is benign, and when the archive is missing or corrupt. If analytics stays in the zip, the TestSetupHandler fails later on the nodes, far from the cause. Tolerate only zip's "nothing to do" exit code (12), or warn on stderr with context.

### [2.6] ❓ PR snapshot packages are installed with the Artifactory token in scope

- [x] Resolved — No code change: callers trigger on `pull_request` (not `pull_request_target`), so fork PRs get no secrets and cannot publish a snapshot; a same-repo PR author already controls the calling workflow and its secrets, so a lifecycle script adds no exposure.

**Agent(s):** security

**Repo:** github-actions

**File(s):**
- [fe-backend-e2e.yml:291](/.github/workflows/fe-backend-e2e.yml#L291)
- [fe-backend-e2e.yml:154](/.github/workflows/fe-backend-e2e.yml#L154)
- [pin-snapshots.sh:39](/tools/scripts/backend-e2e/pin-snapshots.sh#L39)

`~/.npmrc` holds the Artifactory token before `npm i <PR snapshot>` runs without `--ignore-scripts`. A lifecycle script in a PR-built package could therefore read that token and any git credentials on the runner. This is acceptable if only same-repo PRs reach the workflow with secrets: can you confirm that fork PRs cannot? Otherwise, consider `--ignore-scripts` on the pin, or writing the token only after the pin.

### [2.7] 💡 Trial `snapshot` job can double-publish alongside the label caller

- [x] Resolved — No code change: the `snapshot` label stays off the trial PR, and Phase 6 deletes the label caller.

**Agent(s):** correctness

**Repo:** cplace-fe

**File(s):**
- [pull_request.yaml:119](../cplace-fe/.github/workflows/pull_request.yaml#L119)
- [pull_request_snapshot.yaml:16](../cplace-fe/.github/workflows/pull_request_snapshot.yaml#L16)

Both workflows call `fe-pr-snapshot.yml@feature/fe-backend-e2e` on `synchronize` and `reopened`. The label caller keeps the default `REQUIRE_SNAPSHOT_LABEL: true`, so it skips unless the PR carries the `snapshot` label, and Phase 1 verified that it does. If the label is ever added to the trial PR, the two runs would publish the same version concurrently and could fail the `snapshot` job, which would skip `backend-e2e`. Keep the label off the trial PR. Phase 6 deletes the label caller anyway.

## Iteration 3 — 2026-11-20

*Reviewed two repositories against `plan.md`. github-actions: `origin/master...HEAD` (14 files); cplace-fe: `origin/main...HEAD` (3 files). cplace-paw-fe was skipped because it is on `master` and its work is in Phase 6, which has not started. The run went ahead on committed code only, at the user's request. The github-actions working tree holds uncommitted Phase 7 work and the iteration-2 fixes for [2.3] and [2.5], and the untracked `dist/`; none of these were reviewed. Agents: plan-conformance, correctness, craft, best-practices, test and security in github-actions; plan-conformance, correctness, craft and security in cplace-fe. best-practices used the sibling `cplace-best-practices` backend index, because github-actions has no rule index of its own. In cplace-fe it did not run, as in iteration 2: the only change outside workflows is a deliberate trial FIXME comment. test and security returned nothing in github-actions, and every cplace-fe agent returned nothing. 6 findings kept, 0 dropped in verification, 3 merged.*

Merged:
- github-actions / plan-conformance — "[2.5] fix is not on the branch: analytics `zip -d` still ends in `|| true`" — into [3.2]
- github-actions / best-practices — "Blanket `|| true` on the analytics `zip -d` is still in the diff (SH-01)" — into [3.2]
- github-actions / plan-conformance — "[2.3] fix is not on the branch: no-match in the pin action still warns and exits 0" — into [3.3]

### [3.1] 🚨 Phase 7 is checked off, but none of its changes are committed

- [x] Resolved — No code change: the Phase 7 working-tree changes (`node-indexes.sh`/`.bats`, glob expansion in `pin-snapshots.sh`, the resolve action's NODES call) are now committed on `feature/fe-backend-e2e`.

**Agent(s):** plan-conformance

**Repo:** github-actions

**File(s):**
- [fe-backend-e2e.yml:78](/.github/workflows/fe-backend-e2e.yml#L78)
- [action.yml:24](/.github/actions/backend-e2e-pin/action.yml#L24)
- `tools/scripts/backend-e2e/node-indexes.sh`

**Reference(s):**
- [plan.md:832](/specs/2026-11-19_fe-pr-e2e-reusable-workflow/plan.md#L832)

Every Phase 7 Automated Verification item is `- [x]`. On the branch, though, the inline NODES `case` and the "Node matrix" step are still in fe-backend-e2e.yml, the pin action still expands globs with `nullglob`, and `node-indexes.sh` and `node-indexes.bats` do not exist. The ticked grep criterion therefore fails against HEAD. The changes exist only in the working tree, so committing them should resolve this, together with the [2.4] tick that describes them.

### [3.2] 🙏 Blanket `|| true` on the analytics `zip -d` is still on the branch

- [x] Resolved — No code change: the [2.5] exit-code check (tolerate only zip's 12, else `::error::` and exit) was correct but uncommitted; it is now committed. The earlier tick did not hold because it was written against the working tree, not HEAD.

**Regression of** [2.5]

**Agent(s):** correctness, plan-conformance, best-practices

**Repo:** github-actions

**File(s):**
- [fe-backend-e2e.yml:190](/.github/workflows/fe-backend-e2e.yml#L190)

**Reference(s):**
- [shell-scripts.md:16](../cplace-best-practices/details/backend/shell-scripts.md#L16)
- [review.md:188](/specs/2026-11-19_fe-pr-e2e-reusable-workflow/review.md#L188)

The tick note on [2.5] says `|| true` was replaced by a check that tolerates only exit code 12, but HEAD still has the blanket suppression ([SH-01]). A missing or corrupt `software.zip` stays green and fails later on the test nodes. The exit-code check exists only in the uncommitted working tree.

### [3.3] 🙏 Pin step still warns and exits 0 when no directory matches

- [x] Resolved — No code change: the [2.3] fix (no-match fails in `pin-snapshots.sh` with `exit 1`, covered by bats) was uncommitted and is now committed. The earlier tick did not hold because it was written against the working tree, not HEAD.

**Regression of** [2.3]

**Agent(s):** correctness, plan-conformance

**Repo:** github-actions

**File(s):**
- [action.yml:32](/.github/actions/backend-e2e-pin/action.yml#L32)

**Reference(s):**
- [review.md:156](/specs/2026-11-19_fe-pr-e2e-reusable-workflow/review.md#L156)

The tick note on [2.3] says a no-match glob now fails with `::error::`, but the committed action emits `::warning::` and `exit 0`. If the backend layout drifts so `${REPO_NAME}/*/assets` matches nothing, the build and every node run against stock versions, and the check goes green without testing the PR's snapshot. Phase 7 §1 moves this check into `pin-snapshots.sh` as `exit 1`. That change is uncommitted too.

### [3.4] 🙏 npm's stdout is captured as the pin list and written into the step summary

- [x] Resolved — `pin-snapshots.sh` sends `npm i` stdout to stderr; the bats `npm` stub now prints a progress line to stdout and the per-pin output test runs with `--separate-stderr`, so the two-line assertion fails without the redirect (bats not runnable locally on Windows; verified by the `pr-checks.yml` bats job).

**Agent(s):** correctness

**Repo:** github-actions

**File(s):**
- [pin-snapshots.sh:39](/tools/scripts/backend-e2e/pin-snapshots.sh#L39)
- [action.yml:36](/.github/actions/backend-e2e-pin/action.yml#L36)

**Reference(s):**
- [pin-snapshots.bats:90](/tools/scripts/backend-e2e/pin-snapshots.bats#L90)

`npm i` prints progress and audit notices to stdout, which is not redirected, and the action captures the script's whole stdout as `pins`. The "Pinned snapshot packages" summary therefore mixes npm output with the `<dir> <pkg>@<ver>` lines. The bats case asserts exactly two output lines, but its `npm` stub prints nothing, so it cannot catch this. Redirect npm's stdout to stderr (`>&2`) in the script.

### [3.5] 💡 Bundle step hardcodes `main/docker/e2e`, which exists only for cplace or with parent repos

- [x] Resolved — The bundle step now fails up front with an `::error::` when `main/docker/e2e` is missing, naming `CB_INCLUDE_PARENT_REPOS=true` as the fix; the path stays required because the test nodes cannot run without the docker scripts.

**Agent(s):** correctness

**Repo:** github-actions

**File(s):**
- [fe-backend-e2e.yml:201](/.github/workflows/fe-backend-e2e.yml#L201)

For a non-cplace backend (`repo_dir` = `cplace-paw`), `main/` exists only when a parent-repo step clones cplace there, and that step runs only when `CB_INCLUDE_PARENT_REPOS == 'true'`. `tar -czf` fails on a missing path. `config1` is guarded by `-d`, but this path is not. Check this before the cplace-paw-fe rollout in Phase 6.

### [3.6] 💡 `tools/scripts/backend-e2e/` has no README, unlike the sibling script directory

- [x] Resolved — Declined: each script's header comment already states its usage, env and output contract, so a README would duplicate them; add one if the directory grows beyond its current handful of scripts.

**Agent(s):** craft

**Repo:** github-actions

**File(s):**
- [lib.sh:1](/tools/scripts/backend-e2e/lib.sh#L1)

**Reference(s):**
- [README.md:204](/tools/scripts/lockfile/README.md#L204)

The directory adds scripts, a sourced lib, bats tests and a helper, wired into two composite actions and a workflow. Its env and argument contracts (`PACKAGES`, `FE_REPO`, `BASE_REF`) are spread across header comments. `tools/scripts/lockfile/` documents its files, invariants and usage in a short README, and a few lines here would follow the same convention.

## Iteration 4 — 2026-11-20

*Reviewed two repositories against `plan.md`. github-actions: `origin/master...HEAD` (16 files); cplace-fe: `origin/main...HEAD` (3 files). cplace-paw-fe was skipped because it is on `master` and its work is in Phase 6, which has not started. The untracked `dist/` in github-actions was not reviewed. Agents: plan-conformance, correctness, craft, best-practices, test and security in github-actions; plan-conformance, correctness, craft and security in cplace-fe. best-practices found no rule index covering github-actions' paths (workflows, composite actions, bash/bats, the artifacts handler) and filed nothing. plan-conformance, best-practices and test returned nothing in github-actions, and every cplace-fe agent returned nothing. 5 findings kept, 0 dropped in verification, 0 merged.*

### [4.1] 💡 Fixed artifact names collide if the workflow is called twice in one run

- [x] Resolved — Declined: each caller invokes the workflow once per run by design; add a caller-supplied artifact-name suffix input when a caller needs a second invocation.

**Agent(s):** correctness

**Repo:** github-actions

**File(s):**
- [fe-backend-e2e.yml:212](/.github/workflows/fe-backend-e2e.yml#L212)
- [fe-backend-e2e.yml:221](/.github/workflows/fe-backend-e2e.yml#L221)
- [fe-backend-e2e.yml:350](/.github/workflows/fe-backend-e2e.yml#L350)

`backend-e2e-bundle`, `backend-e2e-npm-logs-build` and `backend-e2e-results-<n>` contain nothing that tells one invocation from another. Artifacts are scoped to the whole caller run, so a caller that invokes the workflow twice (another spec set or backend) gets a 409 on the second upload, and the report's `backend-e2e-results-*` pattern would merge both invocations' results. Today's callers invoke it once, so this matters only if that changes; a caller-supplied suffix in the names would cover it.

### [4.2] 💡 No `permissions:` block, so jobs that install PR-built packages inherit the caller's token scope

- [x] Resolved — Added top-level `permissions: contents: read` to fe-backend-e2e.yml and job-level `contents: read`, `checks: write`, `pull-requests: write` on `report`, superseding plan.md's "omit top-level permissions" note; all scopes stay within what callers grant.

**Agent(s):** security

**Repo:** github-actions

**File(s):**
- [fe-backend-e2e.yml:11](/.github/workflows/fe-backend-e2e.yml#L11)
- [fe-backend-e2e.yml:365](/.github/workflows/fe-backend-e2e.yml#L365)

`build` and `e2e` run `npm i` on PR-published snapshot packages, whose lifecycle scripts then run with whatever `GITHUB_TOKEN` scope the caller grants. Only `report` needs `checks: write` and `pull-requests: write`. plan.md omits top-level `permissions:` on purpose; a top-level `contents: read` with the write scopes on `report` alone would cap the exposure regardless of the caller.

### [4.3] 💡 Backend `.github/.build-env` is shipped inside a downloadable artifact

- [x] Resolved — No code change: `.build-env` is the backend's committed file and `load-env-variables` never writes to it; secrets are interpolated only into `$GITHUB_ENV`, so the bundled copy holds the same non-secret `CB_*` settings and placeholders as the repo.

**Agent(s):** security

**Repo:** github-actions

**File(s):**
- [fe-backend-e2e.yml:200](/.github/workflows/fe-backend-e2e.yml#L200)

`load-env-variables` receives `toJson(secrets)`, and the env file is tarred into `backend-e2e-bundle.tgz`, which anyone with repo read access can download during its 1-day retention. If the cplace-gh-workflows env handling ever writes resolved secret values into `.build-env`, the bundle exposes them. Confirm it holds only non-secret `CB_*` settings, or regenerate it on the nodes instead of shipping it.

### [4.4] 💡 Required `GHA_REF` input is not read anywhere yet

- [x] Resolved — No code change: plan.md fixes the input contract up front and Phase 4 §1 consumes `GHA_REF` for the `e2e-tests/` sparse checkout; declaring it now keeps callers from changing between phases.

**Agent(s):** craft

**Repo:** github-actions

**File(s):**
- [fe-backend-e2e.yml:14](/.github/workflows/fe-backend-e2e.yml#L14)

**Reference(s):**
- [fe-e2e.yml:32](/.github/workflows/fe-e2e.yml#L32)

`GHA_REF` is `required: true` but only declared; nothing in the workflow consumes it, unlike sibling fe-* workflows that check out `ref: ${{ inputs.GHA_REF }}`. plan.md Phase 4 §1 uses it for the `e2e-tests/` sparse checkout, so it becomes live then; until that lands, every caller passes a dead value.

### [4.5] 💡 `lib.sh` is a sourced library with one function and one caller

- [x] Resolved — No code change: Phase 3 is committed plan work that adds `resolve-consumers.sh` as a second `consumed_packages` caller and `remote_branch_exists` to `lib.sh`, so the split stays.

**Agent(s):** craft

**Repo:** github-actions

**File(s):**
- [lib.sh:11](/tools/scripts/backend-e2e/lib.sh#L11)

**Reference(s):**
- [pin-snapshots.sh:47](/tools/scripts/backend-e2e/pin-snapshots.sh#L47)
- [plan.md:486](/specs/2026-11-19_fe-pr-e2e-reusable-workflow/plan.md#L486)

`consumed_packages` lives in its own sourced file but `pin-snapshots.sh` is its only caller. plan.md Phase 3 adds `resolve-consumers.sh` as a second caller, which justifies the split once Phase 3 lands; keep it if that phase is committed work.
