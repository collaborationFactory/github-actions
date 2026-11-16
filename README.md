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

guard → install-deps → build ∥ e2e → release (publish + promote + tag, one job) → GitHub release

The `release` job computes the next `version/X.Y.Z` and checks whether any project is affected since
the previous tag of the release line. If so, it publishes all publishable projects at that version,
then pushes the tag. Publish before tag: a `version/*` tag always stands for a complete release. If
the publish or the tag push fails, the job unpublishes that version's artifacts again, so a re-run
or the next push releases the same version. Do not cancel a running release: see Recovery.

The npm dist-tag `release-X.Y` moves only once the whole release is published:

1. **Publish** every project under the staging tag `release-X.Y-pending`.
2. **Promote**: `npm dist-tag add <package>@X.Y.Z release-X.Y`, then remove the staging tag.
3. **Tag**: push `version/X.Y.Z`.

Unpublishing a version also drops every dist-tag that points to it. With the staging tag, a run
that fails while publishing leaves `release-X.Y` on the previous version of every package. (Live
test A8 showed that publishing straight under `release-X.Y` left most packages without the tag after
the cleanup.) The flow never sets `latest`.

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
3. **Update the PR and main callers.** `fe-install-deps.yml` no longer cancels superseded runs;
   each caller decides that itself now (see Concurrency).
   - `fe-pr.yml`: add the `concurrency` block of the template, so a new push to the PR cancels the
     previous run.
   - `fe-main.yml`: remove any `concurrency` block. Every push to main runs to completion and
     publishes its snapshot.

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
(subject prefix `[branch-off]`) are never tagged or published, not even by a forced dispatch: that
run ends green with the warning "FORCE is ignored".

### Required secrets

Passed with `secrets: inherit`: `JFROG_BASE64_TOKEN`, `JFROG_URL`, `JFROG_USER`, `DOT_NPMRC`,
`GIT_USER_TOKEN`, `GIT_USER`, `GIT_USER_EMAIL`, and optionally `PERCY_TOKEN`. The caller needs
`permissions: contents: write`.

### Recovery

- **Publish or tag push failed**: the "Unpublish the incomplete release" step has removed the
  version's artifacts. "Re-run failed jobs" (or the next push) publishes and tags the same version.
- **Promote or tag push failed** (a JFrog error while moving `release-X.Y`, or the push of the git
  tag): the cleanup unpublishes the version as above. The packages already promoted lose
  `release-X.Y` until the next successful release of the line; it does not fall back to the
  previous version. `npm ci` and installs from the lock file are unaffected; only resolving the tag
  fresh (`npm update`, `npm install <package>@release-X.Y`) fails meanwhile. To fix it at once:
  `npm dist-tag add <package>@<previous version> release-X.Y`.
- **A staging tag `release-X.Y-pending` is left on a package**: its removal failed after the
  promotion (a warning in the log). It is harmless; remove it with
  `npm dist-tag rm <package> release-X.Y-pending`.
- **A release run was cancelled while publishing**: not supported, the result is not consistent.
  The cancel ends the publish step, but not the publisher process. It keeps building and publishing
  until the job ends, also while the cleanup step runs. It can leave packages of that version behind
  and, in the worst case, still move `release-X.Y` and push the tag. Live test A9 left 3 of 27
  packages behind. Check the tag first: if `version/X.Y.Z` exists, the release is complete. If not,
  use "Re-run failed jobs": the publish fails on the first leftover package, and the cleanup of that
  attempt unpublishes all packages of the version. Re-run failed jobs again to release it. A
  cancel before the publish step starts is safe.
- **The cleanup did not run or failed** (lost runner, JFrog error): the next publish of that version
  fails with E403. `npm unpublish` can also report success and delete nothing (seen once, in live
  test A9); the next re-run then fails with E403 on that package, and its cleanup unpublishes the
  version again. If it survives that too, unpublish the packages of that version that are still in
  the registry (`npm unpublish <scope>/<package>@X.Y.Z --force`), then re-run.
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
| `fe-main.yml`    | none                                            | every push runs to completion, runs may overlap                          |

No release is lost when a pending release run is cancelled: the run that executes checks everything
since the previous tag of the line.

`fe-main.yml` has no group on purpose. Its snapshot covers the projects affected since
`github.event.before`, so a cancelled run, or a pending run that a group drops when a third push
arrives, would leave the projects affected only by that push without a snapshot. Overlapping runs
publish distinct snapshot versions; the `snapshot` dist-tag ends up on the run that finishes last.

### GitHub release

Created with `GITHUB_TOKEN`. The generated notes start at the previous tag of the same release line,
and "Latest" is set only for the highest `version/*` tag.
