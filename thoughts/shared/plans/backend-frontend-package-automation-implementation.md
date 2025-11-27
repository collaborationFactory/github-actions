# Backend Frontend Package Automation - Implementation Plan

## Overview

Implement automated frontend package updates in backend repositories after successful publishing to JFrog NPM Registry. This plan covers modifications to existing frontend workflows, creation of a new backend update workflow, and TypeScript scripts to handle package discovery and updates.

## Current State Analysis

### Existing Infrastructure

**Frontend Publishing Workflows**:

- `.github/workflows/fe-snapshot.yml:1-48` - Publishes snapshot versions from main/master branches
- `.github/workflows/fe-release.yml:1-59` - Publishes release versions from tags

**Artifacts System**:

- `.github/actions/artifacts/action.yml:1-12` - Composite action executing TypeScript via ts-node
- `tools/scripts/artifacts/` - Complete TypeScript codebase for artifact management
  - Pattern: Entry point (`main.ts`) → Handler class → Utilities → Models
  - JFrog authentication via environment variables (`jfrog-credentials.ts:1-19`)
  - `.npmrc` generation per project (`nx-project.ts:243-263`)

**Workflow Patterns**:

- All workflows use `workflow_call` trigger (no existing `repository_dispatch` usage)
- Secrets passed as environment variables to composite actions
- Common patterns: `printenv`, `cd "$GITHUB_ACTION_PATH/../../.." && npm ci`, `npx ts-node`

**Dependencies** (`package.json:25-28`):

- `@actions/core` - GitHub Actions logging
- No glob libraries (uses shell `ls` with glob patterns via `execSync`)

### What's Missing

- ❌ No `repository_dispatch` events in any workflow
- ❌ No cross-repository triggering mechanism
- ❌ No backend package update workflows
- ❌ No TypeScript scripts for `**/assets/package.json` scanning
- ❌ No automatic dist tag resolution based on branch names
- ❌ No PR creation with package update summaries

### Key Constraints Discovered

1. **File Discovery Pattern**: Use shell glob via `execSync('ls */**/pattern')` (line 18 of `utils.ts`)
2. **No npm ci in backend workflow**: Can't run `npm ci` at backend repo root (backend is not Node.js monorepo)
3. **Separate npm install per folder**: Must run `npm install` in each `**/assets` directory independently
4. **GitHub CLI available**: Can use `gh pr create` for PR creation (no Octokit dependency needed)
5. **.npmrc per backend workflow**: Must configure JFrog authentication for backend workflow

## Desired End State

### Verification Criteria

**Automated Verification:**

- [ ] Modified `fe-snapshot.yml` accepts `BACKEND_REPO` input parameter
- [ ] Modified `fe-release.yml` accepts `BACKEND_REPO` input parameter
- [ ] New workflow file `.github/workflows/be-package-update.yml` exists
- [ ] TypeScript scripts in `tools/scripts/backend-package-updater/` compile successfully: `npx tsc --noEmit`
- [ ] Unit tests pass: `npm test -- backend-package-updater`
- [ ] Composite action file `.github/actions/backend-package-updater/action.yml` exists

**Manual Verification:**

- [ ] Frontend workflow triggers backend workflow after publishing (check GitHub Actions UI)
- [ ] Backend workflow creates branch with updated package.json files
- [ ] PR is created in backend repo with correct title and description
- [ ] PR shows all package version changes in description
- [ ] PR is assigned to triggering user (or no assignee if no permission)
- [ ] Dist tag resolution works correctly (main → snapshot, release/25.4 → release-25.4)
- [ ] Multiple `**/assets` folders are all updated in single PR
- [ ] Failed updates are clearly reported in PR description

## What We're NOT Doing

1. **Automatic PR Merging**: PRs require manual review
2. **Test Execution**: Backend tests are separate workflow responsibility
3. **Rollback Logic**: If updates fail, manual intervention required
4. **Version Validation**: No pre-check if dist tags exist in registry
5. **Custom Scope Configuration**: Scopes auto-detected only, no config files
6. **GitHub App**: Using organization PAT instead
7. **Notifications**: No Slack/email beyond GitHub's native PR notifications
8. **Multi-Repository Updates**: One backend repo per frontend workflow invocation
9. **Branch Creation in Backend**: If branch doesn't exist in backend, workflow fails (no auto-create)
10. **NPM Lock File Regeneration**: Using `npm install` which respects existing lock files

## Implementation Approach

### High-Level Strategy

1. **Phase 1**: Modify existing frontend workflows to dispatch events (minimal changes, low risk)
2. **Phase 2**: Create TypeScript scripts for backend updates (core logic, testable in isolation)
3. **Phase 3**: Create backend workflow and composite action (integration layer)
4. **Phase 4**: Integration testing and documentation

This phasing allows incremental testing and rollback if issues occur.

---

## Phase 1: Modify Frontend Workflows

### Overview

