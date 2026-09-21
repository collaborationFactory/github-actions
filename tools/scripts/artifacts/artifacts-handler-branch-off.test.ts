import { expect } from '@jest/globals';
import * as child_process from 'child_process';
import { ArtifactsHandler } from './artifacts-handler';
import { Utils } from './utils';

process.env.JFROG_BASE64_TOKEN = 'jfrog_base64_token';
process.env.JFROG_URL = 'jfrog_url';
process.env.JFROG_USER = 'jfrog_user';

afterEach(() => {
  jest.resetAllMocks();
  jest.clearAllMocks();
  process.env.ONLY_BUMP_VERSION = 'false';
  process.env.ONLY_DELETE_ARTIFACTS = 'false';
  process.env.TAG = '';
  process.env.BASE = '';
  process.env.PR_NUMBER = '';
});

test('on a [branch-off] tip commit nothing is built, tagged or published', async () => {
  mockHandlerDependencies(true);
  const affectedProjectsMock = jest
    .spyOn(Utils, 'getAffectedNxProjects')
    .mockReturnValue([]);

  await new ArtifactsHandler().handle();

  expect(affectedProjectsMock).not.toBeCalled();
});

test('the comments file is still created on a [branch-off] tip commit', async () => {
  const initFileMock = mockHandlerDependencies(true);

  await new ArtifactsHandler().handle();

  // fe-pr-snapshot.yml reads githubCommentsForPR.txt unconditionally; without
  // this the comment step fails with ENOENT.
  expect(initFileMock).toBeCalledTimes(1);
});

test('artifact deletion still runs on a [branch-off] tip commit', async () => {
  process.env.ONLY_DELETE_ARTIFACTS = 'true';
  mockHandlerDependencies(true);
  const affectedProjectsMock = jest
    .spyOn(Utils, 'getAffectedNxProjects')
    .mockReturnValue([]);

  await new ArtifactsHandler().handle();

  expect(affectedProjectsMock).toBeCalled();
});

test('a regular tip commit is built and published as before', async () => {
  mockHandlerDependencies(false);
  const affectedProjectsMock = jest
    .spyOn(Utils, 'getAffectedNxProjects')
    .mockReturnValue([]);

  await new ArtifactsHandler().handle();

  expect(affectedProjectsMock).toBeCalled();
});

function mockHandlerDependencies(isBranchOff: boolean) {
  jest.spyOn(child_process, 'execSync').mockReturnValue(Buffer.from(''));
  jest
    .spyOn(Utils, 'getCurrentBranchNameFromGithubEnv')
    .mockReturnValue('feature/PFM-ISSUE-1234-some-work');
  jest
    .spyOn(Utils, 'parseScopeFromPackageJson')
    .mockReturnValue('@cplace-frontend-applications');
  jest.spyOn(Utils, 'isBranchOffCommit').mockReturnValue(isBranchOff);
  return jest.spyOn(Utils, 'initGithubActionsFile').mockReturnValue();
}
