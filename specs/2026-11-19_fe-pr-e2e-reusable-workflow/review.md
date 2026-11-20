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