Add repository_dispatch capability to existing frontend workflows without breaking current functionality.

### Changes Required

#### 1. Update `fe-snapshot.yml`

**File**: `.github/workflows/fe-snapshot.yml`

**Line 12 (add new input)**:

```yaml
on:
  workflow_call:
    inputs:
      GHA_REF:
        type: string
        required: true
      GHA_BASE:
        type: string
        required: true
      BACKEND_REPO: # ← NEW INPUT
        type: string
        required: false
        description: 'Backend repository name to trigger (e.g., "main" or "cplace-paw")'
    secrets:
      JFROG_BASE64_TOKEN:
        required: true
      JFROG_URL:
        required: true
      JFROG_USER:
        required: true
      GIT_USER_TOKEN:
        required: false
      CROSS_REPO_PAT: # ← NEW SECRET
        required: false
```

**After line 48 (add new step)**:

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

**Rationale**:

- Optional input ensures backward compatibility (existing workflows won't break)
- `github.ref_name` extracts branch name (e.g., "main", "release/25.4") from `refs/heads/main`
- `github.actor` provides username for PR assignment
- Conditional `if` prevents execution when `BACKEND_REPO` not provided

#### 2. Update `fe-release.yml`

**File**: `.github/workflows/fe-release.yml`

**After line 13 (add new input)**:

```yaml
on:
  workflow_call:
    secrets:
      JFROG_BASE64_TOKEN:
        required: true
      JFROG_URL:
        required: true
      JFROG_USER:
        required: true
      DOT_NPMRC:
        required: true
      CROSS_REPO_PAT: # ← NEW SECRET
        required: false
    inputs:
      BACKEND_REPO: # ← NEW INPUT
        type: string
        required: false
        description: 'Backend repository name to trigger'
```

**After line 59 (add new step)**:

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

**Note**: Unlike `fe-snapshot.yml`, release workflow extracts tag via `dawidd6/action-get-tag@v1` (line 50), but `github.ref_name` still provides the branch/tag name correctly.

### Success Criteria

#### Automated Verification:

- [ ] YAML syntax validation: `yamllint .github/workflows/fe-snapshot.yml`
- [ ] YAML syntax validation: `yamllint .github/workflows/fe-release.yml`
- [ ] Workflows don't break existing calls (test with empty `BACKEND_REPO`)

#### Manual Verification:

- [ ] Frontend workflow completes successfully without `BACKEND_REPO` input
- [ ] With `BACKEND_REPO` input, workflow attempts repository_dispatch (check logs)
- [ ] Repository dispatch event visible in backend repo's Actions → "All workflows" → filter by event type

---

## Phase 2: Create TypeScript Backend Package Updater Scripts

### Overview

Create TypeScript scripts following existing `tools/scripts/artifacts/` patterns for discovering assets folders, detecting scopes, resolving dist tags, updating packages, and generating PR descriptions.

### Directory Structure

Create: `tools/scripts/backend-package-updater/`

```
tools/scripts/backend-package-updater/
├── main.ts                # Entry point
├── updater.ts             # Core update logic
├── dist-tag-resolver.ts   # Branch to dist tag mapping
├── utils.ts               # Utility functions (glob, file operations)
├── types.ts               # TypeScript interfaces
├── updater.test.ts        # Tests for updater
├── dist-tag-resolver.test.ts  # Tests for dist tag resolution
└── utils.test.ts          # Tests for utilities
```

### Changes Required

#### 1. Create `types.ts`

**File**: `tools/scripts/backend-package-updater/types.ts`

```typescript
export interface UpdateResult {
  path: string;
  success: boolean;
  updates?: PackageUpdate[];
  error?: string;
}

export interface PackageUpdate {
  package: string;
  oldVersion: string;
  newVersion: string;
}

export interface UpdateSummary {
  results: UpdateResult[];
  prDescription: string;
  allFailed: boolean;
  branch: string;
  distTag: string;
  scopes: Set<string>;
}
```

**Rationale**: Follows existing pattern in `tools/scripts/artifacts/types.ts`

#### 2. Create `dist-tag-resolver.ts`

**File**: `tools/scripts/backend-package-updater/dist-tag-resolver.ts`

```typescript
export class DistTagResolver {
  /**
   * Determines the NPM dist tag based on branch name.
   *
   * @param branchName - Git branch name (e.g., "main", "release/25.4")
   * @returns NPM dist tag (e.g., "snapshot", "release-25.4")
   * @throws Error if branch pattern is unsupported
   *
   * Supported patterns:
   * - "main" or "master" → "snapshot"
   * - "release/X.Y" → "release-X.Y"
   */
  public static getDistTag(branchName: string): string {
    if (branchName === 'main' || branchName === 'master') {
      return 'snapshot';
    }

    if (branchName.startsWith('release/')) {
      // Extract version: release/25.4 → release-25.4
      const version = branchName.replace('release/', 'release-');
      return version;
    }

    throw new Error(
      `Unsupported branch pattern: ${branchName}. ` +
        `Supported patterns: main, master, release/*`
    );
  }
}
```

**Rationale**:

- Simple, explicit mapping (design decision #3)
- Fail-fast with clear error message
- Static method (no state needed)
- Follows pattern from `tools/scripts/artifacts/version.ts`

#### 3. Create `utils.ts`

**File**: `tools/scripts/backend-package-updater/utils.ts`

```typescript
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export class BackendPackageUtils {
  /**
   * Finds all assets/package.json files in the repository.
   * Uses shell glob pattern via ls command (matches existing pattern in artifacts/utils.ts:17-26)
   *
   * @returns Array of paths to package.json files (e.g., ["plugins/plugin-a/assets/package.json"])
   */
  public static findAssetsPackageJsonFiles(): string[] {
    try {
      const result = execSync(
        'find . -path "*/assets/package.json" -not -path "*/node_modules/*" -not -path "*/dist/*"'
      )
        .toString()
        .trim();

      if (!result) {
        console.log('No assets/package.json files found');
        return [];
      }

      const files = result.split('\n').filter((f) => f.length > 0);
      console.log(`Found ${files.length} assets/package.json files:`);
      files.forEach((f) => console.log(`  - ${f}`));

      return files;
    } catch (error) {
      console.error('Error finding assets/package.json files:', error);
      return [];
    }
  }

  /**
   * Extracts unique NPM scopes from package.json dependencies.
   *
   * @param packageJsonPaths - Array of paths to package.json files
   * @returns Set of scopes (e.g., Set(["@cplace-next", "@cplace-paw"]))
   */
  public static detectScopes(packageJsonPaths: string[]): Set<string> {
    const scopes = new Set<string>();

    for (const pkgPath of packageJsonPaths) {
      if (!fs.existsSync(pkgPath)) {
        console.warn(`Package.json not found: ${pkgPath}`);
        continue;
      }

      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = {
          ...pkgJson.dependencies,
          ...pkgJson.devDependencies,
        };

        for (const dep of Object.keys(deps)) {
          if (dep.startsWith('@')) {
            const scope = dep.split('/')[0]; // @cplace-next/pkg → @cplace-next
            scopes.add(scope);
          }
        }
      } catch (error) {
        console.error(`Error reading ${pkgPath}:`, error);
      }
    }

    console.log(`Detected scopes: ${Array.from(scopes).join(', ')}`);
    return scopes;
  }

  /**
   * Gets root directory of git repository.
   * Follows pattern from tools/scripts/artifacts/utils.ts:230-232
   */
  public static getRootDir(): string {
    return execSync(`git rev-parse --show-toplevel`).toString().trim();
  }

  /**
   * Writes PR description to file for consumption by workflow.
   */
  public static writePRDescription(
    description: string,
    filename: string = 'pr-description.md'
  ): void {
    const filePath = path.join(BackendPackageUtils.getRootDir(), filename);
    fs.writeFileSync(filePath, description);
    console.log(`PR description written to: ${filePath}`);
  }
}
```

**Rationale**:

- Uses `find` instead of `ls` with glob (more reliable for `**/assets` pattern)
- Follows existing utils pattern (static methods, execSync usage)
- Error handling with try-catch and console logging
- Similar to `tools/scripts/artifacts/utils.ts` structure

#### 4. Create `updater.ts`

**File**: `tools/scripts/backend-package-updater/updater.ts`

```typescript
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { UpdateResult, PackageUpdate, UpdateSummary } from './types';
import { BackendPackageUtils } from './utils';
import { DistTagResolver } from './dist-tag-resolver';

