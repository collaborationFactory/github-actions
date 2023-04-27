import { execSync } from "child_process";
import { expect } from "@jest/globals";
import { CleanupSnapshots } from "./cleanup-snapshots";
import { npmSearchResult, npmViewResult } from "./test-data";
import * as child_process from "child_process";

afterEach(() => {
  jest.resetAllMocks();
  jest.clearAllMocks();
});

test('can find latest version Tag of a given branch and bump the version', () => {
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(npmSearchResult)
    .mockReturnValue(npmViewResult)
  CleanupSnapshots.cleanupSnapshots();
  expect('').toBe('');
});
