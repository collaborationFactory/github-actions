# Replace shared GitHub user account in frontend workflows (PFM-ISSUE-33676) Implementation Plan

## Overview

Remove the last places where the shared GitHub user account (`GIT_USER_TOKEN`, `GIT_USER`, `GIT_USER_EMAIL`, actor
`squad-fe`) authenticates or identifies FE workflow activity:

- In this repo, the upmerge check and the release flow get a fixed `github-actions[bot]` identity. Their `GIT_USER*`
  declarations become optional and unused.
- In cplace-fe, the visual-baseline heal pushes with a short-lived `sva-actions-upmerge` App token, and storybook
  commits as `github-actions[bot]`.
- Everything is proven live in `collaborationFactory/clone-cplace-fe`, with its `GIT_USER*` secrets deleted. That
  includes a real App-token heal push through a branch ruleset.
- Finally, the AC1 usage mapping is extended with a 15-repo audit.

## Current State Analysis

- `.github/workflows/fe-check-upmerge.yml:5-11` declares `SLACK_TOKEN_UPMERGE`, `GIT_USER_EMAIL` and `GIT_USER`, all
  `required: true`.
  - `:20` passes the undeclared `inputs.GHA_REF` as `ref:`. It always resolves to empty.
  - `:36-39` passes the three secrets as env to the upmerge composite action `@master`.
- `tools/scripts/upmerge/upmerge.ts:12-21` runs `git config --global user.email/user.name` from `GIT_USER*`,
  unquoted. `upmerge.test.ts` covers only `isUpmergeNeeded()`.
- `.github/workflows/fe-release-flow.yml:24-27` declares `GIT_USER`/`GIT_USER_EMAIL` as `required: true`.
  - `:140-146`, the "Configure git user" step, sets the identity from these secrets through env.
- `.github/workflow-templates/fe/fe-check-upmerge.yml:16-19` passes `GIT_USER*` explicitly.
- `README.md:83-91` ("Required secrets") lists `GIT_USER`/`GIT_USER_EMAIL`.
- cplace-fe `origin/main` `.github/workflows/heal-visual-baselines.yml`:
  - `:60-62` has a comment that names the PAT.
  - `:79` sets `BOT_EMAIL: secrets.GIT_USER_EMAIL`.
  - `:93-100` checks out with `token: secrets.GIT_USER_TOKEN`.
  - `:153-162` sets the identity from `GIT_USER*`.
- cplace-fe `deploy_storybook.yaml:42-43` sets `git config user.name squad-fe` / `user.email github-actions@github.com`.
- clone-cplace-fe, as of 2026-11-27:
  - Branches are `main` (default), `release/26.4` and `release/26.3`.
  - Repo secrets include `GIT_USER`, `GIT_USER_EMAIL` and `GIT_USER_TOKEN`. There is **no** `SLACK_TOKEN_UPMERGE`.
  - Last tag: `version/26.4.12`. `default_workflow_permissions: read`.
  - It has no rulesets and no branch protection, and no `type` custom property, so `product-fe` does not apply to it.
  - It has no `heal-visual-baselines.yml`. It does have `.github/scripts/heal-gate.mjs` and the three visual apps.
  - `main`'s snapshot/PR callers are on the `test/PFM-ISSUE-34293-jfrog-token` interface (`JFROG_TOKEN`). 34293 is
    not on `master`, so those callers must **not** be repointed to a master-based test branch.
  - Shared-account references: `cron_check_upmerge.yaml:17-18` (`GIT_USER*`) on all three branches.
    `deploy_storybook.yaml:42` (`squad-fe`) on all three. `push_main.yaml:45` (`GIT_USER_TOKEN`) on `release/26.4`
    and `release/26.3`.
- `sva-actions-upmerge` (App 3487076, installation `126667289`, `contents: write` + `metadata: read`):
  - The installation is on selected repos: `cplace-fe` and `cplace-2lforge-messages`.
  - Org secrets `SVA_ACTIONS_UPMERGE_ID`/`_KEY` have `selected` visibility and do not include clone-cplace-fe.
  - The App is a bypass actor on org ruleset `product-fe` (id 23989082). That ruleset targets repos with property
    `type=frontend-product`, on the default branch and `release/*`.

## Desired End State

- **This repo:** `GIT_USER*` appears only as optional, unused declarations in `fe-check-upmerge.yml` and
  `fe-release-flow.yml`, plus the deprecated `fe-tag.yml`. No reusable workflow or tool reads a shared-account
  secret.
- **clone-cplace-fe:**
  - It has no `GIT_USER`, `GIT_USER_EMAIL` or `GIT_USER_TOKEN` repo secret.
  - None of its branches references them or `squad-fe` as an identity.
  - A release, an upmerge check and a snapshot-PR comment have passed live without them.
  - An App-token heal push has landed on a ruleset-protected `main`, authored as `sva-actions-upmerge[bot]`, and
    the heal gate skipped that commit.
- **cplace-fe:** a PR on `main` carries the heal and storybook changes that were tested in the clone.
- **`research.md`:** it has an AC1 addendum mapping every shared-account use across this repo and the 15 FE repos to
  its replacement and owner.

### Key Discoveries:
- **Correct bot email:** the `github-actions[bot]` user id is **41898282** (`gh api users/github-actions%5Bbot%5D`).
  The noreply address is `41898282+github-actions[bot]@users.noreply.github.com`. The design's `41898828` is a typo.
  The plan uses the correct id.
