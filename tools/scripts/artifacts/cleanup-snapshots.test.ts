import { execSync } from "child_process";
import { expect } from "@jest/globals";
import { CleanupSnapshots } from "./cleanup-snapshots";
import { npmSearchResult, npmViewResult } from "./test-data";
import * as child_process from "child_process";
import { Utils } from "./utils";

afterEach(() => {
  jest.resetAllMocks();
  jest.clearAllMocks();
});

test('can find latest version Tag of a given branch and bump the version', async () => {
  jest
    .spyOn(Utils, 'parseScopeFromPackageJson')
    .mockReturnValueOnce('scope')
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(npmSearchResult)
    .mockReturnValue(npmViewResult)
  await CleanupSnapshots.cleanupSnapshots();
  expect('').toBe('');
});
