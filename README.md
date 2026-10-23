# GitHub actions for collaboration Factory

## Node 24 Compatibility

All reusable FE workflows (`.github/workflows/fe-*.yml`) are Node 24 compatible (GitHub's default
JavaScript action runtime since June 2026).

- All external actions are pinned to commit SHAs (`uses: owner/repo@<sha> # vX.Y.Z`) and unified to
  the latest majors: checkout v6, cache v5, setup-node v6, upload-artifact v7, download-artifact v8,
  github-script v9, sonarqube-scan-action v8.
- Self-hosted runners must run GitHub Actions Runner **>= 2.327.1**.
- `.npmrc` provisioning uses the in-repo composite `.github/actions/use-npmrc` (input `dot-npmrc`),
  referenced per release branch like all internal composites.
- `.github/dependabot.yml` keeps the SHA pins current on `master` and the active release branches
  (`release/25.2` through `release/26.2`) via per-branch `target-branch` entries; each branch gets
  one grouped Action-update PR per week.

## FE Release Flow

### What it does

`.github/workflows/fe-release-flow.yml` releases a FE repo in **one run** per push to `release/*`
(or per manual dispatch):

guard → install-deps → build ∥ e2e → release (publish + tag, one job) → GitHub release

The `release` job computes the next `version/X.Y.Z` and checks whether any project is affected since
the previous tag of the release line. If so, it publishes all publishable projects at that version,
then pushes the tag. Publish before tag: a `version/*` tag always stands for a complete release. If
the publish or the tag push fails, or the run is cancelled before the tag is pushed, the job
unpublishes that version's artifacts again, so a re-run or the next push releases the same version.

### Migration steps

Migrate a branch of a consumer repo in **one commit**:

1. **Add the release caller.** Copy `.github/workflow-templates/fe/fe-release.yml` to
   `.github/workflows/fe-release.yml`, with the `@release/X.Y` (or `@master`) ref of that branch.
   - Keep the file name `fe-release.yml`. The copy on the default branch is the seed for branch-off.
   - Set `RUN_E2E: false` only for repos that do not run e2e before a release.
2. **Delete the old release callers**: `fe-release.yml` as tagger, plus `fe-tag-pushed.yml` /
   `on_tag_pushed.yaml` / `tag_pushed.yml`.
   - The release flow still pushes the tag with the PAT, so a tag-push workflow left in the tree
     would try to publish that tag again, and would release manually pushed tags.
   - The `guard` job fails while any workflow of the branch still calls `workflows/fe-release.yml` or
     `workflows/fe-tag.yml`.
   - PFM-ISSUE-34282 (pushing the tag with `GITHUB_TOKEN`, which triggers no workflows) removes the
     tag-push trigger for good.
3. **Add the `concurrency` block to the PR and main callers**, as in the `fe-pr.yml` and
   `fe-main.yml` templates. `fe-install-deps.yml` no longer cancels superseded runs; each caller
   does that itself now.

`fe-tag.yml` and `workflows/fe-release.yml` are **deprecated**: every run of them shows a warning.
They stay functional for branches that are not migrated yet.

### Triggers and `force`

| Trigger                  | Branch         | Behavior                                                                                                                    |
| ------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| push                     | `release/*`    | build/e2e → release if a project is affected since the previous tag of the line (or first tag of the line) → GitHub release |
| dispatch, `force: true`  | `release/*`    | build/e2e → release (affected check bypassed) → GitHub release                                                              |
| dispatch, `force: true`  | default branch | build/e2e → snapshot of all projects, no tag, no GitHub release                                                             |
| dispatch, `force: false` | either         | build/e2e only (dry run)                                                                                                    |

Build and e2e always cover all projects. A dispatch on any other ref fails in `guard`. Every push
runs the flow, including upmerges, like in the backend repos. Only commits created by branch-off
(subject prefix `[branch-off]`) are never tagged or published.

### Required secrets

Passed with `secrets: inherit`: `JFROG_BASE64_TOKEN`, `JFROG_URL`, `JFROG_USER`, `DOT_NPMRC`,
`GIT_USER_TOKEN`, `GIT_USER`, `GIT_USER_EMAIL`, and optionally `PERCY_TOKEN`. The caller needs
`permissions: contents: write`.

### Recovery

- **Publish or tag push failed**: the "Unpublish the incomplete release" step has removed the
  version's artifacts. "Re-run failed jobs" (or the next push) publishes and tags the same version.
- **The cleanup did not run or failed** (lost runner, JFrog error): the next publish of that version
  fails with E403. Unpublish the packages of that version listed in the job log
  (`npm unpublish <scope>/<package>@X.Y.Z --force`), then re-run.
- **Only `github-release` failed**: use **"Re-run failed jobs"**. It reuses the tag of the `release`
  job and creates the GitHub release (it does nothing if the release already exists). Do not use
  "Re-run all jobs": the `release` job finds nothing affected since the tag it already pushed, so the
  GitHub release is skipped. If the run can no longer be re-run, create the release by hand:
  `gh release create version/X.Y.Z --verify-tag --generate-notes`.
- **A forced dispatch** releases even when no project is affected.
- **Warning: do not re-run a successful forced dispatch.** A re-run keeps `force: true`, so it cuts
  another patch with identical content. Re-running a successful push run is harmless: nothing is
  affected since the tag it pushed.

### Concurrency

Concurrency is set by the callers, not by the reusable workflows:

| Caller           | Group                                           | Behavior                                                                 |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| `fe-release.yml` | `fe-release-${{ github.ref }}`                  | one run per branch, never cancelled; only the newest pending run is kept |
| `fe-pr.yml`      | `fe-pr-${{ github.event.pull_request.number }}` | a new push to the PR cancels the previous run                            |
| `fe-main.yml`    | `fe-main-${{ github.ref }}`                     | a new push cancels the previous run                                      |

No release is lost when a pending release run is cancelled: the run that executes checks everything
since the previous tag of the line.

### GitHub release

Created with `GITHUB_TOKEN`. The generated notes start at the previous tag of the same release line,
and "Latest" is set only for the highest `version/*` tag.
