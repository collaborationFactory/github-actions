import { ArtifactsHandler } from './artifacts-handler';
import { Utils } from './utils';

// cf-devkit's branch-off bumps versions and publishes the artifacts locally, and
// marks every commit it creates. Tagging and publishing such a commit from CI
// would re-release what branch-off already released.
if (Utils.isBranchOffCommit()) {
  console.log(
    `Tip commit is marked with ${Utils.BRANCH_OFF_MARKER}, skipping tagging and publishing`
  );
} else {
  new ArtifactsHandler().handle();
}
