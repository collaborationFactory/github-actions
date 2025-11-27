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