export class BackendPackageUpdater {
  /**
   * Main entry point for updating backend packages.
   * Follows pattern from tools/scripts/artifacts/artifacts-handler.ts:handle()
   *
   * @param branch - Git branch name from dispatch payload
   * @returns Update summary with results and PR description
   */
  public static async updateBackendPackages(
    branch: string
  ): Promise<UpdateSummary> {
    console.log(`\n=== Backend Package Update ===`);
    console.log(`Branch: ${branch}`);

    // 1. Find all **/assets/package.json files
    const packageJsonPaths = BackendPackageUtils.findAssetsPackageJsonFiles();

    if (packageJsonPaths.length === 0) {
      throw new Error('No assets/package.json files found in repository');
    }

    // 2. Auto-detect NPM scopes
    const scopes = BackendPackageUtils.detectScopes(packageJsonPaths);

    if (scopes.size === 0) {
      throw new Error('No scoped packages found in package.json files');
    }

    // 3. Determine dist tag
    const distTag = DistTagResolver.getDistTag(branch);
    console.log(`Using dist tag: ${distTag}`);

    // 4. Update packages in each assets folder
    const results: UpdateResult[] = [];

    for (const pkgPath of packageJsonPaths) {
      const assetsDir = path.dirname(pkgPath);
      console.log(`\n--- Processing: ${assetsDir} ---`);

      try {
        const updates = this.updatePackagesInFolder(assetsDir, scopes, distTag);
        results.push({
          path: assetsDir,
          success: true,
          updates,
        });
        console.log(`✓ Successfully updated ${updates.length} packages`);
      } catch (error: any) {
        console.error(`✗ Failed to update: ${error.message}`);
        results.push({
          path: assetsDir,
          success: false,
          error: error.message,
        });
      }
    }

    // 5. Generate PR description
    const prDescription = this.generatePRDescription(
      results,
      branch,
      distTag,
      scopes
    );

    // 6. Determine if all failed
    const allFailed = results.every((r) => !r.success);

    return {
      results,
      prDescription,
      allFailed,
      branch,
      distTag,
      scopes,
    };
  }