- **`sva-actions-upmerge[bot]`** has user id 278916743, so its address is
  `278916743+sva-actions-upmerge[bot]@users.noreply.github.com`. This matches the design.
- **Token input:** the backend mints this App's token with `create-github-app-token` v3.2.0 and `app-id:`
  (`cplace-gh-workflows` `prepare-git-environment/action.yml:37-44`). `app-id` works on the v3.3.0 pin from the
  devkit template: `64ab729a6294000f5aa4a4bc0b73d1f32bc45510`.
- **Token lifetime:** heal jobs have run for up to 54 minutes (cplace-fe runs 38876743753 and 38412506316), and App
  tokens expire after 1 hour. So the token is minted **immediately before the push** and only when a heal is needed.
  Checkout uses the default token with `persist-credentials: false`. This is an implementation detail inside the
  design's decision 3: same App, same scope, same push.
- **Central upmerge:** `cplace-gh-workflows` `auto-pr-upmerge.yml`, which the clone calls with `secrets: inherit`,
  reads no `GIT_USER*`. It uses `SVA_ACTIONS_UPMERGE_*` and Slack secrets.
- **Composite ref:** `fe-check-upmerge.yml` calls the upmerge action `@master`. A live test needs the established
  test-branch pattern: rewrite internal `@master` refs to the test branch
  (`specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/live-test-plan.md` §2.3 T1).
- **15 FE repos:** the 14 repos with `type=frontend-product`, plus `cplace-e2e`. The 14 are `cplace-2lforge-toolbar-fe`,
  `cplace-2lforge-trees-fe`, `cplace-citizen-ai-fe`, `cplace-dataciders-portfolio-management-fe`, `cplace-fe`,
  `cplace-loomeo-fe`, `cplace-lowcode-widget-builder-fe`, `cplace-office-reports-fe`, `cplace-paw-fe`,
  `cplace-project-planning-fe`, `cplace-remote-filesystem-fe`, `cplace-resource-management-fe`,
  `cplace-time-bounded-values-fe` and `cplace-workflow-fe`.
- **Heal gate:**
  - On `workflow_dispatch`, `heal-gate.mjs` `decideDispatch()` proceeds for the chosen app unless HEAD carries
    `[skip visual-heal]`. It does not use `BOT_EMAIL`.
  - On push, it skips the heal's own commit through the loop-break.
- **Existing test pattern:** `tools/scripts/upmerge/upmerge.test.ts` uses `jest.spyOn(child_process, 'execSync')`.
- **`squad-fe` in npm metadata:** `tools/scripts/artifacts/nx-project.ts:324,336` uses `squad-fe` only as the npm
  `package.json` `author`. It is not a credential or a git identity, so it is out of scope.

## What We're NOT Doing

- Deleting `fe-tag.yml` or `workflows/fe-release.yml`, or switching them away from the PAT (migration/cleanup ticket).
- Removing the `GIT_USER*` declarations from `workflow_call.secrets` (migration/cleanup ticket).
- Migrating consumer repos off `fe-tag.yml`, removing cplace-fe's `squad-fe` pusher guard, or deleting `GIT_USER*`
  secrets in any repo other than clone-cplace-fe.
- Narrowing `permissions:` in caller templates, including the upmerge template (PFM-ISSUE-35504).
- Removing `printenv` from the upmerge composite action, or changing `--release 5.17`.
- Changing cplace-fe release lines, `.npmrc`/JFrog service users, or `nx-project.ts`'s npm `author`.
- Setting up a new GitHub App, or **permanently** changing `sva-actions-upmerge`'s installation or secret
  visibility. Phase 3's changes are temporary and are reverted.
- Moving clone-cplace-fe's `main` snapshot/PR callers off the 34293 test branch.

## Implementation Approach

Four phases, each ending in a human checkpoint:

1. **Code changes in this repo**, unit-tested and linted.
2. **Live integration in clone-cplace-fe.** Phase 1 runs end to end there, through a test branch, with the secrets
   deleted.
3. **The cplace-fe heal and storybook changes.** They are written on a cplace-fe branch, copied into the clone, and
   proven with a real ruleset-bypass push. Then the cplace-fe PR is opened.
4. **The AC1 audit and mapping.**

Integration comes in phase 2, right after the code changes, so nothing is deferred to the end.

**Placeholders**

| Name | Value |
|---|---|
| `FB` | `improvement/PFM-ISSUE-33676-Replace-shared-GitHub-user-account-in-frontend` (both this repo and cplace-fe) |
| `TEST_BRANCH` | `test/PFM-ISSUE-33676-bot-identity` (this repo) |
| `R` | `collaborationFactory/clone-cplace-fe` |
| `GA` | `C:/cplace-dev/repos-gradle/github-actions` |
| `CL` | `C:/cplace-dev/repos-gradle/clone-cplace-fe` |
| `CFE` | `C:/cplace-dev/repos-gradle/cplace-fe` |
| `BOT_NAME` / `BOT_EMAIL_GA` | `github-actions[bot]` / `41898282+github-actions[bot]@users.noreply.github.com` |
| `APP_BOT_NAME` / `APP_BOT_EMAIL` | `sva-actions-upmerge[bot]` / `278916743+sva-actions-upmerge[bot]@users.noreply.github.com` |
| `CLONE_REPO_ID` | `1430984878` |
| `UPMERGE_INSTALLATION` | `126667289` |

