# Backend Frontend Package Automation - Design Approach

## Overview

Automate the process of installing/updating frontend NPM packages in backend repositories after they are published to JFrog NPM Registry. This eliminates manual coordination between frontend and backend teams and ensures backend repositories stay in sync with published frontend packages.

## Problem Statement

Currently, when frontend packages are published to JFrog NPM Registry (via `fe-snapshot.yml` or `fe-release.yml` workflows), backend repositories must manually update their `**/assets/package.json` files to consume the new versions. This manual process:

- Creates delays between frontend publishing and backend integration
- Requires coordination between frontend and backend teams
- Is error-prone (forgetting to update dependencies)
- Lacks visibility into what needs updating

### Requirements

1. **Automated Triggering**: Backend package updates triggered automatically after successful frontend publishing
2. **Branch Awareness**: Updates must happen on the same branch as the frontend workflow (e.g., `release/25.4`)
3. **Dist Tag Resolution**: Use appropriate NPM dist tags based on branch:
   - `main`/`master` branches → `snapshot` dist tag
   - `release/*` branches → `release-{major}.{minor}` dist tag (e.g., `release-25.4`)
4. **Multi-Plugin Support**: Scan and update all `**/assets/package.json` files in backend repository
5. **Scope Filtering**: Only update packages from relevant NPM scopes (e.g., `@cplace-next`, `@cplace-paw`)
6. **Single Consolidated PR**: Create one PR per backend repo with all package updates
7. **Proper Assignment**: Assign PR to the person who triggered the frontend workflow, or create without assignee if they lack access
8. **Reusable Workflow**: Provide a workflow in this repository that backend repos can include

### Constraints

- Multiple `**/assets` folders may exist in backend repos (one per plugin)
- Must work with JFrog Artifactory NPM registry
- Must respect existing authentication mechanisms
- Backend repos may have different directory structures
- Must handle permission errors gracefully
- Should provide clear visibility into what was updated and what failed

## Design Dimensions & Decisions

### 1. Cross-Repository Communication Pattern

**Chosen Approach:** `repository_dispatch` with Organization PAT

**Rationale:**
GitHub's `repository_dispatch` event is the standard mechanism for cross-repository workflow triggering. Using an organization-level PAT eliminates the need to configure tokens in each frontend repository individually.

**Alternatives Considered:**

- **GitHub App with Installation Token**: Rejected because it requires creating and maintaining a GitHub App, adding unnecessary complexity for this straightforward use case
- **External Webhook Service**: Rejected because it requires external infrastructure and still needs PAT/GitHub App, adding deployment and maintenance overhead
- **Manual `workflow_dispatch` Trigger**: Rejected because it defeats the purpose of automation and reintroduces manual coordination
- **Scheduled Polling**: Rejected because it introduces delays (up to polling interval) and runs unnecessarily when no updates are available

**Implications:**

- Requires creating an organization-level PAT (one-time setup)
- PAT must have `repo` scope for triggering workflows
- PAT should be stored as organization secret (e.g., `CROSS_REPO_PAT`)
- Token maintenance required (expiration monitoring, rotation)
- Frontend workflows need to accept `BACKEND_REPO` input parameter
- Dispatch payload will contain: `branch` (branch name) and `actor` (triggering user)

---

### 2. Package Discovery & Update Strategy

**Chosen Approach:** Glob Pattern Search + Centralized Update Script (TypeScript)

**Rationale:**
A centralized TypeScript script provides the best balance of robustness, maintainability, and user experience. It allows consistent version updates across all assets folders, generates detailed change summaries for PR descriptions, and follows existing codebase patterns (similar to `tools/scripts/artifacts/`).

**Alternatives Considered:**

- **Glob Pattern + In-Place Shell Updates**: Rejected because it would run npm update multiple times (once per folder), potentially leading to inconsistent versions and making it difficult to generate a summary of changes
- **NX-Style Affected Project Detection**: Rejected because backend repos may not use NX, and this would require backend-specific configuration
- **GitHub Action Marketplace Solution**: Rejected because existing actions don't support the `**/assets/package.json` pattern, scope filtering, or JFrog registry authentication

**Implications:**

