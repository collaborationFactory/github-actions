---
date: 2025-11-26T13:58:35+0000
researcher: Claude
git_commit: a9c4ae4fbb2f6f179fed4af85bb52126870fa14c
branch: fix/PFM-ISSUE-31032-Clean-Snapshot-Action-Not-Working-for-Over-
repository: github-actions
topic: 'Frontend NPM Package Publishing and Backend Installation Workflow'
tags:
  [
    research,
    codebase,
    frontend,
    npm,
    workflows,
    publishing,
    jfrog,
    artifacts,
    backend-installation,
  ]
status: complete
last_updated: 2025-11-26
last_updated_by: Claude
---

# Research: Frontend NPM Package Publishing and Backend Installation Workflow

**Date**: 2025-11-26T13:58:35+0000
**Researcher**: Claude
**Git Commit**: a9c4ae4fbb2f6f179fed4af85bb52126870fa14c
**Branch**: fix/PFM-ISSUE-31032-Clean-Snapshot-Action-Not-Working-for-Over-
**Repository**: github-actions

## Research Question

How are `.github/workflows/fe-snapshot.yml` and `.github/workflows/fe-release.yml` used in frontend repositories (cplace-fe, cplace-paw-fe) to publish NPM packages from main/master or release/\* branches, and what is the subsequent process for installing those packages in backend repositories (main, cplace-paw)?

## Summary

The research reveals a **complete frontend publishing workflow** but identifies a **critical gap in backend automation**:

1. ✅ **Frontend Publishing**: Two reusable workflows (`fe-snapshot.yml` and `fe-release.yml`) handle NPM package publishing to JFrog Artifactory for snapshots and releases respectively
2. ✅ **Artifacts Action**: A sophisticated composite action (`.github/actions/artifacts`) manages building, versioning, and publishing packages with different version schemes
3. ✅ **Frontend Integration**: Frontend repos use workflow templates (`fe-main.yml`, `fe-tag-pushed.yml`) to trigger these publishing workflows
4. ❌ **Backend Installation**: **No automated workflow exists** to install published frontend packages in backend repositories - this must be done manually

## Detailed Findings

### 1. Frontend Publishing Workflows

#### fe-snapshot.yml (`.github/workflows/fe-snapshot.yml:1-48`)

**Purpose**: Publishes snapshot versions from main/master branches for continuous integration

**Trigger**: `workflow_call` (reusable workflow)

**Required Inputs**:

- `GHA_REF`: Git reference to checkout
- `GHA_BASE`: Base branch for comparison (determines affected projects)

**Required Secrets**:

- `JFROG_BASE64_TOKEN`: Base64-encoded authentication token
- `JFROG_URL`: JFrog Artifactory URL (defaults to `https://cplace.jfrog.io/artifactory/cplace-npm-local`)
- `JFROG_USER`: JFrog username

**Process**:

1. Checks out specified ref with full history (`fetch-depth: 0`)
2. Sets up Node.js 22.15.0
3. Caches node_modules for performance
4. Calls artifacts action with `SNAPSHOT=true` environment variable

**Version Format**: `0.0.0-SNAPSHOT-{hashedTimestamp}` (e.g., `0.0.0-SNAPSHOT-lf8x7y9z-20231126`)

**NPM Tag**: `snapshot`

---

#### fe-release.yml (`.github/workflows/fe-release.yml:1-59`)

**Purpose**: Publishes production releases when version tags are pushed

**Trigger**: `workflow_call` (reusable workflow)

**Required Secrets**:

- `JFROG_BASE64_TOKEN`: JFrog authentication
- `JFROG_URL`: Registry URL
- `JFROG_USER`: JFrog username
- `DOT_NPMRC`: Complete .npmrc file content for additional registry configuration

**Process**:

1. Checks out repository with full history
2. Sets up Node.js 22.15.0
3. Caches node_modules
4. Injects .npmrc configuration using `bduff9/use-npmrc@v1.1`
5. Installs dependencies if cache miss
6. Extracts tag using `dawidd6/action-get-tag@v1`
7. Calls artifacts action with extracted `TAG` value

**Version Format**: Semantic versioning `{major}.{minor}.{patch}` (e.g., `22.3.1`)

