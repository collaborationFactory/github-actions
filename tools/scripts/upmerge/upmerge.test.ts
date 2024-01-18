import { expect } from "@jest/globals";
import * as child_process from "child_process";
import { UpmergeHandler } from "./upmerge";

test('can detect that upmerge is needed', async () => {
  jest.spyOn(child_process, 'execSync').mockReturnValueOnce('https://github.com/collaborationFactory/github-actions.git');
  jest.spyOn(child_process, 'execSync').mockReturnValueOnce(
    'Merging upmerge-CscNaE/release/23.2 into origin/release/23.3\n' +
    '[${this.repoName}]:  Nothing to merge.\n' +
    'Merging upmerge-CscNaE/release/23.3 into origin/release/23.4\n' +
    '[${this.repoName}]:  Nothing to merge.\n' +
    'Merging upmerge-CscNaE/release/23.4 into origin/release/24.1\n' +
    '[${this.repoName}]: The following files have been merged: \n' +
    'documentation/guides/intercommunication.md\n' +
    'Merging upmerge-CscNaE/release/24.1 into origin/main\n' +
    '[${this.repoName}]: The following files have been merged: \n' +
    'documentation/guides/intercommunication.md\n' +
    '.../shared/components/cplace-control-with-edit-mode.component.ts\n');
  expect(new UpmergeHandler().isUpmergeNeeded()).toBe('Please upmerge from release 23.4 in repo https://github.com/collaborationFactory/github-actions.git');
});

test('can detect no upmerge is needed', async () => {
  jest.spyOn(child_process, 'execSync').mockReturnValueOnce('https://github.com/collaborationFactory/github-actions.git');
  jest.spyOn(child_process, 'execSync').mockReturnValueOnce(
    'Merging upmerge-CscNaE/release/23.2 into origin/release/23.3\n' +
    '[${this.repoName}]:  Nothing to merge.\n' +
    'Merging upmerge-CscNaE/release/23.3 into origin/release/23.4\n' +
    '[${this.repoName}]:  Nothing to merge.\n' +
    'Merging upmerge-CscNaE/release/23.4 into origin/release/24.1\n');
  expect(new UpmergeHandler().isUpmergeNeeded()).toBe('');
});
