import * as child_process from 'child_process';
import { expect } from '@jest/globals';
import { CleanupSnapshots } from './cleanup-snapshots';
import { npmSearchResult, npmViewResult } from './test-data';
import { Utils } from './utils';

beforeEach(() => {
  jest.resetAllMocks();
  jest.clearAllMocks();
});

test('can find latest version Tag of a given branch and bump the version', async () => {
  const spy = jest.spyOn(Utils, 'parseScopeFromPackageJson');
  spy.mockReturnValue('@cplace-next');
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(npmSearchResult)
    .mockReturnValue(npmViewResult);
  jest.useFakeTimers().setSystemTime(new Date('2023-05-22'));
  const cleanupSnaps = new CleanupSnapshots();
  await cleanupSnaps.deleteSuperfluousArtifacts();
  expect(cleanupSnaps.npmSearchResults[0].versions.length).toBe(4);
});