**Stop rules**

- Ask the user before every push to `github-actions` or `cplace-fe`, before deleting secrets, and before every
  org-level change (App installation, org-secret visibility).
- Pushes to clone-cplace-fe are allowed. It is the test fork.
- In Git Bash, set `MSYS_NO_PATHCONV=1` for `git show <rev>:<path>` and `gh api` paths.

---

## Phase 1: Bot identity and optional secrets in github-actions

### Overview
Implement design decisions 1, 2 and 6 on `FB`, which is branched from `master`. Nothing is pushed in this phase.

### Changes Required:

#### 1. Upmerge reusable workflow
**File**: `.github/workflows/fe-check-upmerge.yml`
**Changes**:
- `GIT_USER*` become `required: false`, with a removal comment.
- Delete the `ref:` line.
- Add an identity step.
- Stop passing `GIT_USER*` to the action.

```yaml
on:
  workflow_call:
    secrets:
      SLACK_TOKEN_UPMERGE:
        required: true
      # Unused since PFM-ISSUE-33676 (the git identity is the github-actions bot). Kept optional so
      # callers that still pass them keep working; removed by the FE migration/cleanup ticket.
      GIT_USER_EMAIL:
        required: false
      GIT_USER:
        required: false

jobs:
  check-upmerge:
    name: Run Upmerge Flow
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
        with:
          fetch-depth: 0

      # cplace-cli makes local merge commits (--no-push), which need an author. --global, as before,
      # in case the CLI merges outside the checkout.
      - name: Configure git identity
        run: |
          git config --global user.name 'github-actions[bot]'
          git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'

      # setup-node and the node_modules cache are unchanged

      - name: check if upmerge is necessary and post to slack
        uses: collaborationFactory/github-actions/.github/actions/upmerge@master
        env:
          SLACK_TOKEN_UPMERGE: ${{ secrets.SLACK_TOKEN_UPMERGE }}
```

#### 2. Upmerge script
**File**: `tools/scripts/upmerge/upmerge.ts`
**Changes**: delete the two `execSync('git config --global …')` calls (`:12-21`).
`checkUpmergeAndNotifiy()` becomes:

```ts
  public async checkUpmergeAndNotifiy() {
    const slackMessage = this.isUpmergeNeeded();
    await this.postToSlack(slackMessage);
  }
```

#### 3. Upmerge unit test (existing file, existing pattern)
**File**: `tools/scripts/upmerge/upmerge.test.ts`
**Changes**: append one test proving that the script no longer configures git. It follows the file's
`jest.spyOn(child_process, 'execSync')` pattern.

```ts
test('does not configure a git identity', async () => {
  const execSpy = jest
    .spyOn(child_process, 'execSync')
    // cast: execSync is overloaded; ts-jest type-checks the test
    .mockImplementation(((cmd: string) =>
      cmd.startsWith('git config --get remote.origin.url')
        ? 'https://github.com/collaborationFactory/cplace-fe.git'
        : 'Merging upmerge-x/release/24.1 into origin/main\n') as any);
  const handler = new UpmergeHandler();
  const slackSpy = jest
    .spyOn(handler, 'postToSlack')
    .mockResolvedValue(undefined);

  await handler.checkUpmergeAndNotifiy();

  const commands = execSpy.mock.calls.map(([cmd]) => String(cmd));
  expect(commands.some((c) => c.includes('user.name') || c.includes('user.email'))).toBe(false);
  expect(slackSpy).toHaveBeenCalledWith({ message: '' });
  execSpy.mockRestore();
  slackSpy.mockRestore();
});
```

#### 4. Release flow
**File**: `.github/workflows/fe-release-flow.yml`
**Changes**:
- `:24-27`: `GIT_USER`/`GIT_USER_EMAIL` become `required: false`, with the same removal comment as in change 1.
- `:140-146`: the step gets fixed values and no secret env.

```yaml
      - name: Configure git user
        run: |
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
```

#### 5. Upmerge caller template
**File**: `.github/workflow-templates/fe/fe-check-upmerge.yml`
**Changes**: delete lines 18-19 (`GIT_USER_EMAIL`, `GIT_USER`). The `permissions:` block stays as it is (35504).

#### 6. README
**File**: `README.md`
**Changes**: in "Required secrets" (`:83-91`):
- Drop `GIT_USER`, `GIT_USER_EMAIL` from the list.
- Add one sentence: the flow sets the `github-actions[bot]` identity itself. `GIT_USER`/`GIT_USER_EMAIL` are still
  accepted but unused.
- Add one sentence for the upmerge check: it needs only `SLACK_TOKEN_UPMERGE`.
- Keep the `GIT_USER_TOKEN` paragraph (`:89-91`). After it, add: "A repo can delete `GIT_USER` and `GIT_USER_EMAIL`
  once no caller passes them explicitly, and `GIT_USER_TOKEN` once none of its branches calls `fe-tag.yml` or
  `workflows/fe-release.yml`."

### Success Criteria:

