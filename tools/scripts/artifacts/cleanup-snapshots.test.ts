import * as child_process from 'child_process';
import { expect } from '@jest/globals';
import { CleanupSnapshots } from './cleanup-snapshots';
import { npmSearchResult, npmViewResult } from './test-data';
import { Utils } from './utils';

beforeEach(() => {
  jest.resetAllMocks();
  jest.clearAllMocks();
});

afterEach(() => {
  delete process.env.JFROG_URL;
  delete process.env.JFROG_TOKEN;
});

test('can find latest version Tag of a given branch and bump the version', async () => {
  const spy = jest.spyOn(Utils, 'parseScopeFromPackageJson');
  spy.mockReturnValue('@cplace-next');
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(npmSearchResult)
    .mockReturnValue(npmViewResult);
  jest.useFakeTimers().setSystemTime(new Date('2023-05-22'));
  process.env.JFROG_URL = 'jfrog_url';
  process.env.JFROG_TOKEN = 'jfrog_token';
  const cleanupSnaps = new CleanupSnapshots();
  await cleanupSnaps.deleteSuperfluousArtifacts();
  expect(cleanupSnaps.npmSearchResults[0].versions.length).toBe(4);
});

test('refuses to delete snapshots without JFrog credentials', async () => {
  jest
    .spyOn(Utils, 'parseScopeFromPackageJson')
    .mockReturnValue('@cplace-next');
  const execMock = jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(npmSearchResult)
    .mockReturnValue(npmViewResult);
  jest.useFakeTimers().setSystemTime(new Date('2023-05-22'));
  const cleanupSnaps = new CleanupSnapshots();

  await expect(cleanupSnaps.deleteSuperfluousArtifacts()).rejects.toThrow(
    'No JFrog credentials'
  );

  const unpublishCalls = execMock.mock.calls.filter(([command]) =>
    String(command).startsWith('npm unpublish')
  );
  expect(unpublishCalls).toEqual([]);
});