  /**
   * Updates packages in a single assets folder.
   * Follows error handling pattern from tools/scripts/artifacts/nx-project.ts:publish()
   *
   * @param assetsDir - Path to assets directory
   * @param scopes - Set of NPM scopes to update
   * @param distTag - NPM dist tag to install
   * @returns Array of package updates
   */
  private static updatePackagesInFolder(
    assetsDir: string,
    scopes: Set<string>,
    distTag: string
  ): PackageUpdate[] {
    const updates: PackageUpdate[] = [];
    const pkgJsonPath = path.join(assetsDir, 'package.json');

    // Verify package.json exists
    if (!fs.existsSync(pkgJsonPath)) {
      throw new Error(`package.json not found at ${pkgJsonPath}`);
    }

    // Read current versions
    const pkgJsonBefore = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    const depsBefore = {
      ...(pkgJsonBefore.dependencies || {}),
      ...(pkgJsonBefore.devDependencies || {}),
    };

    // Update packages from each scope
    for (const scope of scopes) {
      const packagesPattern = `${scope}/*@${distTag}`;
      console.log(`  Installing: ${packagesPattern}`);

      try {
        execSync(`npm install ${packagesPattern}`, {
          cwd: assetsDir,
          stdio: 'pipe', // Capture output instead of inherit
        });
      } catch (error: any) {
        // npm install exits with code 1 if packages not found
        console.warn(`  Warning: ${error.message}`);
        // Continue with other scopes instead of failing completely
      }
    }

    // Read updated versions
    const pkgJsonAfter = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    const depsAfter = {
      ...(pkgJsonAfter.dependencies || {}),
      ...(pkgJsonAfter.devDependencies || {}),
    };

    // Compare and collect changes
    for (const [pkg, newVersion] of Object.entries(depsAfter) as [
      string,
      string
    ][]) {
      const oldVersion = depsBefore[pkg];
      if (oldVersion && oldVersion !== newVersion) {
        updates.push({
          package: pkg,
          oldVersion: oldVersion as string,
          newVersion,
        });
        console.log(`  ↑ ${pkg}: ${oldVersion} → ${newVersion}`);
      }
    }

    if (updates.length === 0) {
      console.log(`  No updates (packages already at latest version)`);
    }

    return updates;
  }

  /**
   * Generates PR description from update results.
   * Follows pattern from tools/scripts/artifacts/utils.ts:writePublishedProjectToGithubCommentsFile()
   *
   * @param results - Array of update results
   * @param branch - Git branch name
   * @param distTag - NPM dist tag used
   * @param scopes - Set of scopes processed
   * @returns Markdown-formatted PR description
   */
  private static generatePRDescription(
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

    description += `---\n\n`;
    description += `🤖 Generated with [Claude Code](https://claude.com/claude-code)\n`;

    return description;
  }
}
```

**Rationale**:

- Class with static methods (no state, matches artifacts pattern)
- Continue on error pattern (design decision #6)
- Detailed console logging for debugging
- Follows existing error handling patterns from `tools/scripts/artifacts/`

#### 5. Create `main.ts`

**File**: `tools/scripts/backend-package-updater/main.ts`

```typescript
import { BackendPackageUpdater } from './updater';
import { BackendPackageUtils } from './utils';

/**
 * Entry point for backend package updater.
 * Follows pattern from tools/scripts/artifacts/main.ts
 */