**Git Tag Format**: `version/{major}.{minor}.{patch}` (e.g., `version/22.3.1`)

**NPM Tag**: `release-{major}.{minor}` (e.g., `release-22.3`)

---

### 2. The Artifacts Action - Core Publishing Logic

Located at `.github/actions/artifacts/action.yml:1-12`, this composite action is the heart of the publishing system.

#### Architecture

The action is a composite action that executes TypeScript code via `ts-node`:

```yaml
runs:
  using: 'composite'
  steps:
    - run: printenv
      shell: bash
    - run: cd "$GITHUB_ACTION_PATH/../../.." && pwd && npm ci
      shell: bash
    - run: npx ts-node "$GITHUB_ACTION_PATH/../../../tools/scripts/artifacts/main.ts"
      shell: bash
```

**Entry Point**: `tools/scripts/artifacts/main.ts:3`
**Main Handler**: `tools/scripts/artifacts/artifacts-handler.ts`
**Project Management**: `tools/scripts/artifacts/nx-project.ts`
**Utilities**: `tools/scripts/artifacts/utils.ts`

#### Task Determination Logic (`artifacts-handler.ts:58-91`)

The action determines one of three operational modes based on environment variables:

**1. RELEASE Mode** (triggered when):

- `TAG` starts with `version/` (e.g., `version/22.3.1`) → `artifacts-handler.ts:59`
- OR current branch starts with `release/` (e.g., `release/22.3`) → `artifacts-handler.ts:66`

Behavior:

- Builds **ALL** projects (`onlyAffected = false`) → `artifacts-handler.ts:60`
- Uses semantic version from tag/branch → `artifacts-handler.ts:62, 67-69`
- Disables source maps for production → `nx-project.ts:132-135`
- Sets NPM tag to `release-{major}.{minor}` → `nx-project.ts:308`

**2. MAIN_SNAPSHOT Mode** (triggered when):

- `SNAPSHOT=true` environment variable is set → `artifacts-handler.ts:50-51`

Behavior:

- Builds **only affected** projects → default behavior
- Creates timestamp-based version: `0.0.0-SNAPSHOT-{hashedTimestamp}` → `artifacts-handler.ts:75-78`
- Hashed timestamp format: `{base36Timestamp}-{YYYYMMDD}` → `utils.ts:283-291`
- Includes source maps for debugging → `nx-project.ts:132-135`
- Sets NPM tag to `snapshot` → `nx-project.ts:309`

**3. PR_SNAPSHOT Mode** (triggered when):

- `PR_NUMBER` environment variable is provided → `artifacts-handler.ts:44-45`

Behavior:

- Builds **only affected** projects
- Creates PR-specific version: `0.0.0-{sanitizedBranch}-{prNumber}` → `artifacts-handler.ts:85-88`
- Branch name sanitized: truncated to 50 chars, special chars → dashes → `utils.ts:278-280`
- Example: `0.0.0-fix-PFM-ISSUE-31032-Clean-Snapshot-Action-No-123`
- **Deletes existing PR snapshot** before publishing → `nx-project.ts:129-130`
- Includes source maps → `nx-project.ts:132-135`
- Sets NPM tag to `latest-pr-snapshot` → `nx-project.ts:307`

#### Project Discovery (`artifacts-handler.ts:137-166`)

**Affected Projects Mode** (snapshots):

- Uses NX CLI: `npx nx show projects --affected=true` → `utils.ts:45-54`
- Compares against base branch to find changed projects
- Includes apps and libraries
- Filters out E2E apps without `public_api.ts` → `utils.ts:65-71`
- Excludes projects starting with `api-` → `utils.ts:74`

**All Projects Mode** (releases):

- Uses NX CLI: `npx nx show projects --affected=false` → `utils.ts:85-117`
- Gets complete project list
- Same filtering rules apply

#### Build Process (`nx-project.ts:128-139`)

For each publishable project:

```bash
npx nx build {projectName} --prod {--configuration=sourcemap}
```

- Production flag always enabled
- Source maps only for non-release tasks (snapshots, PR snapshots)
- Output directory: `dist/{apps|libs}/{projectPath}` → `nx-project.ts:316-324`

#### NPM Package Preparation

