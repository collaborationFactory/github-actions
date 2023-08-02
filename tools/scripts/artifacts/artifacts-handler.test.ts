import { expect } from '@jest/globals';
import * as child_process from 'child_process';
import * as fs from 'fs';
import { ArtifactsHandler } from './artifacts-handler';
import { NxProject } from './nx-project';
import { Utils } from './utils';
import {
  affectedApps,
  affectedLibs,
  app1,
  app2,
  appsDir,
  base,
  lib1,
  lib2,
  libsDir,
  npmrc,
  packageJsonLib2,
} from './test-data';

export const SNAPSHOT_VERSION = ArtifactsHandler.SNAPSHOT_VERSION + '-SNAPSHOT';

process.env.JFROG_BASE64_TOKEN = 'jfrog_base64_token';
process.env.JFROG_URL = 'jfrog_url';
process.env.JFROG_USER = 'jfrog_user';
let deleteArtifactSpy: jest.SpyInstance<any, unknown[]>;
let deleteSnapshotsSpy: jest.SpyInstance<any, unknown[]>;

afterEach(() => {
  jest.resetAllMocks();
  jest.clearAllMocks();
  jest.restoreAllMocks();
  process.env.ONLY_BUMP_VERSION = 'false';
  process.env.ONLY_DELETE_ARTIFACTS = 'false';
  process.env.TAG = '';
  process.env.BASE = '';
  process.env.PR_NUMBER = '';
  process.env.GITHUB_EVENT_NAME = '';
  process.env.GITHUB_HEAD_REF = '';
  process.env.GITHUB_REF_NAME = '';
});

test('can create and overwrite Snapshots for a Pull Request', async () => {
  process.env.BASE = 'main';
  process.env.PR_NUMBER = '222';
  process.env.GITHUB_EVENT_NAME = Utils.PULL_REQUEST;
  process.env.GITHUB_HEAD_REF = 'feat/PFM-ISSUE-543-another-feature';

  const artifactHandler = await exec();

  const version = `${ArtifactsHandler.SNAPSHOT_VERSION}-feat-PFM-ISSUE-543-another-feature-222`;
  expect(artifactHandler.projects).toHaveLength(4);
  expect(artifactHandler.currentVersion.toString()).toBe(version);
  expect(artifactHandler.isSnapshot).toBe(true);
  expect(deleteArtifactSpy).toBeCalledTimes(3);
  expect(artifactHandler.base).toBe('origin/main');
  expect(artifactHandler.projects[0].getPrettyPackageJson()).toContain(version);
  expect(artifactHandler.projects[1].getPrettyPackageJson()).toContain(version);
  expect(
    JSON.parse(artifactHandler.projects[2].getPrettyPackageJson()).version
  ).toBe(undefined);
  expect(
    JSON.parse(artifactHandler.projects[3].getPrettyPackageJson()).version
  ).toBe(version);
  expect(
    JSON.parse(artifactHandler.projects[2].getPrettyPackageJson()).publishable
  ).toBe(undefined);
  expect(
    JSON.parse(artifactHandler.projects[3].getPrettyPackageJson()).publishable
  ).toBe(true);
  expect(
    JSON.parse(artifactHandler.projects[2].getPrettyPackageJson())
      .peerDependencies
  ).toBe(undefined);
  expect(
    JSON.parse(artifactHandler.projects[3].getPrettyPackageJson())
      .peerDependencies
  ).not.toBe(undefined);
  expect(
    JSON.parse(artifactHandler.projects[0].getPrettyPackageJson()).publishConfig
      .tag
  ).toBe('latest-pr-snapshot');
  expect(
    JSON.parse(artifactHandler.projects[1].getPrettyPackageJson()).publishConfig
      .tag
  ).toBe('latest-pr-snapshot');
  expect(
    JSON.parse(artifactHandler.projects[2].getPrettyPackageJson()).publishConfig
  ).toBe(undefined);
  expect(
    JSON.parse(artifactHandler.projects[3].getPrettyPackageJson()).publishConfig
      .tag
  ).toBe('latest-pr-snapshot');
});

test('can delete artifacts when a Pull Request is closed', async () => {
  process.env.BASE = 'main';
  process.env.PR_NUMBER = '222';
  process.env.ONLY_DELETE_ARTIFACTS = 'true';
  process.env.GITHUB_EVENT_NAME = Utils.PULL_REQUEST;
  process.env.GITHUB_HEAD_REF = 'feat/PFM-ISSUE-543-another-feature';

  const artifactHandler = await exec();

  const version = '0.0.0-feat-PFM-ISSUE-543-another-feature-222';
  expect(artifactHandler.projects).toHaveLength(4);
  expect(artifactHandler.currentVersion.toString()).toBe(version);
  expect(artifactHandler.isSnapshot).toBe(true);
  expect(deleteArtifactSpy).toBeCalledTimes(3);
  expect(artifactHandler.projects[0].npmrcContent).toBe('');
  expect(artifactHandler.projects[1].npmrcContent).toBe('');
  expect(artifactHandler.projects[0].getPrettyPackageJson()).toBe('{}');
  expect(artifactHandler.projects[1].getPrettyPackageJson()).toBe('{}');
});

test('can remove unallowed characters from branch name ', async () => {
  process.env.PR_NUMBER = '419';
  process.env.GITHUB_EVENT_NAME = Utils.PULL_REQUEST;
  process.env.GITHUB_HEAD_REF =
    'feat/PFM-ISSUE-9758-Allow_SNAPSHOT_versions_for_publishable_libraries';

  const artifactHandler = await exec();

  expect(artifactHandler.currentVersion.toString()).toBe(
    ArtifactsHandler.SNAPSHOT_VERSION +
      '-feat-PFM-ISSUE-9758-Allow-SNAPSHOT-versions-for-pu-419'
  );
});

