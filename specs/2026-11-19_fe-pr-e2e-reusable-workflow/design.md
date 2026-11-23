# Real-Backend E2E on Frontend PRs - Design Approach

## Overview

A new reusable workflow in `github-actions`, called from the `pull_request.yaml` of cplace-fe and cplace-paw-fe, that builds the matching backend with the PR's npm snapshot versions pinned in, boots it in docker, runs Cypress specs from `cplace-e2e` (and optionally from the FE repo) against it, and fails the PR on any failing test. It is a required check on every PR.

## Problem Statement

Frontend PR checks only run Cypress against Storybook with mocked data. Whether a change works inside a real cplace is discovered later — by someone writing specs in a separate `cplace-e2e` PR, or after merge. The cause: the backend consumes the frontend as exact-pinned npm packages (`<plugin>/assets/package.json` + lock), while the only "run E2E on a PR" tooling (`/run-e2e-tests` orchestrator) can only swap backend git branches in `parent-repos.json`. FE repos are not entries there, so a FE PR run silently tests the base (`matched=false`). No pipeline step overrides `@cplace-*` npm versions. See [Research](./research.md).

### Requirements
- Run on every cplace-fe and cplace-paw-fe PR as a required check (gated through `pr-checks`).
- Resolve the backend repo by naming pattern (`cplace-fe` → `cplace`, `<x>-fe` → `<x>`).
- Pin exactly the packages the PR published as snapshots into the backend (and into cloned `cplace-e2e`) before building.
- Build and boot the backend in docker (cplace + Elasticsearch) and run Cypress against it.
- Support spec sources: `cplace-e2e` (matching branch), an in-repo folder, an explicit spec filter, and the full suite.
- Report results on the PR and fail the job on any failing test.