**1. .npmrc Generation** (`nx-project.ts:243-263`)

Written to each project's dist folder:

```
@{scope}:registry={jfrogUrl}
{jfrogUrlNoHttp}:_auth={base64Token}
{jfrogUrlNoHttp}:always-auth=true
{jfrogUrlNoHttp}:email={jfrogUser}
```

- Scope parsed from root package.json → `utils.ts:351-370`
- Credentials never committed to repository
- URL format without protocol → `jfrog-credentials.ts:16-18`

**2. package.json Update/Generation** (`nx-project.ts:265-304`)

For libraries with existing package.json:

- Reads from dist folder
- Updates: `version`, `author: "squad-fe"`, `publishConfig`

For applications without package.json:

- Generates minimal package.json with:
  - `name: @{scope}/{projectName}`
  - `version: {generatedVersion}`
  - `author: "squad-fe"`
  - `publishConfig`: registry, access: restricted, tag

**3. FOSS List Copy** (`nx-project.ts:144-159`)

- Copies `cplace-foss-list.json` from root to each project's dist
- Required for license compliance

#### Publishing to JFrog (`nx-project.ts:108-126`)

Process:

1. For PR snapshots: delete existing version first → `nx-project.ts:129-130`
2. Execute `npm publish` from dist directory → `nx-project.ts:108-125`
3. Credentials provided via `.npmrc` file
4. Registry and tag specified in `package.json`'s `publishConfig`
5. On success: write to GitHub comments file → `nx-project.ts:116-118`
6. On failure: exit with code 1

**GitHub Comments File** (`utils.ts:315-349`):

- Path: `{gitRoot}/githubCommentsForPR.txt`
- Contains list of published packages with timestamps (Berlin timezone)
- Used by subsequent workflow steps to comment on PRs

#### Version Management (`version.ts:1-58`)

**Version Class** manages semantic versioning with custom suffixes:

```typescript
export class Version {
  public major: number = -1;
  public minor: number = -1;
  public patch: number = -1;
  public uniqueIdentifier: string = '';

  constructor(versionString: string, public customSuffix: string = '');

  public toString(): string; // Returns: major.minor.patch{suffix}{identifier}
  public getGitTag(): string; // Returns: version/major.minor.patch
  public getNpmTag(): string; // Returns: release-major.minor
}
```

**Version Bumping** (`utils.ts:193-206`):

- For new release branches: creates `{major}.{minor}.1`
- For existing branches: increments patch number

---

### 3. How Frontend Repositories Use These Workflows

Frontend repositories (cplace-fe, cplace-paw-fe) use **workflow templates** that call the reusable workflows.

#### Main Branch Publishing

**Template**: `.github/workflow-templates/fe/fe-main.yml:39-48`

```yaml
snapshot:
  needs: build
  uses: collaborationFactory/github-actions/.github/workflows/fe-snapshot.yml@master
  with:
    GHA_REF: ${{ github.ref }}
    GHA_BASE: main # or master
  secrets:
    JFROG_BASE64_TOKEN: ${{ secrets.JFROG_BASE64_TOKEN }}
    JFROG_URL: ${{ secrets.JFROG_URL }}
    JFROG_USER: ${{ secrets.JFROG_USER }}
```

**When**: Triggered on push to main/master branch
**What**: Publishes snapshot versions of affected packages
**Version**: `0.0.0-SNAPSHOT-{timestamp}`

#### Release Tag Publishing

**Template**: `.github/workflow-templates/fe/fe-tag-pushed.yml:14-20`

```yaml
release:
  uses: collaborationFactory/github-actions/.github/workflows/fe-release.yml@master
  secrets:
    JFROG_BASE64_TOKEN: ${{ secrets.JFROG_BASE64_TOKEN }}
    JFROG_URL: ${{ secrets.JFROG_URL }}
    JFROG_USER: ${{ secrets.JFROG_USER }}
    DOT_NPMRC: ${{ secrets.DOT_NPMRC }}
```

**When**: Triggered when tags matching `version/*` are pushed
**What**: Publishes production releases of ALL packages
**Version**: Semantic version from tag (e.g., `22.3.1`)

#### PR Snapshot Publishing