#### Automated Verification:
- [x] Upmerge unit tests pass, including the new one: `npx jest --config=./jest.config.js tools/scripts/upmerge`
- [x] The full test suite passes: `npm test`
  - Note (2026-11-27, Windows): 92/100 pass. The 8 failures (`artifacts-handler-tag`, `nx-project`, `utils`
    suites) are identical on `master`: Windows path separators (`\mock\…` vs `/mock/…`). They are unrelated to this
    change. The new upmerge test was confirmed to fail against the old `upmerge.ts`.
- [x] actionlint is clean on the changed workflows: `~/go/bin/actionlint .github/workflows/fe-check-upmerge.yml .github/workflows/fe-release-flow.yml`
- [x] Only the optional declarations and `fe-tag.yml` remain. This prints nothing:
  `grep -rn "GIT_USER" .github tools | grep -v "^.github/workflows/fe-tag.yml" | grep -vE "^\.github/workflows/(fe-check-upmerge|fe-release-flow)\.yml:[0-9]+: +GIT_USER(_EMAIL)?:$"`
- [x] No `GIT_USER*` declaration in either workflow is required. This prints nothing:
  `grep -A1 -E "^ +GIT_USER(_EMAIL)?:$" .github/workflows/fe-check-upmerge.yml .github/workflows/fe-release-flow.yml | grep "required: true"`
- [x] The undeclared input is gone. This prints nothing: `grep -n "inputs.GHA_REF" .github/workflows/fe-check-upmerge.yml`
- [x] Every identity uses the correct bot id: `grep -rn "41898828" .github README.md` prints nothing, and
  `grep -rn "41898282+github-actions" .github/workflows` prints exactly two lines
- [x] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 1 complete. Summary: bot identity
  in fe-check-upmerge.yml and fe-release-flow.yml, GIT_USER* optional and unused, upmerge.ts no longer sets git
  config (new unit test), template and README updated; nothing pushed yet. Please review the changes and reply
  'yes' to continue to Phase 2." Do NOT proceed until the user explicitly approves. This checkpoint cannot be
  skipped or pre-checked.
  - Approved 2026-11-27. The user asked whether the noreply bot email is needed; it is not for these two
    workflows (nothing they commit is pushed), but the user chose to keep it as planned.

#### Manual Verification:
- [x] The diff touches only the six files above.
- [x] The README wording reads correctly next to the migration section.

---

## Phase 2: Live verification in clone-cplace-fe without the shared-account secrets

### Overview
Prove AC2 and AC3 for this repo's workflows:

- Point the clone's affected callers at a test branch.
- Remove every shared-account reference from all three clone branches.
- Delete the three secrets.
- Run a release, an upmerge check and a snapshot-PR comment.

This also covers the R6 test that 34282 skipped.

### Changes Required:

#### 1. Push the feature branch and build the test branch (stop: pushes to github-actions)
**File**: `GA` branches `FB` and `TEST_BRANCH`
**Changes**:
1. Commit Phase 1 on `FB` (attribution per the session rules) and push `FB`.
2. Create the test branch: `git switch -c $TEST_BRANCH $FB`.
   - Commit 1, "Test branch: point internal refs to `TEST_BRANCH`":
     ```bash
     grep -rlE 'collaborationFactory/github-actions/\.github/.+@master' .github/workflows .github/actions \
       | xargs sed -i "s#\(collaborationFactory/github-actions/\.github/[^@]*\)@master#\1@$TEST_BRANCH#g"
     ```
   - Commit 2: drop the e2e job from `fe-release-flow.yml`, as in 34282 (`git cherry-pick 52aca8a`). On conflict,
     redo it by hand: drop the `e2e` job and the `RUN_E2E` input, set `release.needs: build`, and drop the
     `needs.e2e` condition.
3. Push `TEST_BRANCH`.

#### 2. Remove shared-account use on every clone branch
**File**: `clone-cplace-fe: .github/workflows/*` on `main`, `release/26.4`, `release/26.3`
**Changes**: one commit per branch, touching only the files listed, and never `package.json`/`package-lock.json`
(xray).

| File | `main` | `release/26.4` | `release/26.3` |
|---|---|---|---|
| `cron_check_upmerge.yaml` | `uses:` → `fe-check-upmerge.yml@$TEST_BRANCH`. Delete the `GIT_USER_EMAIL`/`GIT_USER` lines. | same | same |
| `deploy_storybook.yaml` | `git config user.name 'github-actions[bot]'` and `user.email '41898282+github-actions[bot]@users.noreply.github.com'` | same | same |
| `fe-release.yml` | unchanged (34282 test ref, default-branch snapshot only) | `uses:` → `fe-release-flow.yml@$TEST_BRANCH` | `uses:` → `fe-release-flow.yml@$TEST_BRANCH`. Its old 34283 ref still requires `GIT_USER*`. |
| `push_main.yaml` | unchanged (no `GIT_USER*`, 34293 interface) | delete the `GIT_USER_TOKEN:` line | delete the `GIT_USER_TOKEN:` line |

- Do not touch the `main` snapshot/PR callers on `test/PFM-ISSUE-34293-jfrog-token`.
- The push to `release/26.4` starts a release run with nothing affected (**L0a**). The push to `release/26.3` starts
  one too (**L0b**). The push to `main` starts the main CI (**L0c**).