async function main() {
  try {
    // Read environment variables (set by workflow)
    const branch = process.env.BRANCH || '';
    const actor = process.env.ACTOR || '';

    if (!branch) {
      console.error('ERROR: BRANCH environment variable is required');
      process.exit(1);
    }

    console.log(`Triggered by: ${actor || 'unknown'}`);

    // Execute update
    const result = await BackendPackageUpdater.updateBackendPackages(branch);

    // Write PR description to file (consumed by workflow)
    BackendPackageUtils.writePRDescription(result.prDescription);

    // Print summary
    console.log(`\n=== Summary ===`);
    console.log(`Total folders: ${result.results.length}`);
    console.log(
      `Successful: ${result.results.filter((r) => r.success).length}`
    );
    console.log(`Failed: ${result.results.filter((r) => !r.success).length}`);

    // Exit with appropriate code
    if (result.allFailed) {
      console.error('\n❌ All package updates failed');
      process.exit(1);
    }

    console.log('\n✓ Package updates completed');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
```

**Rationale**:

- Minimal entry point (follows `tools/scripts/artifacts/main.ts:1-4`)
- Environment variable validation
- Clear exit codes (0 = success, 1 = failure)
- Fatal error handling at top level

#### 6. Create Tests

**File**: `tools/scripts/backend-package-updater/dist-tag-resolver.test.ts`

```typescript
import { DistTagResolver } from './dist-tag-resolver';

describe('DistTagResolver', () => {
  describe('getDistTag', () => {
    test('returns "snapshot" for main branch', () => {
      expect(DistTagResolver.getDistTag('main')).toBe('snapshot');
    });

    test('returns "snapshot" for master branch', () => {
      expect(DistTagResolver.getDistTag('master')).toBe('snapshot');
    });

    test('converts release/25.4 to release-25.4', () => {
      expect(DistTagResolver.getDistTag('release/25.4')).toBe('release-25.4');
    });

    test('converts release/22.3 to release-22.3', () => {
      expect(DistTagResolver.getDistTag('release/22.3')).toBe('release-22.3');
    });

    test('throws error for unsupported branch pattern', () => {
      expect(() => DistTagResolver.getDistTag('feature/my-feature')).toThrow(
        'Unsupported branch pattern: feature/my-feature'
      );
    });

    test('throws error for empty string', () => {
      expect(() => DistTagResolver.getDistTag('')).toThrow(
        'Unsupported branch pattern'
      );
    });
  });
});
```

**File**: `tools/scripts/backend-package-updater/utils.test.ts`

```typescript
import { BackendPackageUtils } from './utils';
import * as child_process from 'child_process';
import * as fs from 'fs';

jest.mock('child_process');
jest.mock('fs');

describe('BackendPackageUtils', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('findAssetsPackageJsonFiles', () => {
    test('finds assets package.json files', () => {
      const mockOutput =
        'plugins/plugin-a/assets/package.json\nplugins/plugin-b/assets/package.json';
      jest
        .spyOn(child_process, 'execSync')
        .mockReturnValue(Buffer.from(mockOutput));

      const result = BackendPackageUtils.findAssetsPackageJsonFiles();

      expect(result).toEqual([
        'plugins/plugin-a/assets/package.json',
        'plugins/plugin-b/assets/package.json',
      ]);
    });

    test('returns empty array when no files found', () => {
      jest.spyOn(child_process, 'execSync').mockReturnValue(Buffer.from(''));

      const result = BackendPackageUtils.findAssetsPackageJsonFiles();

      expect(result).toEqual([]);
    });
  });

  describe('detectScopes', () => {
    test('extracts scopes from package.json dependencies', () => {
      const mockPackageJson = {
        dependencies: {
          '@cplace-next/cf-shell': '1.0.0',
          '@cplace-paw/components': '2.0.0',
          'regular-package': '3.0.0',
        },
      };

      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest
        .spyOn(fs, 'readFileSync')
        .mockReturnValue(JSON.stringify(mockPackageJson));

      const result = BackendPackageUtils.detectScopes(['test/package.json']);

      expect(result).toEqual(new Set(['@cplace-next', '@cplace-paw']));
    });

    test('handles missing package.json gracefully', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(console, 'warn').mockImplementation();

      const result = BackendPackageUtils.detectScopes(['missing/package.json']);

      expect(result.size).toBe(0);
      expect(console.warn).toHaveBeenCalled();
    });
  });
});
```

**Rationale**: Follows testing patterns from `tools/scripts/artifacts/*.test.ts`

### Success Criteria

#### Automated Verification:

- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] Tests pass: `npm test -- backend-package-updater`
- [ ] Linting passes: `npm run check-prettier`
- [ ] No import errors when running: `npx ts-node tools/scripts/backend-package-updater/main.ts`

#### Manual Verification:

- [ ] Script execution with `BRANCH=main` environment variable produces expected output
- [ ] Script correctly identifies test `**/assets/package.json` files
- [ ] Dist tag resolution works for all branch patterns
- [ ] Error handling behaves correctly (e.g., invalid branch name)

---

## Phase 3: Create Backend Workflow and Composite Action

### Overview

Create GitHub workflow that listens for repository_dispatch events and composite action that wraps TypeScript execution.

### Changes Required

#### 1. Create Composite Action

**File**: `.github/actions/backend-package-updater/action.yml`

```yaml
name: 'Backend Package Updater'
description: 'Updates frontend packages in backend repository assets folders'
runs:
  using: 'composite'
  steps:
    - run: printenv
      shell: bash
    - run: cd "$GITHUB_ACTION_PATH/../../.." && pwd && npm ci
      shell: bash
    - run: npx ts-node "$GITHUB_ACTION_PATH/../../../tools/scripts/backend-package-updater/main.ts"
      shell: bash
