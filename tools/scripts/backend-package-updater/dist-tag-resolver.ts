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
    if (branchName.startsWith('release/')) {
      // Extract version: release/25.4 → release-25.4
      return branchName.replace('release/', 'release-');
    }

    return 'snapshot';
  }
}