#### 3. Prepare and delete secrets (stop: ask before deleting)
**File**: `clone-cplace-fe` repo secrets
**Changes**:
- `gh secret set SLACK_TOKEN_UPMERGE -R $R --body dummy-not-a-slack-token`.
  - The upmerge caller requires this secret, and the clone has none.
  - With a dummy value, a Slack post fails inside `postToSlack`'s try/catch, which only logs the error. So nothing
    reaches the real `#frontend-upmerge` channel.
- After L0a, L0b and L0c pass, and with the user's confirmation:
  `gh secret delete GIT_USER_TOKEN -R $R; gh secret delete GIT_USER -R $R; gh secret delete GIT_USER_EMAIL -R $R`.

#### 4. Live runs, with the secrets deleted

| ID | Trigger | Expected |
|---|---|---|
| **L1 Release** | `gh workflow run fe-release.yml -R $R --ref release/26.4 -f force=true` | RELEASE(26.4.13) as in the 34282 live-test plan, R2/R6. `guard`, `install-deps`, `build`, `release` and `github-release` all succeed. The log line `Uses: …fe-release-flow.yml@refs/heads/$TEST_BRANCH`. "Configure git user" shows the fixed values with no secret env. `refs/tags/version/26.4.13` is lightweight. The GitHub release author is `github-actions[bot]`. There is no `Secret … is required, but not provided` error. |
| **L2 Upmerge** | `gh workflow run cron_check_upmerge.yaml -R $R --ref main` | The run succeeds, using `fe-check-upmerge.yml@refs/heads/$TEST_BRANCH`. The "Configure git identity" step ran. The log shows `cliResult:` (cplace-cli ran with no identity error) and `finished upmerge workflow`. A Slack `invalid_auth` error in the log is expected. |
| **L3 Snapshot PR comment** | Branch `test/33676-snapshot` from `main` with a one-line comment change in a publishable lib (for example `libs/cf-frontend-sdk/src/index.ts`). Open a PR to `main` and add the `snapshot` label. | `publish-pr-snapshot` succeeds. The PR has exactly one comment containing `<!-- published-artifacts -->`, authored by `github-actions[bot]`. Afterwards, close the PR (the close workflow cleans up snapshots) and delete the branch. |
| **L4 Main push** | The L3 PR is not merged. Instead, push an empty commit to `main`: `git commit --allow-empty -m "33676 L4: main CI without GIT_USER secrets"` | `push_main.yaml` succeeds with the secrets gone. |

Record run IDs and results in a new file `specs/2026-11-26_PFM-ISSUE-33676_replace-shared-github-user/live-test-log.md`
(sections L0–L4, then H0–H4 in Phase 3).

### Success Criteria:

#### Automated Verification:
- [ ] The test branch refs point at itself. This prints nothing:
  `git -C $GA grep -nE 'collaborationFactory/github-actions/\.github/.+@' origin/$TEST_BRANCH -- .github/workflows .github/actions | grep -v "@$TEST_BRANCH"`
- [ ] The test branch differs from `FB` only by the ref rewrite and the e2e drop:
  `git -C $GA diff --stat origin/$FB origin/$TEST_BRANCH`
- [ ] No shared-account secret left. This prints nothing: `gh secret list -R $R | grep -E "^GIT_USER"`
- [ ] No clone branch references them. This prints nothing:
  `for b in main release/26.4 release/26.3; do git -C $CL grep -nE 'secrets\.GIT_USER|GIT_USER_TOKEN|user\.name +squad-fe' origin/$b -- .github; done`
- [ ] L0a, L0b, L0c, L1, L2, L3 and L4 all concluded `success`: `gh run view <id> -R $R --json conclusion`
- [ ] The L1 tag exists and is lightweight:
  `gh api repos/$R/git/refs/tags/version/26.4.13 --jq .object.type` prints `commit`
- [ ] The L1 release is authored by the bot:
  `gh api repos/$R/releases/tags/version/26.4.13 --jq .author.login` prints `github-actions[bot]`
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 2 complete. Summary: TEST_BRANCH
  pushed, all three clone branches free of GIT_USER*/squad-fe, the three secrets deleted, and release 26.4.13,
  upmerge check, snapshot PR comment and main CI all passed (run IDs in live-test-log.md). Please review and reply
  'yes' to continue to Phase 3." Do NOT proceed until the user explicitly approves. This checkpoint cannot be
  skipped or pre-checked.

#### Manual Verification:
- [ ] The L2 log shows cplace-cli processed the clone's release chain (`release/26.3` → `release/26.4` → `main`)
  without an identity error.
- [ ] The L3 PR comment lists the published snapshot versions.

---

## Phase 3: cplace-fe heal App token and storybook identity, proven in clone-cplace-fe

### Overview
Implement design decisions 3 and 4 on cplace-fe `FB`, which is branched from `origin/main`. Copy the exact heal
workflow into the clone, give the clone temporary access to the App plus a `product-fe`-like ruleset, force a
baseline drift, and prove the App pushes through the bypass. Then revert the temporary access and open the cplace-fe
PR.

### Changes Required:

#### 1. Heal workflow
**File**: `cplace-fe: .github/workflows/heal-visual-baselines.yml`
**Changes**:
- `:60-62`: change the comment's "with a branch-protection bypass PAT" to "with the sva-actions-upmerge App token
  (bypass actor on the org `product-fe` ruleset)".
