import * as child_process from "child_process";
import { expect } from "@jest/globals";
import { CleanupSnapshots } from "./cleanup-snapshots";
import { npmSearchResult, npmViewResult } from "./test-data";
import { Utils } from "./utils";

beforeEach(() => {
  jest.resetAllMocks();
  jest.clearAllMocks();
});

test('can find latest version Tag of a given branch and bump the version',  async () => {
  const spy = jest.spyOn(Utils, 'parseScopeFromPackageJson');
  spy.mockReturnValue('@cplace-next');
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(npmSearchResult)
    .mockReturnValue(npmViewResult)
  const cleanupSnaps = new CleanupSnapshots();
  await cleanupSnaps.deleteSuperfluousArtifacts();
  expect(cleanupSnaps.npmSearchResults[0].sortedVersions.length).toBe(1);
  expect(cleanupSnaps.npmSearchResults[0].sortedVersions[0].date.toISOString()).toBe('2023-02-11T23:00:00.000Z');
});