**Template**: `.github/workflow-templates/fe/fe-pr-snapshot.yml:11-19`

```yaml
publish-pr-snapshot:
  if: contains(github.event.pull_request.labels.*.name, 'snapshot')
  uses: collaborationFactory/github-actions/.github/workflows/fe-pr-snapshot.yml@master
  with:
    GHA_BASE: ${{ github.event.pull_request.base.ref }}
  secrets:
    # same secrets as snapshot
```

**When**: Triggered on PRs with `snapshot` label
**What**: Publishes PR-specific versions of affected packages
**Version**: `0.0.0-{branch-name}-{prNumber}`

---

### 4. Backend Installation - The Missing Piece

#### Critical Finding: No Automation Exists

After comprehensive search of the repository, **NO workflows, scripts, or automation** were found that:

- Trigger installation in backend repositories after frontend publishing
- Update `package.json` in backend repos (main, cplace-paw)
- Use `repository_dispatch` or webhooks to notify backend repos
- Automatically install published NPM packages

#### What Backend Repos Need to Do Manually

To install a published frontend package, backend repositories must:

**1. Identify the Published Package**

From JFrog Artifactory:

- **Registry**: `https://cplace.jfrog.io/artifactory/cplace-npm-local`
- **Package format**: `@{scope}/{package-name}@{version}`
- **Tags available**:
  - `snapshot`: Latest main branch snapshot
  - `latest-pr-snapshot`: Latest PR snapshot
  - `release-{major}.{minor}`: Specific release version (e.g., `release-22.3`)

**2. Configure NPM Registry Access**

Create or update `.npmrc` in backend repo:

```
@{scope}:registry=https://cplace.jfrog.io/artifactory/cplace-npm-local
//cplace.jfrog.io/artifactory/cplace-npm-local/:_auth={base64Token}
//cplace.jfrog.io/artifactory/cplace-npm-local/:always-auth=true
//cplace.jfrog.io/artifactory/cplace-npm-local/:email={jfrogUser}
```

**3. Update package.json**

Add or update dependency:

```json
{
  "dependencies": {
    "@cplace-next/package-name": "22.3.1"
  }
}
```

Or for snapshots:

```json
{
  "dependencies": {
    "@cplace-next/package-name": "0.0.0-SNAPSHOT-lf8x7y9z-20231126"
  }
}
```

**4. Install Dependencies**

```bash
npm install
# or
npm update @cplace-next/package-name
```

#### Potential Automation Patterns (Not Currently Implemented)

Based on patterns found in the codebase, backend automation could use:

**Pattern 1: Repository Dispatch** (would need to be added)

Frontend workflow could dispatch event after successful publish:

```yaml
- name: Trigger Backend Update
  uses: peter-evans/repository-dispatch@v2
  with:
    token: ${{ secrets.PAT_TOKEN }}
    repository: collaborationFactory/main
    event-type: frontend-package-published
    client-payload: '{"package": "${{ env.PACKAGE_NAME }}", "version": "${{ env.VERSION }}"}'
```

Backend repo would listen with `repository_dispatch` trigger:

```yaml
on:
  repository_dispatch:
    types: [frontend-package-published]

jobs:
  update-frontend-package:
    runs-on: ubuntu-latest
    steps:
      - name: Update package.json
        run: |
          npm install ${{ github.event.client_payload.package }}@${{ github.event.client_payload.version }}
```

**Pattern 2: Workflow Dispatch** (manual but streamlined)

Backend repo could have a workflow_dispatch workflow:

```yaml
on:
  workflow_dispatch:
    inputs:
      package_name:
        description: 'Frontend package to install'
        required: true
      version:
        description: 'Version to install'
        required: true

jobs:
  install-package:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Update package
        run: npm install ${{ inputs.package_name }}@${{ inputs.version }}
      - name: Create PR
        # commit changes and create PR
```

**Pattern 3: Scheduled Check** (polling approach)

Backend repo could periodically check for new versions:

```yaml
on:
  schedule:
    - cron: '0 */6 * * *' # Every 6 hours

jobs:
  check-updates:
    runs-on: ubuntu-latest
    steps:
      - name: Check for updates
        run: npm outdated --json > updates.json
      - name: Create PR if updates available
        # parse JSON and create PR with updates
```