test('can create and overwrite Snapshots in main branch', async () => {
  jest
    .spyOn(Utils, 'getCurrentBranchNameFromGithubEnv')
    .mockReturnValueOnce('main');
  process.env.SNAPSHOT = 'true';
  process.env.BASE = base;
  process.env.GITHUB_REF_NAME = 'main';

  const artifactHandler = await exec();

  expect(artifactHandler.projects).toHaveLength(4);
  expect(artifactHandler.isSnapshot).toBe(true);
  expect(artifactHandler.currentVersion.toString()).toContain(SNAPSHOT_VERSION);
  expect(artifactHandler.projects[0].name).toBe(app1);
  expect(artifactHandler.projects[1].name).toBe(app2);
  expect(artifactHandler.projects[2].name).toBe(lib1);
  expect(artifactHandler.projects[3].name).toBe(lib2);
  expect(artifactHandler.projects[0].getPathToProjectInDist()).toContain(
    `dist/apps/${app1}`
  );
  expect(artifactHandler.projects[1].getPathToProjectInDist()).toContain(
    `dist/apps/${app2}`
  );
  expect(artifactHandler.projects[2].getPathToProjectInDist()).toContain(
    `dist/libs/${lib1}`
  );
  expect(artifactHandler.projects[3].getPathToProjectInDist()).toContain(
    `dist/libs/${lib2}`
  );
  expect(artifactHandler.projects[0].npmrcContent).toBe(npmrc);
  expect(artifactHandler.projects[1].npmrcContent).toBe(npmrc);
  expect(artifactHandler.projects[0].getPrettyPackageJson()).toContain(
    SNAPSHOT_VERSION
  );
  expect(artifactHandler.projects[1].getPrettyPackageJson()).toContain(
    SNAPSHOT_VERSION
  );
  expect(
    JSON.parse(artifactHandler.projects[2].getPrettyPackageJson()).version
  ).toBe(undefined);
  expect(
    JSON.parse(artifactHandler.projects[3].getPrettyPackageJson()).version
  ).toContain(SNAPSHOT_VERSION);
  expect(
    JSON.parse(artifactHandler.projects[2].getPrettyPackageJson()).publishable
  ).toBe(undefined);
  expect(
    JSON.parse(artifactHandler.projects[3].getPrettyPackageJson()).publishable
  ).toBe(true);
  expect(
    JSON.parse(artifactHandler.projects[2].getPrettyPackageJson())
      .peerDependencies
  ).toBe(undefined);
  expect(
    JSON.parse(artifactHandler.projects[3].getPrettyPackageJson())
      .peerDependencies
  ).not.toBe(undefined);
  expect(
    JSON.parse(artifactHandler.projects[0].getPrettyPackageJson()).publishConfig
      .tag
  ).toBe('snapshot');
  expect(
    JSON.parse(artifactHandler.projects[1].getPrettyPackageJson()).publishConfig
      .tag
  ).toBe('snapshot');
  expect(
    JSON.parse(artifactHandler.projects[2].getPrettyPackageJson()).publishConfig
  ).toBe(undefined);
  expect(
    JSON.parse(artifactHandler.projects[3].getPrettyPackageJson()).publishConfig
      .tag
  ).toBe('snapshot');
});

async function exec() {
  jest
    .spyOn(Utils, 'parseScopeFromPackageJson')
    .mockReturnValueOnce('@cplace-frontend-applications');
  jest.spyOn(Utils, 'initGithubActionsFile').mockReturnValue();
  jest
    .spyOn(Utils, 'writePublishedProjectToGithubCommentsFile')
    .mockReturnValue();

  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(Buffer.from(affectedApps))
    .mockReturnValueOnce(Buffer.from(affectedApps))
    .mockReturnValueOnce(Buffer.from(affectedLibs))
    .mockReturnValueOnce(Buffer.from(affectedLibs))
    .mockReturnValueOnce(Buffer.from(`built ${app1}`))
    .mockReturnValueOnce(Buffer.from(`published ${app1}`))
    .mockReturnValueOnce(Buffer.from(`built ${app2}`))
    .mockReturnValueOnce(Buffer.from(`published ${app2}`))
    .mockReturnValueOnce(Buffer.from(`built ${lib1}`))
    .mockReturnValueOnce(Buffer.from(`published ${lib1}`))
    .mockReturnValueOnce(Buffer.from(`built ${lib2}`))
    .mockReturnValueOnce(Buffer.from(''))
    .mockReturnValueOnce(Buffer.from(''))
    .mockReturnValueOnce(Buffer.from(''))
    .mockReturnValueOnce(Buffer.from(''));

  const artifactHandler = new ArtifactsHandler();

  jest.spyOn(fs, 'writeFileSync').mockReturnValue();
  jest.spyOn(fs, 'copyFileSync').mockReturnValue();
  jest
    .spyOn(fs, 'readFileSync')
    .mockReturnValueOnce(packageJsonLib2)
    .mockReturnValueOnce(packageJsonLib2);
  jest
    .spyOn(fs, 'existsSync')
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(true);

  jest
    .spyOn(fs, 'readdirSync')
    .mockReturnValueOnce(appsDir)
    .mockReturnValueOnce(appsDir)
    .mockReturnValueOnce(libsDir)
    .mockReturnValueOnce(libsDir);

  deleteArtifactSpy = jest
    .spyOn(NxProject.prototype as any, 'deleteArtifact')
    .mockReturnValue(Promise.resolve());
  deleteSnapshotsSpy = jest
    .spyOn(NxProject.prototype as any, 'deleteSnapshots')
    .mockReturnValue(Promise.resolve());
  await artifactHandler.handle();
  return artifactHandler;
}