### Constraints
- FE CI lives in `github-actions@master` (nx/npm, TS scripts); the backend E2E engine lives in `cplace-gh-workflows@release/2.0` (gradle, bash, env files). Merges to either are live for all consumers immediately.
- Snapshot publishing today is label-gated, runs in a separate workflow, is affected-only, and exposes no outputs; republish briefly unpublishes the version.
- No consumable prebuilt E2E image exists; the FB pull-image mode is single-container without Elasticsearch.
- The docker contract must be kept: container `main`, port 8083, token `hIF9Z97RZiYm`, compose project `cplace-e2e`.
- Must not rely on the X.Y.999 feature-branch version rewrite (broke IAP#536 with `notarget`).
- Every action SHA-pinned.

## Design Decisions Summary

1. **Standalone reusable workflow in github-actions**: a new workflow called like `code-quality`, running as an ordinary synchronous job in the FE PR pipeline.
   - Composes backend building blocks (build stages, docker compose, readiness wait, spec calculation, cypress-repeat, JUnit publish) from `cplace-gh-workflows@release/2.0` cross-repo rather than reimplementing them.
   - New logic is limited to orchestration: resolve repos/branches, apply snapshot pins, copy in-repo specs, report.
2. **Snapshot publishing moves into the PR pipeline, unconditionally, with outputs**: `fe-pr-snapshot.yml` is called as a job inside `pull_request.yaml` on every PR, without the `snapshot` label gate.
   - The artifacts action / `fe-pr-snapshot.yml` expose `version` and the published `packages` list as outputs.
   - The backend-e2e job `needs:` the snapshot job — ordered, race-free handoff.
3. **Backend built from source, once per run, shared across nodes**: prebuilt image + FE overlay is a follow-up, not part of this design.
   - Snapshot pins applied with the nightly upmerge recipe (`npm i <pkg>@<ver> --save-exact --legacy-peer-deps` in each `*/assets`, lock regenerated), only for packages the PR published.
   - Inserted after parent repos are prepared and before parent/distribution build; the X.Y.999 rewrite is not used.
   - The built distribution is reused by all test nodes instead of each node rebuilding `distZip`.
4. **Branch resolution: same-named branch, else mapped base**: applied independently to the backend repo and to `cplace-e2e`.
   - Mapping: FE `main`/`master` → `master`; `release/X.Y` → `release/X.Y`; `release/X.Y-beta` → `release/X.Y` if present, else `master`.
   - Follows PFM-ISSUE-34932 rules (exact `refs/heads/` match, retry with backoff, derived-missing → warning + fallback); the resolved branches are shown in the report.
5. **Single runtime consumer backend per FE repo**: cplace-fe PRs build only `cplace`; cplace-paw-fe PRs build `cplace-paw`.
   - cplace-fe changes are not tested through paw-level builds.
6. **cplace-e2e as test harness, with SDK pins bumped**: `cplace-e2e` is cloned as the runner (config, support, reporters).
   - Packages the PR published that `cplace-e2e` pins (`cf-e2e-testing-sdk`, `*-e2e` packages, paw-fe SDKs) are bumped in the clone with the same recipe before Cypress install.
7. **In-repo specs via an `e2e-tests/` folder**: if the FE repo has `e2e-tests/`, the new workflow copies it into the cloned `cplace-e2e` under `cypress/e2e/<fe-repo>/` before spec calculation and includes it in the spec filter.
   - Specs are written against `cplace-e2e` support and its Cypress version.
   - The backend's `move_own_e2e_tests.sh` is not used or changed.
8. **Small default scope, wider on demand**: the caller passes a per-product default spec filter and a small node count; only the main `e2e` suite runs (no feature-toggle, no Jira suite).
   - Inputs allow a wider filter, more nodes, or the full suite.
   - `timeout-minutes` on every job; concurrency group per workflow + PR number with cancel-in-progress.
9. **Skip with success when nothing relevant is published**: if the PR published no package consumed by the backend or `cplace-e2e`, the job succeeds with a summary saying so.
10. **Reporting via JUnit check and marker comment**: JUnit results published as a check; a PR comment upserted with a marker, older comments minimized; the job fails on any failed test.
    Amended 2026-11-23 (plan Phase 11): advisory mode (`ADVISORY: true`) suspends "the job fails on any failed test" until the exit criteria of the Phase 10 RCA are met. The check and the comment still report every failure, and a backend build failure still fails the job.

This means:
- Every cplace-fe and cplace-paw-fe PR gets real-backend verification as a normal blocking job, with no separate PR in another repo required.
- Paired backend + frontend + spec changes can be verified together by using the same branch name across repos.
- New specs can live in the FE PR itself (`e2e-tests/`) or in a paired `cplace-e2e` branch.
- Changes to the E2E SDK packages are verified against real specs before merge, not first in the nightly upmerge.
- Docs/Storybook-only PRs pay no E2E cost.

Major trade-offs we're accepting:
1. Build time floor: ~30 min backend build on every relevant PR run, in exchange for a proven path that is not blocked on a missing image pipeline and an unproven overlay spike.
2. Registry volume: a JFrog snapshot publish on every PR push, in exchange for an ordered, race-free handoff with an explicit package list.
3. Coverage vs cost: the default scope misses regressions outside the product's default folder, in exchange for bounded per-PR cost and feedback time; the full suite remains available on demand.
4. Cross-ecosystem coupling: the FE workflow depends on `cplace-gh-workflows@release/2.0` internals and FE repos need backend secrets/App access, in exchange for not duplicating the backend E2E engine.
5. Authoring friction: in-repo specs cannot be linted/type-checked in the FE repo (they depend on `cplace-e2e` support and Cypress 13), and the folder convention may shift when the owning-repos design settles.
6. Branch fragility: a stale same-named feature backend branch can fail a FE PR for backend reasons, in exchange for paired-change testing.

What we're NOT doing (out of scope):
- Prebuilt-image mode with FE overlay (needs a compose-compatible nightly E2E image and an overlay feasibility spike) — follow-up.
- Changes to the `/run-e2e-tests` orchestrator, IAP, or the backend PR E2E flow.
- Fixing or reusing the backend's `move_own_e2e_tests.sh`.
- Wiring other FE repos (project-planning, resource-management, forms-wizard), though the naming rule would allow it later.
- Paw-level testing of cplace-fe changes (bumping parent `../main` assets in a cplace-paw build).
- Automatic "affected spec" selection from the FE change set.
- Feature-toggle and Jira suites in the default run.
- Changes to the existing Storybook E2E jobs.

Deferred to planning:
- Mechanism for sharing the built distribution across nodes (artifact vs cache) — implementation detail of decision 3.
- Exact default spec filter per product and default node count — tuning values, not shape.
- Which GitHub App/token posts the PR comment from FE repos (`SVA_ACTIONS_WRITE_PRODUCT_FE`?) and which App clones backend + `cplace-e2e` — wiring, given the read-App installation constraint.
- Whether the label-based `fe-pr-snapshot` caller is retired or kept for manual use — caller housekeeping.
- Exact composite actions/scripts reused from `cplace-gh-workflows` vs small local copies where no composite action exists — implementation detail.
- Input names and the snapshot output format — interface detail.

Success criteria:
- A cplace-fe PR that breaks a real-backend flow covered by the default filter fails the `pr-checks` gate, and the PR comment links the failing specs.
- The report shows the resolved backend and `cplace-e2e` branches and the exact snapshot versions pinned; the built backend's `assets/package-lock.json` contains those versions.
- A docs-only PR passes the check without building the backend.
- A typical PR run finishes within the configured `timeout-minutes`, and a new push cancels the previous run for the same PR.

## Design Decisions - Details

### Workflow Home

**Chosen Approach:** Standalone reusable workflow in `github-actions`, composing backend building blocks cross-repo.

**Rationale:** Matches the established thin-caller / fat-reusable FE pattern, and it is the only option where the result is an ordinary job status that `pr-checks` can gate on with `needs:`.

**Alternatives Considered:**
- **New FE mode in the `/run-e2e-tests` orchestrator** (`npm_overrides` input, IAP dispatch): Rejected because it is asynchronous (a required check would need a status bridge), inherits the 8-node IAP footprint, creates test-branch/test-PR churn per FE PR, and goes through the version rewrite that broke IAP#536.
- **Call backend `e2e-cypress.yml` directly with a new pin input**: Rejected because `build.yml` loads env files from the calling repo's `.github/`, which FE repos lack; making it work needs a refactor of a shared backend workflow that is live for all backend consumers.

**Implications:**
- FE repos need `ENV_CPLACE_ARTIFACTORY_*`, an App installed on the backend repo and `cplace-e2e`, and access to Ubicloud runner vars.
- Drift in `cplace-gh-workflows@release/2.0` can break the FE workflow.

---

### Snapshot Availability

**Chosen Approach:** Unconditional snapshot job inside `pull_request.yaml`, exposing `version` and `packages` outputs.

**Rationale:** The only option giving an ordered, race-free handoff with an explicit list of published packages, which the pin step needs to avoid `notarget`.

**Alternatives Considered:**
- **Keep the separate label workflow and poll registry/comment**: Rejected because the label means not every PR is covered, polling races with the unpublish/republish window, and parsing comment text is fragile.
- **No publish; pack FE build locally and install tarballs**: Rejected because it deviates from registry-based pins, rewrites lock `resolved`/`integrity` to file paths inside the gradle/cplace-asc install (unverified it tolerates this), and needs the same trick for `cplace-e2e`.

**Implications:**
- Snapshot triggers must include `opened`; every push publishes to `cplace-npm-local`.
- The artifacts action writes outputs on PR snapshots (today only on release).

---

### Backend Production

**Chosen Approach:** Build from source once per run; share the distribution across nodes; apply snapshot pins with the upmerge bump recipe.

**Rationale:** The only path not blocked on a missing image pipeline and an unproven overlay spike; all pieces are proven in the backend E2E engine.

**Alternatives Considered:**
- **Both modes now, prebuilt default** (the research-phase decision): Set aside because no compose-compatible prebuilt E2E image exists and overlay feasibility is unknown; it remains the follow-up for faster runs.
- **Build from source with a reserved `backend_mode` input**: Rejected as a dead input until prebuilt mode exists.

**Implications:**
- Only packages in the snapshot job's `packages` output are bumped.
- The per-node `distZip` rebuild seen in the backend engine must be avoided.

---

### Branch Resolution

**Chosen Approach:** Same-named branch if it exists, else mapped base — independently for the backend repo and `cplace-e2e`.

**Rationale:** Enables paired BE+FE and FE+spec changes in one PR, with a base fallback for the common case.

**Alternatives Considered:**
- **Always mapped base**: Rejected because paired changes and new specs in `cplace-e2e` could not be verified until one side merges.

**Implications:**
- FE repos have no gradle project, so `cplace-e2e` branch resolution is done by the new workflow, not `determine_e2e_branch.sh`.
- The resolved branches appear in the report so a backend-caused failure is recognisable.

---

### Test Scope and Cost

**Chosen Approach:** Small default (per-product filter from the caller, ~2 nodes, main suite only), wider via inputs; timeouts and per-PR cancel-in-progress concurrency.

**Rationale:** The only way a required check on every PR stays affordable; the full suite stays reachable.

**Alternatives Considered:**
- **Full `e2e` suite, IAP-sized**: Rejected because ~45–60 min and ~4 vCPU-h per push would slow every merge.
- **Explicit filter only, else skip**: Rejected because the check would pass by default without testing anything.

**Implications:**
- The concurrency group must include the PR number (a `workflow+ref` group silently cancelled dispatches in PFM-ISSUE-34615).

---

### Nothing Published

**Chosen Approach:** Skip the run and succeed with a summary when no package consumed by the backend or `cplace-e2e` was published.

**Rationale:** Avoids a full run that only re-verifies the base.

**Alternatives Considered:**
- **Run against base pins anyway**: Rejected as cost without signal.

**Implications:**
- Correctness relies on nx affected detection in the snapshot job.

---

### cplace-e2e SDK Pins

**Chosen Approach:** Bump published packages that `cplace-e2e` pins in the cloned `cplace-e2e` before Cypress install.

**Rationale:** SDK regressions show on the FE PR instead of in the nightly upmerge.

**Alternatives Considered:**
- **Keep base pins**: Rejected because SDK changes would be tested with the old SDK.

---

### In-Repo Specs

**Chosen Approach:** `e2e-tests/` folder in the FE repo, copied by the new workflow into `cplace-e2e/cypress/e2e/<fe-repo>/` before spec calculation.

**Rationale:** Uses the folder name that both the backend hook default and the `cplace-e2e` owning-repos research already use, without touching the backend's shared script.

**Alternatives Considered:**
- **Fix and reuse `move_own_e2e_tests.sh`**: Rejected because it changes a shared backend script (ordering + `mv` nesting) live for all backend consumers and deepens the cross-repo coupling.
- **Defer in-repo specs**: Rejected because the research phase requires in-repo specs to be supported.

**Implications:**
- In-repo specs depend on `cplace-e2e` support paths and Cypress 13; they are validated only during the E2E run.

---

## Overall Architecture

The FE PR pipeline gains two jobs: an unconditional snapshot publish that outputs the version and published packages, and a backend-e2e job that depends on it and feeds `pr-checks`. The backend-e2e reusable workflow resolves the backend repo and branches, builds the backend once with the snapshot pins applied, then runs a small matrix of nodes that each boot the docker compose stack from the shared build, run their share of the selected specs in the cloned `cplace-e2e` harness, and publish results.

```
FE repo pull_request.yaml
  install-deps ─┬─ build / code-quality / storybook e2e   (unchanged)
                ├─ snapshot (unconditional) ── outputs: version, packages
                └─ backend-e2e (needs snapshot) ──► pr-checks

backend-e2e (github-actions reusable)
  resolve ─► build backend once (pins applied) ─► N nodes: clone cplace-e2e,
            bump SDK pins, copy e2e-tests/, compose up, wait, cypress-repeat ─► report
```

### Key Components
1. **Snapshot job**: publishes affected FE packages for every PR and outputs `version` + `packages`.
2. **Resolve step**: maps FE repo → backend repo, resolves backend and `cplace-e2e` branches, decides skip vs run, builds the spec filter.
3. **Backend build with pin step**: clones backend + parents, bumps published packages in `*/assets`, builds the distribution once.
4. **Test nodes**: harness setup (clone, SDK bump, in-repo spec copy), docker compose boot, readiness wait, Cypress run.
5. **Reporter**: JUnit check, marker PR comment, job status.

### Data Flow
PR push → snapshot job publishes to JFrog `cplace-npm-local` and outputs the package list → backend build installs those exact versions via the backend registry config → distribution shared to nodes → nodes run specs against `localhost:8083/intern/tricia/` → JUnit/mochawesome results aggregated into check + comment.

### Integration Points
- `github-actions`: `fe-pr-snapshot.yml` and the artifacts action (new outputs), new reusable workflow.
- FE callers: `cplace-fe/.github/workflows/pull_request.yaml`, `cplace-paw-fe` `fe-pr.yml` (new jobs, `pr-checks` needs).
- `cplace-gh-workflows@release/2.0`: build stages, `setup_npmrc.sh`, docker compose scripts, `wait_for_cplace_startup.sh`, `calculate_e2e_specs_for_node.sh`, `run_e2e_cypress_test_suite.sh`, JUnit publish.
- Backend repos `cplace` / `cplace-paw`: `*/assets/package.json` + lock, `docker/e2e` compose setup.
- `cplace-e2e`: runner, support, reporters, SDK pins.

## Known Risks

1. **Secrets and App access in FE repos**: paw-fe may lack artifactory/App secrets; the FE read App is not installed on `cplace-e2e` (non-installed repo in `repositories:` fails the mint with 422). - Mitigation: verify and provision before rollout; plan the token per purpose.
2. **Registry visibility**: unverified whether the backend's virtual `cplace-npm` serves fresh `cplace-npm-local` PR snapshots immediately. - Mitigation: verify early in planning; retry install if needed.
3. **gradle/cplace-asc install semantics**: unverified whether assets install uses `npm ci` (honours lock) or `npm install`. - Mitigation: verify in a first trial run that the built assets contain the pinned versions.
4. **Upstream drift**: changes in `cplace-gh-workflows@release/2.0` can break the FE workflow. - Mitigation: pin to a ref/SHA where possible; stage changes with branch-pinned test consumers.
5. **Runner availability**: Ubicloud runner vars may not be available to FE repos. - Mitigation: confirm org-level vars; fall back to a defined runner label.
6. **Default scope tuning**: a too-wide default makes runs slow; a too-narrow one gives false confidence. - Mitigation: start narrow, measure, adjust inputs.

## Next Steps

1. Review this design document
2. Refine if needed based on feedback
3. Proceed to implementation planning: `/spec-driven-development:create_plan specs/2026-11-19_fe-pr-e2e-reusable-workflow/design.md`

## References

- Original ticket: none (no PFM ticket)
- Related research: [Research](./research.md)
- `cplace-e2e/specs/2026-11-19_e2e-tests-in-owning-repos/research.md` — `e2e-tests/` convention, owning-repos direction
- `main/specs/2026-09-28_PFM-ISSUE-28989_adapt-e2e-docker-setup/` — docker compose contract
- `cplace-gh-workflows/specs/2026-09-28_PFM-ISSUE-34932_e2e-branch-remote-unreachable/` — branch resolution rules
- `cplace-fe/specs/2026-10-15_PFM-ISSUE-34281_github-app-cross-repo-clone/` — FE App token pattern
- Similar features: `cplace-gh-workflows` `upmerge_and_bump_releases.sh` (bump recipe), `integration-e2e-orchestrator.yml` (marker reporting)