- `:79`: delete `BOT_EMAIL: ${{ secrets.GIT_USER_EMAIL }}`. The gate treats an empty value as "no bot".
- `heal` job: change `permissions: contents: write` to `contents: read`, since the push now uses the App token.
- Checkout `:93-100`: remove `token:` and its comment, and set `persist-credentials: false`.
- Insert a token step directly before "Heal baselines", with the same `if:` as that step.
- In "Heal baselines", change the env and the identity, and point `origin` at the App token before the
  pull/push loop.

```yaml
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.ref || github.sha }}
          fetch-depth: 0
          # The push authenticates with the App token minted right before it (see below).
          persist-credentials: false

      # ... render steps unchanged ...

      # Minted only when a heal is needed, and just before the push: App tokens live one hour and a
      # heal job can run close to that. sva-actions-upmerge is a bypass actor on the org `product-fe`
      # ruleset (default branch and release/*), which lets this commit land on protected branches.
      - name: Get sva-actions-upmerge token
        id: app-token
        if: steps.render1.outcome == 'failure' && steps.render2.outcome == 'failure'
        uses: actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0
        with:
          app-id: ${{ secrets.SVA_ACTIONS_UPMERGE_ID }}
          private-key: ${{ secrets.SVA_ACTIONS_UPMERGE_KEY }}
          owner: ${{ github.repository_owner }}
          repositories: ${{ github.event.repository.name }}
          permission-contents: write

      - name: Heal baselines
        id: heal
        if: steps.render1.outcome == 'failure' && steps.render2.outcome == 'failure'
        env:
          APP: ${{ matrix.app }}
          REF: ${{ inputs.ref || github.ref_name }}
          APP_TOKEN: ${{ steps.app-token.outputs.token }}
          SERVER_URL: ${{ github.server_url }}
          REPO: ${{ github.repository }}
        run: |
          set -euo pipefail
          ( cd "apps/$APP" && npx --no-install --ignore-scripts cypress-image-diff -u )
          git config user.name 'sva-actions-upmerge[bot]'
          git config user.email '278916743+sva-actions-upmerge[bot]@users.noreply.github.com'
          git remote set-url origin "https://x-access-token:${APP_TOKEN}@${SERVER_URL#https://}/${REPO}.git"
          # ... rest unchanged (add, commit, pull --rebase / push loop, outputs) ...
```

#### 2. Storybook identity
**File**: `cplace-fe: .github/workflows/deploy_storybook.yaml`
**Changes**: replace the `:42-43` identity with
`git config user.name 'github-actions[bot]'` and
`git config user.email '41898282+github-actions[bot]@users.noreply.github.com'`.

#### 3. Copy into the clone and force a drift
**File**: `clone-cplace-fe: .github/workflows/heal-visual-baselines.yml` (new, on `main`), plus one baseline PNG
**Changes**:
- **H0, commit 1 on clone `main`:** copy the cplace-fe `FB` heal workflow byte for byte. Its push only runs the
  gate, which reports "not an upmerge commit".
- **H0, commit 2 on clone `main`:** corrupt one baseline by copying another baseline over it:
  `cp apps/helles-ui-visual-e2e/visual-regression/baseline/accordion.cy.ts-types.png apps/helles-ui-visual-e2e/visual-regression/baseline/accordion.cy.ts-states.png`.
  - Subject: `33676 H0: force visual drift for the heal test`.
  - Its push starts only the gate and the main CI. The gate skips it as not an upmerge commit.

#### 4. Temporary App access and ruleset for the clone (stop: confirm each org-level change)
**File**: GitHub org settings
**Changes**:
- **H1a:** add the clone to the App installation:
  `gh api -X PUT user/installations/126667289/repositories/1430984878`.
- **H1b:** add the clone to both org secrets' selected repos:
  `gh api -X PUT orgs/collaborationFactory/actions/secrets/SVA_ACTIONS_UPMERGE_ID/repositories/1430984878`, and the
  same for `SVA_ACTIONS_UPMERGE_KEY`.
- **H1c:** create a repo ruleset `33676-heal-test` on the clone. It targets `~DEFAULT_BRANCH`, with rules
  `pull_request` (1 approval), `non_fast_forward` and `deletion`. The only bypass actor is
  `{"actor_id":3487076,"actor_type":"Integration","bypass_mode":"always"}`. Create it with
  `gh api -X POST repos/$R/rulesets --input <json>` and record its id.
- **H1d negative control:** pushing an empty commit to clone `main` with the user's own credentials is
  **rejected** by the ruleset. Afterwards, reset the local branch.

#### 5. Heal run and cleanup
- **H2:** `gh workflow run heal-visual-baselines.yml -R $R --ref main -f app=helles-ui-visual-e2e -f ref=main`.
  Expected results:
  - The gate decides `workflow_dispatch override`.
  - render1 and render2 fail.
  - "Get sva-actions-upmerge token" succeeds.
  - The heal pushes `chore: heal visual baselines for helles-ui-visual-e2e [skip visual-heal]` to `main`.
  - The "Announce heal" Slack step is best-effort. With the dummy token it fails under `continue-on-error`.
- **H3:** the push run that the heal commit triggers decides `loop-break: heal marker present`, and no `heal` job
  runs.
- **H4 cleanup** (confirm with the user):
  - Delete the ruleset.
  - Remove the clone from the installation:
    `gh api -X DELETE user/installations/126667289/repositories/1430984878`.
  - Remove the clone from both secrets' selected repos (`-X DELETE …/repositories/1430984878`).
  - The heal workflow stays in the clone.