---

### 5. NPM Registry Operations

#### Publishing (`npm publish`)

**Location**: `nx-project.ts:108-126`

```typescript
execSync(`npm publish`, {
  cwd: `${this.getPathToProjectInDist()}`,
});
```

**Requirements**:

- `.npmrc` with authentication in dist folder
- `package.json` with `publishConfig` in dist folder
- Built artifacts in dist folder

**Behavior**:

- Publishes to registry specified in `publishConfig.registry`
- Uses tag from `publishConfig.tag`
- Access level from `publishConfig.access` (always `restricted`)

#### Checking Package Existence (`npm show`)

**Location**: `nx-project.ts:174-186`

```typescript
const scopeSearchResult = execSync(`npm show ${pkg} --json`).toString();
const npmPackage = JSON.parse(scopeSearchResult);
return npmPackage.versions.includes(version);
```

**Returns**: Package metadata including all available versions

#### Deleting Versions (`npm unpublish`)

**Location**: `nx-project.ts:188-241`

```typescript
execSync(
  `npm unpublish ${this.scope}/${this.name}@${version.toString()} --force`,
  { cwd: `${this.getPathToProjectInDist()}` }
);
```

**Used for**:

- Removing PR snapshots before republishing
- Cleanup of old snapshots (>4 months old)

#### Listing All Versions (`npm view`)

**Location**: `utils.ts:294-307`

```typescript
const snapshotVersions = JSON.parse(
  execSync(`npm view ${scope}/${packageName} --json`, {
    cwd: projectDistDir,
  }).toString()
).versions;
```

**Used for**: Finding all versions for cleanup operations

---

### 6. Snapshot Cleanup Automation

**Location**: `tools/scripts/artifacts/cleanup-snapshots.ts:1-105`

**Purpose**: Remove snapshots older than 4 months (release cadence)

**Algorithm**:

1. Search all packages in scope: `npm search @{scope} --json`
2. Get all versions: `npm view {package} --json`
3. Filter versions containing 'snapshot'
4. Parse date from version string: `0.0.0-SNAPSHOT-lf8x7y9z-20231126` → `20231126`
5. Calculate age using Luxon library
6. Delete versions older than 4 months

**Triggered by**: Workflow template `.github/workflow-templates/fe/fe-cleanup-snapshots.yml`

---

## Code References

### Workflows

- `.github/workflows/fe-snapshot.yml:1-48` - Snapshot publishing workflow
- `.github/workflows/fe-release.yml:1-59` - Release publishing workflow
- `.github/workflows/fe-pr-snapshot.yml:1-81` - PR snapshot workflow
- `.github/workflow-templates/fe/fe-main.yml:39-48` - Main branch template
- `.github/workflow-templates/fe/fe-tag-pushed.yml:14-20` - Tag pushed template

### Artifacts Action

- `.github/actions/artifacts/action.yml:1-12` - Composite action definition
- `tools/scripts/artifacts/main.ts:3` - Entry point
- `tools/scripts/artifacts/artifacts-handler.ts:38-188` - Main orchestration logic
- `tools/scripts/artifacts/nx-project.ts:108-324` - Project-level operations
- `tools/scripts/artifacts/utils.ts:45-349` - Utility functions
- `tools/scripts/artifacts/version.ts:1-58` - Version management
- `tools/scripts/artifacts/jfrog-credentials.ts:6-18` - JFrog authentication

### Key Methods

- `nx-project.ts:108-126` - `publish()` method
- `nx-project.ts:188-241` - `deleteArtifact()` method
- `nx-project.ts:243-263` - `writeNPMRCInDist()` method
- `nx-project.ts:265-304` - `setVersionOrGeneratePackageJsonInDist()` method
- `artifacts-handler.ts:58-91` - Task determination logic
- `utils.ts:273-292` - Snapshot version generation
- `utils.ts:193-206` - Release version bumping

---

## Architecture Insights

### Design Patterns

1. **Reusable Workflows**: Frontend repos use the same publishing logic via `workflow_call`
2. **Composite Actions**: TypeScript business logic wrapped in GitHub Actions
3. **Environment-Based Configuration**: Behavior determined by environment variables (SNAPSHOT, TAG, PR_NUMBER)
4. **Affected-Only Publishing**: Efficiency through NX affected project detection
5. **Registry Isolation**: Scoped packages with restricted access
6. **Version Segregation**: Different tags for snapshots, PRs, and releases

