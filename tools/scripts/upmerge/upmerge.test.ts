import { expect } from '@jest/globals';
import * as child_process from 'child_process';
import { UpmergeHandler } from './upmerge';

test('can detect that upmerge is needed', async () => {
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(
      'https://github.com/collaborationFactory/github-actions.git'
    );
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(
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
        '.../shared/components/cplace-control-with-edit-mode.component.ts\n'
    );
  expect(new UpmergeHandler().isUpmergeNeeded().message).toBe(
    'Please upmerge from release 23.4 in repo https://github.com/collaborationFactory/github-actions.git'
  );
});

test('can detect no upmerge is needed', async () => {
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(
      'https://github.com/collaborationFactory/github-actions.git'
    );
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(
      'Merging upmerge-CscNaE/release/23.2 into origin/release/23.3\n' +
        '[${this.repoName}]:  Nothing to merge.\n' +
        'Merging upmerge-CscNaE/release/23.3 into origin/release/23.4\n' +
        '[${this.repoName}]:  Nothing to merge.\n' +
        'Merging upmerge-CscNaE/release/23.4 into origin/release/24.1\n'
    );
  expect(new UpmergeHandler().isUpmergeNeeded().message).toBe('');
});

test('returns error message with correct repo name in link', async () => {
  jest
    .spyOn(child_process, 'execSync')
    .mockReturnValueOnce(
      'https://github.com/collaborationFactory/cplace-paw-fe.git'
    ) // repo URL
    .mockImplementationOnce(() => {
      throw new Error('cli failed');
    }); // simulate error

  process.env.GITHUB_RUN_ID = '123456';
  const result = new UpmergeHandler().isUpmergeNeeded();
  expect(result.message).toBe(
    'There was an error running cplace-cli in repo https://github.com/collaborationFactory/cplace-paw-fe.git:\n\nhttps://github.com/collaborationFactory/cplace-paw-fe/actions/runs/123456'
  );
});

test('does not configure a git identity', async () => {
  const execSpy = jest
    .spyOn(child_process, 'execSync')
    // cast: execSync is overloaded; ts-jest type-checks the test
    .mockImplementation(((cmd: string) =>
      cmd.startsWith('git config --get remote.origin.url')
        ? 'https://github.com/collaborationFactory/cplace-fe.git'
        : 'Merging upmerge-x/release/24.1 into origin/main\n') as any);
  const handler = new UpmergeHandler();
  const slackSpy = jest
    .spyOn(handler, 'postToSlack')
    .mockResolvedValue(undefined);

  await handler.checkUpmergeAndNotifiy();

  const commands = execSpy.mock.calls.map(([cmd]) => String(cmd));
  expect(
    commands.some((c) => c.includes('user.name') || c.includes('user.email'))
  ).toBe(false);
  expect(slackSpy).toHaveBeenCalledWith({ message: '' });
  execSpy.mockRestore();
  slackSpy.mockRestore();
});