```

**Rationale**:

- Exact pattern from `.github/actions/artifacts/action.yml:1-12`
- No inputs (uses environment variables)
- Runs `npm ci` at repo root to install dependencies including ts-node

#### 2. Create Backend Update Workflow

**File**: `.github/workflows/be-package-update.yml`

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
        description: 'Branch to update packages on'
      actor:
        type: string
        required: true
        description: 'GitHub username who triggered the update'
    secrets:
      JFROG_BASE64_TOKEN:
        required: true
      JFROG_URL:
        required: true
      JFROG_USER:
        required: true

jobs:
  update-packages:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - name: Set variables from trigger type
        id: set-vars
        run: |
          if [ "${{ github.event_name }}" = "workflow_call" ]; then
            echo "branch=${{ inputs.branch }}" >> $GITHUB_OUTPUT
            echo "actor=${{ inputs.actor }}" >> $GITHUB_OUTPUT
          else
            # repository_dispatch
            echo "branch=${{ github.event.client_payload.branch }}" >> $GITHUB_OUTPUT
            echo "actor=${{ github.event.client_payload.actor }}" >> $GITHUB_OUTPUT
          fi
          echo "Branch: $(cat $GITHUB_OUTPUT | grep branch)"
          echo "Actor: $(cat $GITHUB_OUTPUT | grep actor)"

      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          ref: ${{ steps.set-vars.outputs.branch }}
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 22.15.0

      - name: Configure NPM Registry
        run: |
          cat > .npmrc << 'EOF'
          @${{ secrets.JFROG_USER }}:registry=${{ secrets.JFROG_URL }}
          ${{ secrets.JFROG_URL }}:_auth=${{ secrets.JFROG_BASE64_TOKEN }}
          ${{ secrets.JFROG_URL }}:always-auth=true
          EOF
          echo "NPM registry configured"

      - name: Update Frontend Packages
        uses: collaborationFactory/github-actions/.github/actions/backend-package-updater@master
        env:
          BRANCH: ${{ steps.set-vars.outputs.branch }}
          ACTOR: ${{ steps.set-vars.outputs.actor }}

      - name: Check for changes
        id: check-changes
        run: |
          if git diff --quiet; then
            echo "has_changes=false" >> $GITHUB_OUTPUT
            echo "No changes detected"
          else
            echo "has_changes=true" >> $GITHUB_OUTPUT
            echo "Changes detected"
            git status --short
          fi

      - name: Commit Changes
        if: steps.check-changes.outputs.has_changes == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          BRANCH_NAME="chore/update-frontend-packages-${{ github.run_id }}"
          git checkout -b "$BRANCH_NAME"
          git add .
          git commit -m "chore: Update frontend packages from ${{ steps.set-vars.outputs.branch }}"
          git push origin HEAD
          echo "branch_name=$BRANCH_NAME" >> $GITHUB_ENV

      - name: Create Pull Request
        if: steps.check-changes.outputs.has_changes == 'true'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          BASE_BRANCH="${{ steps.set-vars.outputs.branch }}"
          ACTOR="${{ steps.set-vars.outputs.actor }}"

          # Try to create PR with assignee
          gh pr create \
            --title "chore: Update frontend packages from $BASE_BRANCH" \
            --body-file pr-description.md \
            --head "${{ env.branch_name }}" \
            --base "$BASE_BRANCH" \
            --assignee "$ACTOR" || \
          # Fallback: create without assignee if first attempt fails
          gh pr create \
            --title "chore: Update frontend packages from $BASE_BRANCH" \
            --body-file pr-description.md \
            --head "${{ env.branch_name }}" \
            --base "$BASE_BRANCH"

      - name: No Changes Summary
        if: steps.check-changes.outputs.has_changes == 'false'
        run: |
          echo "✓ All packages are already up to date"
          echo "No PR created"
```

**Key aspects**:

- Dual trigger support (`repository_dispatch` and `workflow_call`)
- Setup job to normalize inputs from both triggers
- Check for changes before creating PR (avoids empty PRs)
- Try-catch pattern for PR assignment using `||` operator
- Uses `GITHUB_TOKEN` (automatically available with `contents: write` and `pull-requests: write`)
- `.npmrc` configuration inline (simpler than DOT_NPMRC for single workflow)

**Rationale for .npmrc configuration**:

- Backend workflow runs in backend repo (not this repo)
- Can't use composite action from this repo to configure .npmrc
- Inline configuration is clearer and more maintainable
- Matches pattern from design document

#### 3. Update root package.json Scripts

**File**: `package.json`

**Add test pattern** (line 7):

