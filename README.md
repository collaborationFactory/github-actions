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

guard → install-deps → build ∥ e2e → release (tag + publish, one job) → GitHub release

The `release` job computes the next `version/X.Y.Z` and checks whether any project is affected since
the previous tag of the release line. If so, it pushes the tag, then publishes all publishable
projects at that version. Tag before publish: if the tag push fails, the next run retries the same
version; if the publish fails after the tag was pushed, the version is lost and the next release is
the next patch (see Recovery).

### Caller

Copy `.github/workflow-templates/fe/fe-release.yml` to `.github/workflows/fe-release.yml` of the
consumer repo, with the `@release/X.Y` (or `@master`) ref of that branch.

- **When migrating a branch, delete the old branch-push and tag-push caller files in the same
  commit** (`fe-release.yml` as tagger plus `fe-tag-pushed.yml` / `on_tag_pushed.yaml` /
  `tag_pushed.yml`). The release flow still pushes the tag with the PAT, so a tag-push workflow left
  in the tree would publish a second time.
- Keep the file name `fe-release.yml`. The copy on the default branch is the seed for branch-off.
- Set `RUN_E2E: false` only for repos that do not run e2e before a release.

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

- **Publish failed after the tag was pushed** (the job summary names the phase that failed): run a
  **forced dispatch** on the branch. It releases the next patch; the failed version stays behind as
  a dangling tag. "Re-run failed jobs" of a push run does not help: nothing is affected since the
  tag that run already pushed, so it releases nothing.
- **Re-running only `github-release`** reuses the same tag and does nothing if the release already
  exists.
- **A forced dispatch** releases even when no project is affected.
- **Warning: do not re-run a successful forced dispatch.** A re-run keeps `force: true`, so it cuts
  another patch with identical content. Re-running a successful push run is harmless: nothing is
  affected since the tag it pushed.

### Concurrency

One run per branch at a time, non-cancelling (`fe-release-${{ github.ref }}`). GitHub keeps only the
newest pending run. No change is lost when a pending run is cancelled: the run that executes checks
everything since the previous tag of the line.

### GitHub release

Created with `GITHUB_TOKEN`. The generated notes start at the previous tag of the same release line,
and "Latest" is set only for the highest `version/*` tag.
