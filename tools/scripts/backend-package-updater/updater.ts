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
    for (const scope of Array.from(scopes)) {
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
