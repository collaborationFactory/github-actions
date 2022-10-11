import { expect } from '@jest/globals';
import * as child_process from 'child_process';
import { execSync } from 'child_process';
import { ArtifactsHandler } from './artifacts-handler';
import { NxProject, NxProjectKind } from './nx-project';
import { Utils } from './utils';
import { gitLs } from './utils.test';

process.env.JFROG_BASE64_TOKEN = 'jfrog_base64_token';
process.env.JFROG_URL = 'jfrog_url';
process.env.JFROG_USER = 'jfrog_user';

const rootDir = execSync(`git rev-parse --show-toplevel`).toString().trim();

afterEach(() => {
  jest.resetAllMocks();
  jest.clearAllMocks();
  process.env.ONLY_BUMP_VERSION = 'false';
  process.env.ONLY_DELETE_ARTIFACTS = 'false';
  process.env.TAG = '';
  process.env.BASE = '';
  process.env.PR_NUMBER = '';
});

test('can find latest version Tag of a given branch and bump the version', async () => {
  process.env.ONLY_BUMP_VERSION = 'true';
  mockProjects();
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(Buffer.from(gitLs))
    .mockReturnValueOnce(Buffer.from(`formatted successfully`))
    .mockReturnValueOnce(Buffer.from(`added successfully`))
    .mockReturnValueOnce(Buffer.from(`committed successfully`))
    .mockReturnValueOnce(Buffer.from(`tagged successfully`))
    .mockReturnValueOnce(Buffer.from(`pushed successfully`));
  jest
    .spyOn(Utils, 'getCurrentBranchNameFromGithubEnv')
    .mockReturnValueOnce('release/5.18');
  jest
    .spyOn(Utils, 'parseScopeFromPackageJson')
    .mockReturnValueOnce('@cplace-frontend-applications');

  const artifactHandler = new ArtifactsHandler();
  await artifactHandler.handle();
  expect(artifactHandler.calculatedNewVersion.getGitTag()).toBe(
    'version/5.18.121'
  );
});

test('can create a release tag in case release branch is pushed for the first time', async () => {
  process.env.ONLY_BUMP_VERSION = 'true';
  mockProjects();
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(Buffer.from(''))
    .mockReturnValueOnce(Buffer.from(`formatted successfully`))
    .mockReturnValueOnce(Buffer.from(`added successfully`))
    .mockReturnValueOnce(Buffer.from(`committed successfully`))
    .mockReturnValueOnce(Buffer.from(`tagged successfully`))
    .mockReturnValueOnce(Buffer.from(`pushed successfully`));
  jest
    .spyOn(Utils, 'getCurrentBranchNameFromGithubEnv')
    .mockReturnValueOnce('release/22.20');
  jest
    .spyOn(Utils, 'parseScopeFromPackageJson')
    .mockReturnValueOnce('@cplace-frontend-applications');

  const artifactHandler = new ArtifactsHandler();
  await artifactHandler.handle();
  expect(artifactHandler.calculatedNewVersion.getGitTag()).toBe(
    'version/22.20.1'
  );
});

test('on Tag pushed for a new minor release all projects should be published', async () => {
  process.env.TAG = `${ArtifactsHandler.VERSION_PREFIX}5.18.0`;
  await onMinorOrPatchTag();
});

test('on Tag pushed for a new patch release all projects should be published', async () => {
  process.env.TAG = `${ArtifactsHandler.VERSION_PREFIX}5.18.120`;
  await onMinorOrPatchTag();
});

async function onMinorOrPatchTag() {
  jest.spyOn(child_process, 'execSync').mockReturnValue(Buffer.from(''));
  const getProjectsMock = jest
    .spyOn(Utils, 'getAllNxProjects')
    .mockReturnValueOnce([]);
  jest
    .spyOn(Utils, 'getCurrentBranchNameFromGithubEnv')
    .mockReturnValueOnce('release/5.18');
  jest
    .spyOn(Utils, 'parseScopeFromPackageJson')
    .mockReturnValueOnce('@cplace-frontend-applications');

  const artifactHandler = new ArtifactsHandler();
  await artifactHandler.handle();
  expect(artifactHandler.onlyAffected).toBe(false);
  expect(getProjectsMock).toBeCalledTimes(1);
}

function mockProjects() {
  jest
    .spyOn(Utils, 'getAffectedNxProjects')
    .mockReturnValueOnce([new NxProject('lib a', NxProjectKind.Library)])
    .mockReturnValueOnce([new NxProject('lib b', NxProjectKind.Library)]);
  jest
    .spyOn(Utils, 'getAllNxProjects')
    .mockReturnValueOnce([new NxProject('lib a', NxProjectKind.Library)]);
  jest.spyOn(Utils, 'initGithubActionsFile').mockReturnValue();
  jest.spyOn(Utils, 'getRootDir').mockReturnValue(rootDir);
}