- TypeScript script location: `tools/scripts/backend-package-updater/`
- Script will use glob patterns to find all `**/assets/package.json` files
- Script queries npm registry for latest versions matching dist tags
- Script updates all package.json files in a single pass
- Script runs `npm install` in each assets directory (using `cwd: assetsDir`)
- Script generates detailed change summary for PR description
- Follows existing patterns from `tools/scripts/artifacts/` structure
- Requires Node.js dependencies: glob, fast-glob or similar

---

### 3. NPM Dist Tag Resolution

**Chosen Approach:** Simple Branch Name Mapping

**Rationale:**
Simple, explicit branch-to-tag mapping is sufficient for the known branch patterns and makes behavior predictable and easy to debug. The fail-fast approach with clear error messages helps catch unsupported branch patterns early.

**Alternatives Considered:**

- **Configurable Branch-to-Tag Mapping**: Rejected because it adds unnecessary complexity for handling only two branch patterns, and configuration overhead outweighs benefits
- **Query Registry for Available Tags**: Rejected because extra API calls slow down execution and are unnecessary if we trust that frontend publishing succeeded
- **Smart Fallback with Validation**: Rejected because silent fallbacks could hide configuration issues, making debugging harder

**Mapping Logic:**

```typescript
function getDistTag(branchName: string): string {
  if (branchName === 'main' || branchName === 'master') {
    return 'snapshot';
  }

  if (branchName.startsWith('release/')) {
    // Extract version: release/25.4 → release-25.4
    const version = branchName.replace('release/', 'release-');
    return version;
  }

  throw new Error(
    `Unsupported branch pattern: ${branchName}. Supported: main, master, release/*`
  );
}
```

**Implications:**

- Only `main`, `master`, and `release/*` branches are supported
- Workflow will fail fast with clear error for unexpected branch names
- No configuration needed per repository
- Easy to extend in the future if new branch patterns emerge
- Examples:
  - `main` → `@cplace-next/cf-shell@snapshot`
  - `master` → `@cplace-next/cf-shell@snapshot`
  - `release/25.4` → `@cplace-next/cf-shell@release-25.4`

---

### 4. PR Creation & Assignment Strategy

**Chosen Approach:** GitHub CLI (`gh`) with Try-Catch Assignment

**Rationale:**
Using `gh pr create` with built-in fallback via `||` operator provides the simplest implementation while ensuring PRs are always created. If assignment fails due to permissions, the command automatically retries without the assignee parameter.

**Alternatives Considered:**

- **Pre-Check for Collaborator Access**: Rejected because it requires an extra API call and adds complexity without significant benefit
- **GitHub API via TypeScript (Octokit)**: Rejected because bash with GitHub CLI is simpler and sufficient for this use case, avoiding additional dependencies
- **Fallback with @mention Comment**: Rejected because mentions may not notify users without repository access, and it adds an extra API call

**Implementation:**

```bash
gh pr create \
  --title "chore: Update frontend packages from $BRANCH" \
  --body "$PR_BODY" \
  --head "$UPDATE_BRANCH" \
  --base "$BRANCH" \
  --assignee "$ACTOR" || \
gh pr create \
  --title "chore: Update frontend packages from $BRANCH" \
  --body "$PR_BODY" \
  --head "$UPDATE_BRANCH" \
  --base "$BRANCH"
```

**Implications:**

- Command may run twice if assignment fails (once with assignee, once without)
- Failed assignment attempt will appear in logs (acceptable noise)
- PR always gets created successfully
- Uses `GITHUB_TOKEN` for PR creation (has write access in target repo)
- Title format: `chore: Update frontend packages from {branch}`
- PR body will contain detailed summary from TypeScript script

---

### 5. Scope Filtering Mechanism

**Chosen Approach:** Auto-Detect from package.json

**Rationale:**
Automatic scope detection from existing dependencies eliminates configuration overhead while naturally limiting updates to only packages already in use. This is the most maintainable approach as it automatically adapts to the backend repository's actual dependencies.

**Alternatives Considered:**

- **Workflow Input Parameter (Array)**: Rejected because it requires configuration in each backend repo and isn't available from `repository_dispatch` events
- **Config File in Backend Repository**: Rejected because it requires creating and maintaining a config file in each backend repo, adding setup overhead
- **Hardcoded in Workflow**: Rejected because different backend repos may use different scopes, and changes would require workflow updates
- **Hybrid Config + Auto-Detect**: Rejected because two code paths add unnecessary complexity for marginal benefit

**Algorithm:**

```typescript
// 1. Find all **/assets/package.json files
const packageJsonPaths = glob.sync('**/assets/package.json');