### Version Naming Strategy

The version naming reveals the deployment model:

- **Snapshots** (`0.0.0-SNAPSHOT-{timestamp}`): Ephemeral, continuous integration builds
- **PR Snapshots** (`0.0.0-{branch}-{pr}`): Feature testing, replaced on each push
- **Releases** (`{major}.{minor}.{patch}`): Permanent, semantic versions

This strategy allows:

- Parallel development (PR snapshots don't conflict)
- Easy cleanup (snapshots have timestamps)
- Clear production versions (semantic versioning)

### Security Considerations

1. **Credentials Never Committed**: `.npmrc` generated at runtime
2. **Base64 Token**: Authentication token stored as secret, base64-encoded
3. **Restricted Access**: All published packages have `access: restricted`
4. **Scoped Packages**: Namespace isolation with `@{scope}/` prefix

### Monorepo Architecture (NX)

The system is designed for NX monorepos:

- **Project Discovery**: Uses `nx show projects`
- **Affected Detection**: Compares against base branch
- **Build System**: Uses `nx build` command
- **Project Types**: Distinguishes apps vs libs vs e2e

---

## Historical Context (from thoughts/)

No relevant historical context found in thoughts/ directory for this specific workflow system.

---

## Related Research

This is the initial research document on this topic. Future research could explore:

- Backend repository structure and dependency management
- Implementation of automated backend installation
- Cross-repository dependency tracking
- JFrog Artifactory configuration and retention policies

---

## Open Questions

### Critical Gap: Backend Installation Automation

**Question**: Why is there no automation to install published frontend packages in backend repositories?

**Potential Reasons**:

1. **Manual Control**: Backend teams may want to manually review and test frontend package updates before installation
2. **Version Pinning**: Backend repos may intentionally lag behind to ensure stability
3. **Testing Requirements**: Frontend package updates may require backend code changes
4. **Different Release Cycles**: Frontend and backend may have different release schedules
5. **Implementation Pending**: Automation may be planned but not yet implemented

**Impact**:

- Manual process introduces delay between frontend publishing and backend integration
- Potential for version mismatches between environments
- Additional coordination required between frontend and backend teams
- Risk of forgetting to update dependencies

### Implementation Questions

1. **Who should trigger backend installation?**

   - Frontend workflow after successful publish?
   - Backend workflow on schedule?
   - Manual trigger by backend team?

2. **What version should be installed?**

   - Latest snapshot for development branches?
   - Specific release version for release branches?
   - How to handle multiple frontend packages?

3. **How to handle failures?**

   - What if package installation breaks backend tests?
   - Automatic rollback vs. notification?
   - Should PRs be created for manual review?

4. **Which backend repos need updates?**
   - Only `main` and `cplace-paw`?
   - Different packages for different repos?
   - How to map frontend packages to backend repos?

### Recommended Next Steps

1. **Document Current Process**: Create runbook for manual installation in backend repos
2. **Identify Requirements**: Survey backend teams on automation needs
3. **Design Automation**: Choose pattern (repository_dispatch, scheduled, manual workflow_dispatch)
4. **Implement Pilot**: Start with one frontend package and one backend repo
5. **Monitor & Iterate**: Gather feedback and expand to other packages/repos

---

## Conclusion

The frontend NPM package publishing system is **robust and well-architected**, with clear separation of concerns, efficient affected-only publishing, and comprehensive version management. However, the **lack of backend installation automation** represents a significant gap in the end-to-end workflow.

**Key Takeaways**:

- ✅ Frontend publishing is automated and reliable
- ✅ Three distinct publishing modes (snapshots, PR snapshots, releases)
- ✅ Clear version naming and registry organization
- ❌ Backend installation is entirely manual
- ❌ No cross-repository automation or notifications
- ⚠️ Potential for version drift between frontend packages and backend dependencies

**Recommendation**: Implement backend installation automation with appropriate safeguards (testing, PR-based review) to complete the CI/CD pipeline and reduce manual coordination overhead.