- Log H0–H4 in `live-test-log.md`.

#### 6. Open the cplace-fe PR (stop: push)
- Commit on cplace-fe `FB` with the title `PFM-ISSUE-33676 - Push visual-baseline heals with the sva-actions-upmerge
  App and drop the squad-fe storybook identity`.
- The body links the clone run IDs (H2, H3), says `main` only (release lines unchanged, 34281 decision), and names
  the dependency on the `product-fe` bypass entry and the org secrets.

### Success Criteria:

#### Automated Verification:
- [ ] cplace-fe heal gate tests still pass: `node --test .github/scripts/` in `CFE` on `FB`
- [ ] actionlint is clean: `~/go/bin/actionlint .github/workflows/heal-visual-baselines.yml .github/workflows/deploy_storybook.yaml` in `CFE`
- [ ] No shared-account reference is left in either cplace-fe file. This prints nothing:
  `git -C $CFE grep -nE "GIT_USER|squad-fe" $FB -- .github/workflows/heal-visual-baselines.yml .github/workflows/deploy_storybook.yaml`
- [ ] The clone copy is identical:
  `git -C $CFE show $FB:.github/workflows/heal-visual-baselines.yml | diff - <(git -C $CL show origin/main:.github/workflows/heal-visual-baselines.yml)`
- [ ] The H2 run succeeded, and its heal commit on clone `main` is authored by the App bot:
  `git -C $CL log -1 --format='%an <%ae> %s' origin/main` shows `sva-actions-upmerge[bot] <278916743+sva-actions-upmerge[bot]@users.noreply.github.com>` and `[skip visual-heal]`
- [ ] H3's gate output contains `loop-break: heal marker present`: `gh run view <H3 id> -R $R --log | grep "reason=loop-break"`
- [ ] H1d was rejected: the recorded push output contains `GH013` / "repository rule violations"
- [ ] H4 restored the access:
  `gh api --paginate user/installations/126667289/repositories --jq '.repositories[].name' | grep -x clone-cplace-fe` prints nothing,
  `gh api repos/$R/rulesets --jq length` prints `0`, and
  `gh api orgs/collaborationFactory/actions/secrets/SVA_ACTIONS_UPMERGE_ID/repositories --jq '.repositories[].name' | grep -x clone-cplace-fe` prints nothing
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 3 complete. Summary: heal
  workflow now pushes with a just-in-time sva-actions-upmerge token and storybook commits as github-actions[bot];
  in clone-cplace-fe a forced drift was healed through a ruleset that only the App can bypass, the loop-break
  skipped the heal commit, temporary App/secret/ruleset access was removed, and the cplace-fe PR is open. Please
  review and reply 'yes' to continue to Phase 4." Do NOT proceed until the user explicitly approves. This checkpoint
  cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] The healed baseline commit in the clone changes only `apps/helles-ui-visual-e2e/visual-regression/baseline/`.
- [ ] After the cplace-fe PR merges, the next scheduled storybook run on cplace-fe makes its `gh-pages` merge commit
  as `github-actions[bot]`: `git log -1 --format='%an <%ae>' origin/gh-pages`.

---

## Phase 4: AC1 usage mapping and 15-repo audit

### Overview
Produce the AC1 deliverable: every use of the shared account across this repo and the 15 FE repos, each with its
replacement and owner. It goes into the spec as an addendum to `research.md`. The research frontmatter is not
changed.

### Changes Required:

#### 1. Audit the 15 repos (read-only)
**File**: scratchpad clones (not committed)
**Changes**:
- Shallow-clone the default branch of each of the 15 repos (see Key Discoveries) into the scratchpad:
  `gh repo clone collaborationFactory/<r> <scratch>/<r> -- --depth 1`.
- In each, run:
  `git grep -nE 'GIT_USER(_TOKEN|_EMAIL)?\b|squad-fe|repository:|git clone|gh repo clone|create-github-app-token' -- .github`
- Also list which repos pass `GIT_USER*` to `fe-check-upmerge.yml` or call `fe-tag.yml` / `workflows/fe-release.yml`.
- Expected, from the design: the only cross-repo checkout is cplace-fe's devkit e2e (already on
  `sva-actions-read-product-fe`). Explicit `GIT_USER*` upmerge passes are in cplace-fe, cplace-paw-fe,
  cplace-office-reports-fe and cplace-workflow-fe.
- If the audit finds a shared-account use the design does not cover, STOP and report it to the user.

#### 2. Mapping addendum
**File**: `specs/2026-11-26_PFM-ISSUE-33676_replace-shared-github-user/research.md`
**Changes**: append the section `## Addendum (2026-11-xx): Final usage → replacement mapping (AC1)`. It contains:
- A table extending U1–U9 with the final status:
  - U5 and U6: done here, `github-actions[bot]`.
  - U7: verified by L3.
  - U8: done by 34281.
  - U9: README updated.
- New rows:
  - U10: cplace-fe heal push → `sva-actions-upmerge`.
  - U11: cplace-fe storybook identity → `github-actions[bot]`.
  - U12: heal-gate `BOT_EMAIL` → dropped.
  - U13: `fe-tag.yml` callers, per repo → migration/cleanup ticket.
  - U14: explicit `GIT_USER*` upmerge passes, per repo → migration/cleanup ticket.
  - U15: cplace-fe `squad-fe` pusher guard → migration/cleanup ticket.
  - U16: the optional `GIT_USER*` declarations → migration/cleanup ticket.
  - Any further hits from the audit.