// 2. Extract unique scopes from existing dependencies
const existingScopes = new Set<string>();
for (const pkgPath of packageJsonPaths) {
  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

  for (const dep of Object.keys(deps)) {
    if (dep.startsWith('@')) {
      const scope = dep.split('/')[0]; // @cplace-next/pkg → @cplace-next
      existingScopes.add(scope);
    }
  }
}

// 3. Update packages from detected scopes
for (const pkgPath of packageJsonPaths) {
  const assetsDir = path.dirname(pkgPath);

  for (const scope of existingScopes) {
    execSync(
      `npm install ${scope}/*@${distTag}`,
      { cwd: assetsDir } // Run in **/assets folder
    );
  }
}
```

**Implications:**

- Zero configuration required in backend repositories
- Only updates packages from scopes already present in package.json
- New scopes require manual first addition (one-time)
- Cannot accidentally update unexpected scopes
- Works naturally with multi-tenant backend repos (different plugins may use different scopes)
- npm commands execute in each `**/assets` directory where package.json lives

---

### 6. Error Handling & Resilience

**Chosen Approach:** Continue on Error with Summary Report

**Rationale:**
Continuing through errors while collecting results provides the best resilience. If one plugin's assets folder has an issue, other plugins can still receive updates. The detailed summary in the PR description provides clear visibility into what succeeded and what failed.

**Alternatives Considered:**

- **Fail Fast - Stop on First Error**: Rejected because one problematic assets folder would block updates to all other folders, reducing overall system reliability
- **Transaction-Style with Rollback**: Rejected because rollback complexity (git operations) is overkill, and partial updates are acceptable given clear reporting
- **Fail Fast with Detailed Error Context**: Rejected because it still blocks all updates on first failure, though error messaging improvement is valuable and will be incorporated

**Implementation:**

```typescript
const results: UpdateResult[] = [];

for (const assetsDir of assetsDirs) {
  try {
    const updates = await updatePackages(assetsDir, scopes, distTag);
    results.push({
      path: assetsDir,
      success: true,
      updates, // array of {package, oldVersion, newVersion}
    });
  } catch (error) {
    results.push({
      path: assetsDir,
      success: false,
      error: error.message,
    });
  }
}

// Report results
const successful = results.filter((r) => r.success);
const failed = results.filter((r) => !r.success);

// Only fail workflow if ALL updates failed
if (failed.length > 0 && successful.length === 0) {
  throw new Error('All package updates failed');
}

// Generate PR description with detailed summary
return generatePRDescription(results, branch, distTag, actor);
```

**Implications:**

- PRs may contain partial updates (some folders updated, some not)
- Workflow succeeds if at least one folder updates successfully
- Workflow fails only if all folders fail to update
- PR description clearly shows success/failure for each assets folder
- Failed folders require manual investigation and remediation
- Successful folders get updates immediately without waiting for fixes

**PR Description Format:**

```markdown
## Frontend Package Updates

**Branch:** release/25.4
**Dist Tag:** release-25.4
**Triggered by:** @username

### ✅ Successfully Updated (8/10)

#### plugins/plugin-a/assets

- @cplace-next/cf-shell: 25.3.0 → 25.4.0
- @cplace-next/platform: 25.3.1 → 25.4.1

#### plugins/plugin-b/assets

- @cplace-paw/components: 1.2.3 → 1.3.0

### ❌ Failed to Update (2/10)

#### plugins/plugin-x/assets

**Error:** Package @cplace-next/missing@release-25.4 not found in registry

#### plugins/plugin-y/assets

**Error:** Invalid package.json format: Unexpected token in JSON

---