```json
{
  "scripts": {
    "test": "jest --config=./jest.config.js",
    "test:backend-updater": "jest --config=./jest.config.js backend-package-updater",
    "check-prettier": "prettier --check .",
    "write-prettier": "prettier --write ."
  }
}
```

### Success Criteria

#### Automated Verification:

- [ ] Workflow YAML is valid: `yamllint .github/workflows/be-package-update.yml`
- [ ] Action YAML is valid: `yamllint .github/actions/backend-package-updater/action.yml`
- [ ] Workflow syntax check passes in GitHub UI

#### Manual Verification:

- [ ] Workflow can be manually triggered via `workflow_call` from another workflow
- [ ] Workflow correctly extracts branch and actor from payload
- [ ] Workflow checks out correct branch
- [ ] NPM registry authentication works (check npm install logs)
- [ ] Composite action executes TypeScript script successfully
- [ ] PR is created with correct title and body
- [ ] PR assignment works (or gracefully falls back)

---

## Phase 4: Integration Testing and Documentation

### Overview

Test end-to-end integration and create documentation for setup in frontend/backend repositories.

### Testing Strategy

#### Unit Tests

Already covered in Phase 2:

- `dist-tag-resolver.test.ts` - Branch to dist tag mapping
- `utils.test.ts` - File discovery and scope detection
- `updater.test.ts` - Package update logic

#### Integration Tests (Manual)

**Test 1: Frontend to Backend Dispatch**

1. Create test backend repository with `**/assets/package.json` files
2. Add `.github/workflows/frontend-package-update.yml` calling `be-package-update.yml`
3. Trigger `fe-snapshot.yml` with `BACKEND_REPO` input
4. Verify dispatch event reaches backend
5. Verify backend workflow executes

**Test 2: Package Updates**

1. Backend workflow runs on test repository
2. Verify all `**/assets/package.json` files are discovered
3. Verify scopes are auto-detected
4. Verify npm install executes in each assets folder
5. Verify package-lock.json is updated

**Test 3: PR Creation**

1. Verify branch is created with changes
2. Verify PR is created with correct title
3. Verify PR body contains detailed summary
4. Verify PR is assigned to triggering user

**Test 4: Error Handling**

1. Test with invalid branch name (should fail with clear error)
2. Test with missing package in registry (should continue with warning)
3. Test with one failed assets folder (should continue with others)
4. Test when all updates fail (workflow should fail)

**Test 5: Edge Cases**

1. Test with no changes needed (all packages up to date)
2. Test with empty `**/assets` folders
3. Test with no scoped packages in package.json
4. Test with permission error on PR assignment

### Documentation

#### 1. Create Setup Guide for Backend Repositories

**File**: Create `docs/backend-setup.md` (not in implementation plan scope, mentioned for completeness)

Content:

- How to add workflow file to backend repository
- Required secrets configuration
- Example workflow file
- Troubleshooting guide

#### 2. Create Setup Guide for Frontend Repositories

**File**: Create `docs/frontend-setup.md` (not in implementation plan scope, mentioned for completeness)

Content:

- How to add `BACKEND_REPO` input to workflow calls
- How to configure organization PAT
- Example workflow modifications
- Troubleshooting guide

#### 3. Update Existing Documentation

Update any existing README or docs that reference frontend workflows to mention new backend integration capability.

### Success Criteria

#### Automated Verification:

- [ ] All unit tests pass: `npm test`
- [ ] TypeScript compilation succeeds: `npx tsc --noEmit`
- [ ] Prettier formatting passes: `npm run check-prettier`

#### Manual Verification:

- [ ] End-to-end test: Frontend publish → Backend dispatch → PR created
- [ ] PR contains accurate package version changes
- [ ] PR description is well-formatted and informative
- [ ] Error scenarios handled gracefully with clear messages
- [ ] No false positives (empty PRs, incorrect updates, etc.)
- [ ] Performance acceptable (completes within 5 minutes for typical backend repo)

---

## Testing Strategy

### Unit Tests

**Location**: `tools/scripts/backend-package-updater/*.test.ts`

**What to test**:

- Dist tag resolution for all branch patterns
- Scope detection from package.json
- File discovery with various directory structures
- PR description generation with different result combinations
- Error handling for missing files, invalid JSON, etc.

**Test pattern** (following `tools/scripts/artifacts/*.test.ts`):

```typescript
describe('ClassName', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test('description', () => {
    // Arrange: Mock file system, execSync
    jest.spyOn(fs, 'readFileSync').mockReturnValue('...');

    // Act: Call method
    const result = method();

    // Assert: Verify result
    expect(result).toBe(expected);
  });
});
```

### Integration Tests

**Manual testing checklist**:

1. **Test in development environment first**:

   - Fork backend repo for testing
   - Add test workflow file
   - Manually trigger with test payloads

2. **Test all branch patterns**:

   - `main` → snapshot
   - `master` → snapshot
   - `release/25.4` → release-25.4
   - Invalid branch → clear error