- A per-repo audit table for the 15 repos: one row per repo, with hits by category, or "none".
- A note on the design's email typo (`41898828` → `41898282`).
- A pointer to `live-test-log.md` for the AC2/AC3 evidence.

### Success Criteria:

#### Automated Verification:
- [ ] The addendum exists: `grep -n "Final usage → replacement mapping" specs/2026-11-26_PFM-ISSUE-33676_replace-shared-github-user/research.md`
- [ ] All 15 repos appear in the audit table:
  `for r in cplace-e2e cplace-2lforge-toolbar-fe cplace-2lforge-trees-fe cplace-citizen-ai-fe cplace-dataciders-portfolio-management-fe cplace-fe cplace-loomeo-fe cplace-lowcode-widget-builder-fe cplace-office-reports-fe cplace-paw-fe cplace-project-planning-fe cplace-remote-filesystem-fe cplace-resource-management-fe cplace-time-bounded-values-fe cplace-workflow-fe; do grep -q "| $r " specs/2026-11-26_PFM-ISSUE-33676_replace-shared-github-user/research.md || echo "missing $r"; done` prints nothing
- [ ] The research frontmatter is unchanged: `git diff HEAD -- specs/2026-11-26_PFM-ISSUE-33676_replace-shared-github-user/research.md | grep -E "^[-+](git_commit|date):"` prints nothing
- [ ] **HUMAN CHECKPOINT**: Call `AskUserQuestion` now with the question: "Phase 4 complete. Summary: 15-repo audit
  done and the final AC1 usage mapping (U1–U16+) added to research.md with owners. Please review and reply 'yes' to
  finish." Do NOT proceed until the user explicitly approves. This checkpoint cannot be skipped or pre-checked.

#### Manual Verification:
- [ ] Every mapping row has a replacement and an owner (this ticket, 34281, 35504 or migration/cleanup).
- [ ] The migration/cleanup ticket's scope can be copied from the "owner = migration/cleanup" rows.

---

## Testing Strategy

### Unit Tests:
- `upmerge.test.ts`: the new test asserts `checkUpmergeAndNotifiy()` runs no `user.name`/`user.email` git config.
  The existing three tests still pass.
- cplace-fe `heal-gate.test.mjs`: unchanged, and still green. The `BOT_EMAIL`-empty path is already the effective
  production path.

### Integration Tests:
- Clone runs L0–L4: release, upmerge check, PR snapshot comment and main CI, all with `GIT_USER*` deleted.
- Clone runs H2–H3: a real App-token push through an App-only bypass ruleset, plus the loop-break.

### Manual Testing Steps:
1. Read the L1 "Configure git user" and L2 "Configure git identity" step logs. The values are fixed, and no
   secret is masked.
2. Check the H1d rejection message. It proves that the ruleset, not missing permissions, is what the App bypassed.
3. After the cplace-fe merge, check the next storybook `gh-pages` commit author.

## Performance Considerations

None. One extra trivial step per workflow. The heal mints its token only on actual drift.

## Migration Notes

- **Consumers need no change.** Explicit `GIT_USER*` passes still validate against the optional declarations.
  Repos using `secrets: inherit` can delete `GIT_USER`/`GIT_USER_EMAIL` at any time. They keep `GIT_USER_TOKEN`
  while any branch calls `fe-tag.yml` or `workflows/fe-release.yml`.
- **Rollback:** revert the github-actions PR. The declarations return to `required: true`. Repos that already deleted
  the secrets then fail, so do not delete secrets in production repos until the cleanup ticket.
- **clone-cplace-fe state:** the clone keeps pointing at `TEST_BRANCH` after the tests. That is acceptable for the
  test fork, and there is no teardown. Before `TEST_BRANCH` is deleted (ask the user), repoint the clone's
  `cron_check_upmerge.yaml` and `fe-release.yml` to `@master` once the github-actions PR is merged.
- **cplace-fe heal dependency:** the heal depends on `sva-actions-upmerge` staying installed on cplace-fe, on the
  `product-fe` bypass entry, and on the visibility of `SVA_ACTIONS_UPMERGE_*` to cplace-fe. All of these are owned by
  the backend team. The workflow comment names this dependency.

## References

- Research: [Research Document](./research.md)
- Design: [Design Document](./design.md)
- Original ticket: [PFM-ISSUE-33676](https://base.cplace.io/pages/w64364g0a1qsl6z6vb11ngevs/PFM-ISSUE-33676-Replace-shared-GitHub-user-account-in-frontend-workflows)
- Live-test protocol to follow: `specs/2026-10-26_PFM-ISSUE-34282_github-token-scoped-permissions/live-test-plan.md`
  (§2.3 test branch, R2/R6 release expectations) and
  `specs/2026-10-12_PFM-ISSUE-34283_consolidate-fe-release-workflow/clone-cplace-fe-live-tests.md`
- App-token pattern: cplace-fe `.github/workflows/devkit-test-template.yaml:89-108`. Backend:
  `cplace-gh-workflows` `.github/actions/prepare-git-environment/action.yml:37-44`
- Identity step being replaced: `.github/workflows/fe-release-flow.yml:140-146`