**Auto-detected scopes:** @cplace-next, @cplace-paw
```

---

## Overall Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend Repository (cplace-fe, cplace-paw-fe)                 │
│                                                                   │
│  1. Developer pushes to main/master or release/* branch         │
│  2. fe-snapshot.yml or fe-release.yml workflow triggered        │
│  3. Workflow builds and publishes packages to JFrog NPM         │
│  4. On success: repository_dispatch to backend repo             │
│     Payload: { branch: "release/25.4", actor: "john" }          │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ repository_dispatch event
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend Repository (main, cplace-paw)                          │
│                                                                   │
│  1. Receives repository_dispatch event                          │
│  2. Calls reusable workflow from github-actions repo:           │
│     collaborationFactory/github-actions/                        │
│       .github/workflows/be-package-update.yml@master            │
│  3. Workflow extracts: branch, actor from event payload         │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ workflow_call
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  github-actions Repository                                       │
│  .github/workflows/be-package-update.yml                        │
│                                                                   │
│  1. Checkout backend repo on specified branch                   │
│  2. Setup Node.js environment                                   │
│  3. Configure JFrog NPM registry authentication                 │
│  4. Execute TypeScript update script                            │
│  5. Commit changes to new branch                                │
│  6. Create PR with changes                                      │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ execute script
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  tools/scripts/backend-package-updater/main.ts                  │
│                                                                   │
│  1. Scan: Find all **/assets/package.json files                │
│  2. Detect: Extract NPM scopes from dependencies                │
│  3. Resolve: Determine dist tag from branch name               │
│  4. Update: Install packages with correct dist tag             │
│     - For each assets folder:                                   │
│       cd {assets-dir}                                           │
│       npm install @scope/*@{distTag}                            │
│  5. Collect: Gather results (successes and failures)           │
│  6. Report: Generate PR description with summary               │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ return results
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  PR Created in Backend Repository                               │
│                                                                   │
│  Title: "chore: Update frontend packages from release/25.4"    │
│  Assignee: @john (or none if no permission)                     │
│  Body: Detailed summary with all changes and errors            │
│  Files: Multiple **/assets/package.json + package-lock.json    │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Modified Frontend Workflows

**File:** `.github/workflows/fe-snapshot.yml`

**Changes:**

- Add input parameter `BACKEND_REPO` (optional, string)
- Add new job/step after successful publishing:
  ```yaml
  - name: Trigger Backend Package Update
    if: inputs.BACKEND_REPO != ''
    uses: peter-evans/repository-dispatch@v3
    with:
      token: ${{ secrets.CROSS_REPO_PAT }}
      repository: collaborationFactory/${{ inputs.BACKEND_REPO }}
      event-type: frontend-packages-published
      client-payload: |
        {
          "branch": "${{ github.ref_name }}",
          "actor": "${{ github.actor }}"
        }
  ```

**File:** `.github/workflows/fe-release.yml`

**Changes:** Same as `fe-snapshot.yml` above

#### 2. New Backend Update Workflow

**File:** `.github/workflows/be-package-update.yml` (new)

**Purpose:** Reusable workflow that backend repositories call to update frontend packages

**Triggers:**

- `workflow_call`: Called by other workflows
- `repository_dispatch`: Triggered by frontend workflows

**Structure:**

```yaml
name: Backend Package Update

on:
  repository_dispatch:
    types: [frontend-packages-published]
  workflow_call:
    inputs:
      branch:
        type: string
        required: true
      actor:
        type: string
        required: true

jobs:
  update-packages:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.client_payload.branch || inputs.branch }}
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 22.15.0

      - name: Configure NPM Registry
        # Setup .npmrc with JFrog credentials

      - name: Update Frontend Packages
        uses: ./.github/actions/backend-package-updater
        # Or directly call TypeScript script

      - name: Commit Changes
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git checkout -b "chore/update-frontend-packages-${{ github.run_id }}"
          git add .
          git commit -m "chore: Update frontend packages"
          git push origin HEAD

      - name: Create Pull Request
        env:
          ACTOR: ${{ github.event.client_payload.actor || inputs.actor }}
          BRANCH: ${{ github.event.client_payload.branch || inputs.branch }}
        run: |
          gh pr create \
            --title "chore: Update frontend packages from $BRANCH" \
            --body-file pr-description.md \
            --head "chore/update-frontend-packages-${{ github.run_id }}" \
            --base "$BRANCH" \
            --assignee "$ACTOR" || \
          gh pr create \
            --title "chore: Update frontend packages from $BRANCH" \
            --body-file pr-description.md \
            --head "chore/update-frontend-packages-${{ github.run_id }}" \
            --base "$BRANCH"