3. **Test error scenarios**:

   - Missing package in registry
   - One folder fails, others succeed
   - All folders fail
   - No scoped packages found

4. **Test PR creation**:
   - With valid assignee
   - With invalid assignee (no permission)
   - With no changes (should not create PR)

### Performance Testing

**Target**: Complete workflow in < 5 minutes for backend repo with 20 assets folders

**Measure**:

- Time to discover all package.json files
- Time per assets folder for npm install
- Total workflow execution time

**Optimization if needed**:

- Parallel npm install (future enhancement)
- Caching of npm registry queries

---

## Performance Considerations

### Expected Performance

**Typical backend repo** (10 assets folders, 5 scoped packages each):

- File discovery: < 5 seconds
- Scope detection: < 5 seconds
- npm install per folder: 30-60 seconds (depends on network, cache)
- Total npm installs: 5-10 minutes
- PR creation: < 10 seconds
- **Total: 5-10 minutes** (within target)

### Potential Bottlenecks

1. **NPM install is sequential**: Currently updates one folder at a time

   - Mitigation: Acceptable for v1, can parallelize in future

2. **Network latency to JFrog**: Multiple registry queries

   - Mitigation: npm caches locally, subsequent installs faster

3. **Large number of assets folders**: Linear time increase
   - Mitigation: Typical repos have 5-20 folders, still under 10 minutes

### Optimizations (Future Enhancements, Out of Scope)

1. Parallel npm install using Promise.all()
2. Batch npm install commands
3. Cache npm packages between workflow runs
4. Only update packages that have new versions (pre-check registry)

---

## Migration Notes

### Organization Setup

1. **Create organization PAT**:

   - Go to GitHub Organization Settings → Developer settings → Personal access tokens
   - Create fine-grained token with:
     - Name: "Cross-Repo Workflow Dispatch"
     - Expiration: 1 year
     - Repository access: All repositories (or specific ones)
     - Permissions: `contents: read`, `metadata: read`, `actions: write`
   - Copy token value

2. **Add organization secret**:

   - Go to Organization Settings → Secrets and variables → Actions
   - New organization secret:
     - Name: `CROSS_REPO_PAT`
     - Value: (paste token)
     - Repository access: All repositories

3. **Document token expiration**:
   - Add calendar reminder for token renewal
   - Document renewal process
   - Consider GitHub App for auto-expiring tokens (future)

### Frontend Repository Setup

**For each frontend repository** (cplace-fe, cplace-paw-fe):

1. Update workflow file that calls `fe-snapshot.yml`:

   ```yaml
   jobs:
     snapshot:
       uses: collaborationFactory/github-actions/.github/workflows/fe-snapshot.yml@master
       with:
         GHA_REF: ${{ github.ref }}
         GHA_BASE: main
         BACKEND_REPO: main # ← ADD THIS
       secrets:
         JFROG_BASE64_TOKEN: ${{ secrets.JFROG_BASE64_TOKEN }}
         JFROG_URL: ${{ secrets.JFROG_URL }}
         JFROG_USER: ${{ secrets.JFROG_USER }}
         CROSS_REPO_PAT: ${{ secrets.CROSS_REPO_PAT }} # ← ADD THIS
   ```

2. Same for `fe-release.yml` calls

### Backend Repository Setup

**For each backend repository** (main, cplace-paw):

1. Create `.github/workflows/frontend-package-update.yml`:

   ```yaml
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

2. Ensure JFrog secrets exist in repository settings

3. No additional configuration needed (scopes auto-detected)

### Rollback Plan

If issues occur:

1. **Disable dispatch in frontend workflows**:

   - Remove `BACKEND_REPO` input from workflow calls
   - Existing workflows continue working normally

2. **Disable backend workflows**:

   - Delete or rename `.github/workflows/frontend-package-update.yml`
   - No automatic updates, manual process resumes

3. **Revert code changes**:
   - Frontend workflows: Revert commits adding dispatch step
   - Backend workflow: Delete file
   - TypeScript scripts: Delete directory

---

## References

- **Original Design:** `/Users/slavenkopic/Desktop/cplace-dev/repos/github-actions/thoughts/shared/designs/backend-frontend-package-automation.md`
- **Related Research:** `/Users/slavenkopic/Desktop/cplace-dev/repos/github-actions/thoughts/shared/research/2025-11-26_13-58-35_frontend-package-publishing-and-backend-installation.md`
- **Existing Patterns:**
  - Artifacts scripts: `tools/scripts/artifacts/`
  - Composite actions: `.github/actions/artifacts/action.yml`
  - Frontend workflows: `.github/workflows/fe-snapshot.yml`, `.github/workflows/fe-release.yml`
- **GitHub Documentation:**
  - Repository Dispatch: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#repository_dispatch
  - Reusable Workflows: https://docs.github.com/en/actions/using-workflows/reusing-workflows
  - PAT Authentication: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
