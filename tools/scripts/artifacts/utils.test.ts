import { expect } from '@jest/globals';
import * as child_process from 'child_process';
import * as fs from 'fs';

import { NxProject, NxProjectKind } from './nx-project';
import { Version } from './version';
import { Utils } from './utils';
import {
  affectedApps,
  affectedLibs,
  app1,
  app2,
  base,
  packageJsonLib1,
} from './test-data';

afterEach(() => {
  jest.resetAllMocks();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

export const gitLs =
  'c6637326f959043a46715878d042215c73ca0e3a        refs/tags/version/22.2.0\n' +
  'b7c7a52344261a29883aa69a5be65d1989cdfae7        refs/tags/version/22.3.0\n' +
  '191db45d26d03f1cbaae77a9074wedd4331d36ad        refs/tags/version/5.18.120\n' +
  'b1b0415ded0aeab1f1874b9da2fb41cec5e6a88a        refs/tags/version/5.18.0\n' +
  'f379d2352cf41a9e471c8029db88aas68a514088        refs/tags/version/5.18.1\n' +
  '337cac8d5252b85338f0eb658b6b29b9627c2f69        refs/tags/version/5.20.12\n';
export const sdk = 'cf-frontend-sdk';
export const core = 'cf-core-lib';

const rootDir = child_process
  .execSync(`git rev-parse --show-toplevel`)
  .toString()
  .trim();

beforeEach(() => {
  const mockedDate = new Date(2023, 0, 1);
  jest.useFakeTimers("modern");
  jest.setSystemTime(mockedDate);
});

afterEach(() => {
  jest.useRealTimers();
});

test('can parse and order version tags ', async () => {
  jest.spyOn(child_process, 'execSync').mockReturnValue(Buffer.from(rootDir));
  jest.spyOn(child_process, 'execSync').mockReturnValue(Buffer.from(gitLs));

  const versions: Version[] = Utils.getAllVersionTagsInAscendingOrder();

  expect(versions[0].toString()).toBe('5.18.0');
  expect(versions[1].toString()).toBe('5.18.1');
  expect(versions[2].toString()).toBe('5.18.120');
  expect(versions[3].toString()).toBe('5.20.12');
  expect(versions[4].toString()).toBe('22.2.0');
  expect(versions[5].toString()).toBe('22.3.0');
});

test('can look for latest Tag for a given Release Branch Name ', async () => {
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(Buffer.from(rootDir));
  jest.spyOn(child_process, 'execSync').mockReturnValueOnce(Buffer.from(gitLs));

  const version: Version = Utils.getLatestTagForReleaseBranch(
    'release/5.18',
    new Version('5.18.0')
  );
  expect(version.toString()).toBe('5.18.120');
});

test('can find all projects without e2e projects', async () => {
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(Buffer.from(affectedLibs))
    .mockReturnValueOnce(Buffer.from(affectedApps));
  jest.spyOn(fs, 'existsSync').mockReturnValue(true).mockReturnValue(true);
  jest
    .spyOn(fs, 'readFileSync')
    .mockReturnValueOnce('{}')
    .mockReturnValueOnce(packageJsonLib1);

  const nxProjects: NxProject[] = Utils.getAllNxProjects();
  expect(nxProjects).toHaveLength(4);
  expect(nxProjects[0].name).toBe(core);
  expect(nxProjects[1].name).toBe(sdk);
});

test('can parse affected ', async () => {
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(Buffer.from(affectedApps));
  const apps = Utils.getAffectedNxProjects(base, NxProjectKind.Application);
  expect(apps).toHaveLength(2);
  expect(apps[0].name).toBe(app1);
  expect(apps[1].name).toBe(app2);
});

test('can parse affected in case there is none', async () => {
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(Buffer.from(''))
    .mockReturnValueOnce(Buffer.from(''));
  const apps = Utils.getAffectedNxProjects(base, NxProjectKind.Application);
  expect(apps).toHaveLength(0);
});

test('can get all versions of a npm package', async () => {
  const versionsFromNPM =
    '{\n' +
    '    "versions": [\n' +
    '    "0.0.0-SNAPSHOT",\n' +
    '    "0.0.0-SNAPSHOT-l3a5ltgi-20220517",\n' +
    '    "0.0.0-SNAPSHOT-l3a697ku-20220517",\n' +
    '    "0.0.0-feature-PFM-ISSUE-9268-Move-core-utils-to-cf-front-425",\n' +
    '    "0.0.0-feature-PFM-ISSUE-9270-Create-cf-frontend-shell-ap-449",\n' +
    '    "22.3.2",\n' +
    '    "22.3.3",\n' +
    '    "22.3.4",\n' +
    '    "22.3.5",\n' +
    '    "22.3.6",\n' +
    '    "22.3.7",\n' +
    '    "22.3.8",\n' +
    '    "22.3.9"\n' +
    '  ]\n' +
    '  }';
  jest.spyOn(JSON, 'parse').mockReturnValueOnce(JSON.parse(versionsFromNPM));
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(Buffer.from(versionsFromNPM));
  const snapshots = Utils.getAllSnapshotVersionsOfPackage(
    'cf-frontend-sdk',
    '',
    'scope'
  );
  expect(snapshots).toHaveLength(3);
});

test('can create comments for github actions', () => {
  jest.spyOn(Utils, 'getRootDir').mockReturnValue(rootDir);
  const gitHubCommentsFile = Utils.GITHUB_COMMENTS_FILE;
  if (fs.existsSync(gitHubCommentsFile)) fs.rmSync(gitHubCommentsFile);
  Utils.initGithubActionsFile();
  Utils.writePublishedProjectToGithubCommentsFile(
    '@cplace-next/cf-platform@0.0.0-feat-PFM-ISSUE-10014-Notify-the-developer-about-th-488'
  );
  Utils.writePublishedProjectToGithubCommentsFile(
    '@cplace-next/cf-platform@0.0.0-SNAPSHOT-l484devc-20220610'
  );
  let comments = '';
  if (fs.existsSync(gitHubCommentsFile))
    comments = fs.readFileSync(gitHubCommentsFile).toString();
  expect(comments).toBe(
    ':tada: Snapshots of the following projects have been published: \n' +
      '@cplace-next/cf-platform@0.0.0-feat-PFM-ISSUE-10014-Notify-the-developer-about-th-488\n' +
      '@cplace-next/cf-platform@0.0.0-SNAPSHOT-l484devc-20220610\n'
  );
});

test('parseScopeFromPackageJson can parse scope from packageJson', () => {
  const spy = jest
    .spyOn(JSON, 'parse')
    .mockReturnValueOnce(JSON.parse(packageJsonLib1));
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(Buffer.from(rootDir));
  const result = Utils.parseScopeFromPackageJson();
  expect(spy).toHaveBeenCalled();
  expect(result).toBe('@cplace-frontend-applications');
});

test('parseScopeFromPackageJson throws an error if no scope is given in packageJson', () => {
  jest
    .spyOn(fs, 'readFileSync')
    .mockReturnValueOnce(
      packageJsonLib1.replace('@cplace-frontend-applications/', '')
    );
  jest.spyOn(Utils, 'getRootDir').mockReturnValueOnce(rootDir);
  const mockExit = jest.spyOn(process, 'exit').mockImplementation((number) => {
    throw new Error('process.exit: ' + number);
  });
  expect(() => {
    Utils.parseScopeFromPackageJson();
  }).toThrow();
  expect(mockExit).toHaveBeenCalledWith(1);
});

test('can bump version correctly for a release Branch with no existing tag', () => {
  jest
    .spyOn(Utils, 'getLatestTagForReleaseBranch')
    .mockReturnValueOnce(new Version(''));
  const version = Utils.calculateNewVersion('release/22.4');
  expect(version).toStrictEqual(new Version('22.4.1'));
});

test('can bump version correctly for a release Branch with existing tag', () => {
  jest
    .spyOn(Utils, 'getLatestTagForReleaseBranch')
    .mockReturnValueOnce(new Version('22.4.12'));
  const version = Utils.calculateNewVersion('release/22.4');
  expect(version).toStrictEqual(new Version('22.4.13'));
});

test('can create hashed timestamp correctly formatted', () => {
  const timestamp = Utils.getHashedTimestamp();
  expect(timestamp).toEqual('lccjqzk0-20230101');
});