```

#### 3. TypeScript Update Script

**Directory Structure:**

```
tools/scripts/backend-package-updater/
├── main.ts              # Entry point
├── updater.ts           # Core update logic
├── utils.ts             # Utility functions
└── types.ts             # TypeScript type definitions
```

**File:** `tools/scripts/backend-package-updater/main.ts`

```typescript
import { updateBackendPackages } from './updater';

async function main() {
  try {
    const branch = process.env.BRANCH || '';
    const actor = process.env.ACTOR || '';

    const result = await updateBackendPackages(branch);

    // Write PR description to file
    fs.writeFileSync('pr-description.md', result.prDescription);

    // Exit with appropriate code
    if (result.allFailed) {
      console.error('All package updates failed');
      process.exit(1);
    }

    console.log('Package updates completed');
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
```

**File:** `tools/scripts/backend-package-updater/updater.ts`

```typescript
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';

interface UpdateResult {
  path: string;
  success: boolean;
  updates?: PackageUpdate[];
  error?: string;
}

interface PackageUpdate {
  package: string;
  oldVersion: string;
  newVersion: string;
}

export async function updateBackendPackages(branch: string) {
  // 1. Find all **/assets/package.json files
  const packageJsonPaths = glob.sync('**/assets/package.json');

  // 2. Auto-detect NPM scopes
  const scopes = detectScopes(packageJsonPaths);

  // 3. Determine dist tag
  const distTag = getDistTag(branch);

  // 4. Update packages in each assets folder
  const results: UpdateResult[] = [];

  for (const pkgPath of packageJsonPaths) {
    const assetsDir = path.dirname(pkgPath);

    try {
      const updates = updatePackagesInFolder(assetsDir, scopes, distTag);
      results.push({ path: assetsDir, success: true, updates });
    } catch (error) {
      results.push({
        path: assetsDir,
        success: false,
        error: error.message,
      });
    }
  }

  // 5. Generate PR description
  const prDescription = generatePRDescription(results, branch, distTag, scopes);

  // 6. Determine if all failed
  const allFailed = results.every((r) => !r.success);

  return { results, prDescription, allFailed };
}

function detectScopes(packageJsonPaths: string[]): Set<string> {
  const scopes = new Set<string>();

  for (const pkgPath of packageJsonPaths) {
    const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

    for (const dep of Object.keys(deps)) {
      if (dep.startsWith('@')) {
        const scope = dep.split('/')[0];
        scopes.add(scope);
      }
    }
  }

  return scopes;
}

function getDistTag(branchName: string): string {
  if (branchName === 'main' || branchName === 'master') {
    return 'snapshot';
  }

  if (branchName.startsWith('release/')) {
    return branchName.replace('release/', 'release-');
  }

  throw new Error(`Unsupported branch pattern: ${branchName}`);
}

function updatePackagesInFolder(
  assetsDir: string,
  scopes: Set<string>,
  distTag: string
): PackageUpdate[] {
  const updates: PackageUpdate[] = [];

  // Read current versions
  const pkgJsonPath = path.join(assetsDir, 'package.json');
  const pkgJsonBefore = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

  // Update packages from each scope
  for (const scope of scopes) {
    execSync(`npm install ${scope}/*@${distTag}`, {
      cwd: assetsDir,
      stdio: 'inherit',
    });
  }

  // Read updated versions
  const pkgJsonAfter = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

  // Compare and collect changes
  const depsBefore = {
    ...pkgJsonBefore.dependencies,
    ...pkgJsonBefore.devDependencies,
  };
  const depsAfter = {
    ...pkgJsonAfter.dependencies,
    ...pkgJsonAfter.devDependencies,
  };

  for (const [pkg, newVersion] of Object.entries(depsAfter)) {
    const oldVersion = depsBefore[pkg];
    if (oldVersion && oldVersion !== newVersion) {
      updates.push({ package: pkg, oldVersion, newVersion });
    }
  }

  return updates;
}

function generatePRDescription(
  results: UpdateResult[],
  branch: string,
  distTag: string,
  scopes: Set<string>
): string {
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  let description = `## Frontend Package Updates\n\n`;
  description += `**Branch:** ${branch}\n`;
  description += `**Dist Tag:** ${distTag}\n`;
  description += `**Auto-detected scopes:** ${Array.from(scopes).join(
    ', '
  )}\n\n`;

  if (successful.length > 0) {
    description += `### ✅ Successfully Updated (${successful.length}/${results.length})\n\n`;
    for (const result of successful) {
      description += `#### ${result.path}\n`;
      if (result.updates && result.updates.length > 0) {
        for (const update of result.updates) {
          description += `- ${update.package}: ${update.oldVersion} → ${update.newVersion}\n`;
        }
      } else {
        description += `- No changes (already up to date)\n`;
      }
      description += `\n`;
    }
  }

  if (failed.length > 0) {
    description += `### ❌ Failed to Update (${failed.length}/${results.length})\n\n`;
    for (const result of failed) {
      description += `#### ${result.path}\n`;
      description += `**Error:** ${result.error}\n\n`;
    }
  }

  return description;
}
```

#### 4. Composite Action (Optional)

**File:** `.github/actions/backend-package-updater/action.yml` (optional wrapper)

```yaml
name: 'Backend Package Updater'
description: 'Updates frontend packages in backend repository assets folders'

runs:
  using: 'composite'
  steps:
    - run: cd "$GITHUB_ACTION_PATH/../../.." && npm ci
      shell: bash
    - run: npx ts-node "$GITHUB_ACTION_PATH/../../../tools/scripts/backend-package-updater/main.ts"
      shell: bash
```

### Integration Points

#### Frontend Repository Setup

Frontend repositories (e.g., `cplace-fe`, `cplace-paw-fe`) need to:

1. Add `BACKEND_REPO` input to their workflow templates:

```yaml
# .github/workflows/main-branch.yml (or similar)
jobs:
  snapshot:
    needs: build
    uses: collaborationFactory/github-actions/.github/workflows/fe-snapshot.yml@master
    with:
      GHA_REF: ${{ github.ref }}
      GHA_BASE: main
      BACKEND_REPO: main # ← Add this
    secrets:
      JFROG_BASE64_TOKEN: ${{ secrets.JFROG_BASE64_TOKEN }}
      JFROG_URL: ${{ secrets.JFROG_URL }}
      JFROG_USER: ${{ secrets.JFROG_USER }}
```

2. Ensure organization secret `CROSS_REPO_PAT` exists and is accessible

#### Backend Repository Setup

Backend repositories (e.g., `main`, `cplace-paw`) need to:

1. Add workflow file to listen for dispatch events:

```yaml
# .github/workflows/frontend-package-update.yml
name: Frontend Package Update

on:
  repository_dispatch:
    types: [frontend-packages-published]

jobs:
  update:
    uses: collaborationFactory/github-actions/.github/workflows/be-package-update.yml@master
    with:
      branch: ${{ github.event.client_payload.branch }}
      actor: ${{ github.event.client_payload.actor }}
    secrets:
      JFROG_BASE64_TOKEN: ${{ secrets.JFROG_BASE64_TOKEN }}
      JFROG_URL: ${{ secrets.JFROG_URL }}
      JFROG_USER: ${{ secrets.JFROG_USER }}
```

2. Ensure JFrog secrets are configured
3. No additional configuration needed (scopes auto-detected)

### Data Flow

```
Frontend Developer
  ↓ (git push to release/25.4)

Frontend Repo Workflow (fe-release.yml)
  ↓ (build & publish packages)
  ↓ (success)
  ↓ (repository_dispatch)

Backend Repo Workflow (listens for dispatch)
  ↓ (calls be-package-update.yml@master)

github-actions Repo (be-package-update.yml)
  ↓ (checkout backend repo at release/25.4)
  ↓ (setup Node.js)
  ↓ (configure JFrog credentials)
  ↓ (execute TypeScript script)

TypeScript Script (backend-package-updater)
  ↓ (scan **/assets/package.json)
  ↓ (detect scopes: @cplace-next, @cplace-paw)
  ↓ (resolve dist tag: release-25.4)
  ↓ (for each assets folder:)
  ↓   (cd {assets-dir})
  ↓   (npm install @cplace-next/*@release-25.4)
  ↓   (npm install @cplace-paw/*@release-25.4)
  ↓ (collect results)
  ↓ (generate PR description)

Backend Repo Workflow
  ↓ (commit changes to new branch)
  ↓ (create PR with summary)
  ↓ (attempt to assign to triggering developer)

Pull Request Created
  ↓ (ready for review)
```

## Trade-offs & Risks

### Accepted Trade-offs

1. **Partial Updates Allowed**

   - **What we're accepting:** PRs may contain updates for only some plugins if others fail
   - **To gain:** Higher resilience - one problematic folder doesn't block all updates
   - **Mitigation:** Clear reporting in PR description shows exactly what failed and why

2. **PAT Token Maintenance**

   - **What we're accepting:** Need to maintain organization-level PAT with expiration monitoring
   - **To gain:** Automated cross-repository triggering without complex GitHub App setup
   - **Mitigation:** Use organization secret (not per-repo), set long expiration (1 year), monitor expiration

3. **Auto-Detected Scopes Only**

   - **What we're accepting:** Can only update scopes already present in package.json files
   - **To gain:** Zero configuration overhead across all backend repositories
   - **Mitigation:** New scopes require one-time manual addition to any package.json, then auto-detected thereafter

4. **No Version Validation Before Update**

   - **What we're accepting:** Don't verify dist tag exists in registry before attempting install
   - **To gain:** Faster execution (fewer API calls), simpler implementation
   - **Mitigation:** Clear error reporting if npm install fails due to missing tag/version

5. **Command May Run Twice on Assignment Failure**
   - **What we're accepting:** `gh pr create` may execute twice if assignee permission fails
   - **To gain:** Simple bash implementation with automatic fallback
   - **Mitigation:** First command fails gracefully, second command succeeds, PR always created

### Known Risks

1. **PAT Token Expiration**

   - **Description:** If `CROSS_REPO_PAT` expires, cross-repo triggering silently fails
   - **Impact:** Backend repos stop receiving updates automatically
   - **Probability:** Medium (tokens expire after 90 days to 1 year)
   - **Mitigation:**
     - Use 1-year expiration for PAT
     - Set up expiration monitoring/alerts
     - Document PAT renewal process
     - Consider GitHub App in future for auto-expiring tokens

2. **Branch Name Mismatch**

   - **Description:** If branch doesn't exist in backend repo, workflow fails
   - **Impact:** No PR created, update doesn't happen
   - **Probability:** Low (frontend and backend branches usually aligned)
   - **Mitigation:**
     - Workflow fails with clear error message
     - Teams can manually trigger update on different branch
     - Future enhancement: Fallback to default branch

3. **JFrog Registry Downtime**

   - **Description:** If JFrog registry is unavailable, npm install commands fail
   - **Impact:** All package updates fail, PR not created
   - **Probability:** Low (JFrog generally reliable)
   - **Mitigation:**
     - Workflow retry logic (GitHub Actions auto-retries on failure)
     - Clear error message indicates registry issue
     - Can manually re-run workflow when registry recovers

4. **Breaking Changes in Package Updates**

   - **Description:** New frontend package versions may contain breaking changes
   - **Impact:** Backend code may break after updates
   - **Probability:** Medium (depends on frontend development practices)
   - **Mitigation:**
     - PR creates isolated branch for review
     - Backend tests should run on PR (separate CI workflow)
     - Team reviews PR before merging
     - Can revert PR if issues found

5. **Permission Issues in Backend Repo**

   - **Description:** Workflow may lack permissions to create branches or PRs
   - **Impact:** Update fails, no PR created
   - **Probability:** Low (GITHUB_TOKEN has write access by default)
   - **Mitigation:**
     - Ensure backend repo workflow has `contents: write` and `pull-requests: write` permissions
     - Clear error message if permission denied
     - Document required permissions

6. **Conflicting Updates**
   - **Description:** If multiple frontend repos trigger updates simultaneously to same backend repo
   - **Impact:** Race condition - second update might conflict with first
   - **Probability:** Low (different frontend repos typically target different backend repos)
   - **Mitigation:**
     - Each update creates unique branch name with `${{ github.run_id }}`
     - PRs created separately, can be merged sequentially
     - GitHub prevents same-branch conflicts automatically

## Out of Scope

The following items are explicitly **not included** in this design:

1. **Automatic PR Merging**: PRs require manual review and approval before merging
2. **Rollback on Test Failure**: If backend tests fail on the PR, manual intervention required (no auto-rollback)
3. **Version Pinning Strategies**: Always updates to latest version with specified dist tag (no semantic version constraints like `^` or `~`)
4. **Multi-Repository Updates**: One backend repo updated per frontend workflow run (no bulk updates to multiple backend repos)
5. **Notification System**: No Slack/email notifications on update success/failure (beyond GitHub's native PR notifications)
6. **Update Scheduling**: No delayed or scheduled updates (always immediate after frontend publish)
7. **Dependency Conflict Resolution**: Script doesn't resolve npm peer dependency conflicts (npm handles this)
8. **Custom Update Logic per Plugin**: All plugins updated with same strategy (no per-plugin customization)
9. **Historical Version Tracking**: No database or log of update history beyond git commit history
10. **Frontend Package Selection**: Always updates ALL packages from detected scopes (no selective package updates)

## Success Criteria

How will we know this design is successful?

### Functional Criteria

1. **Automated End-to-End Flow**

   - ✅ Frontend workflow publishes packages to JFrog
   - ✅ Backend workflow automatically triggers within 1 minute
   - ✅ Backend PR created without manual intervention

2. **Correct Version Updates**

   - ✅ Main branch updates use `snapshot` dist tag
   - ✅ Release branches use correct `release-{major}.{minor}` dist tag
   - ✅ All `**/assets/package.json` files updated with matching versions

3. **Comprehensive PR Information**

   - ✅ PR description lists all updated packages with version changes
   - ✅ PR description clearly shows failed updates with error messages
   - ✅ PR assigned to triggering developer (or no assignee if permission denied)

4. **Resilient to Partial Failures**
   - ✅ One failed plugin folder doesn't block others from updating
   - ✅ Clear reporting distinguishes successful vs failed updates
   - ✅ Workflow succeeds if at least one folder updates successfully

### Non-Functional Criteria

1. **Performance**

   - ✅ Complete update cycle (trigger to PR creation) under 5 minutes for typical backend repo
   - ✅ Script handles 20+ assets folders without timeout

2. **Reliability**

   - ✅ 95%+ success rate for workflows (excluding expected failures like branch mismatches)
   - ✅ Clear error messages for all failure scenarios
   - ✅ No silent failures (all errors logged and reported)

3. **Maintainability**

   - ✅ TypeScript code follows existing patterns in `tools/scripts/`
   - ✅ Workflow structure consistent with existing frontend workflows
   - ✅ Clear documentation in code comments
   - ✅ Easy to add new branch patterns or dist tag mappings

4. **Usability**
   - ✅ Zero configuration required in backend repositories (beyond initial workflow file)
   - ✅ Frontend repos only need to add `BACKEND_REPO` input parameter
   - ✅ PR descriptions provide actionable information for reviewers

## Next Steps

1. **Review this design document**

   - Gather feedback from frontend and backend teams
   - Validate assumptions about repository structures
   - Confirm branch naming conventions

2. **Refine if needed based on feedback**

   - Adjust error handling strategies
   - Modify PR description format
   - Update dist tag resolution logic

3. **Proceed to implementation planning:**

   ```bash
   /create_plan thoughts/shared/designs/backend-frontend-package-automation.md
   ```

   This will create a detailed implementation plan with specific tasks, file changes, and testing strategy.

## References

- **Original Ticket:** (to be added)
- **Related Research:** `/Users/slavenkopic/Desktop/cplace-dev/repos/github-actions/thoughts/shared/research/2025-11-26_13-58-35_frontend-package-publishing-and-backend-installation.md`
- **Existing Workflows:**
  - Frontend snapshot workflow: `.github/workflows/fe-snapshot.yml`
  - Frontend release workflow: `.github/workflows/fe-release.yml`
  - Artifacts action: `.github/actions/artifacts/action.yml`
  - Artifacts scripts: `tools/scripts/artifacts/`
- **GitHub Documentation:**
  - Repository Dispatch Events: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#repository_dispatch
  - Reusable Workflows: https://docs.github.com/en/actions/using-workflows/reusing-workflows
