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
