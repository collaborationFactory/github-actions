import { expect } from '@jest/globals';
import * as child_process from 'child_process';
import { execSync } from 'child_process';
import { ArtifactsHandler, TASK } from './artifacts-handler';
import { NxProject, NxProjectKind } from './nx-project';
import { Utils } from './utils';

process.env.JFROG_BASE64_TOKEN = 'jfrog_base64_token';
process.env.JFROG_URL = 'jfrog_url';
process.env.JFROG_USER = 'jfrog_user';

const rootDir = execSync(`git rev-parse --show-toplevel`).toString().trim();

const lsRemote = [
  'a1\trefs/tags/version/25.4.9',
  'a2\trefs/tags/version/26.3.5',
  'a3\trefs/tags/version/26.4.1',
  'a4\trefs/tags/version/26.4.2',
].join('\n');

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.RELEASE_FLOW;
  delete process.env.FORCE;
  process.env.BASE = '';
  process.env.TAG = '';
  process.env.ONLY_BUMP_VERSION = 'false';
  process.env.ONLY_DELETE_ARTIFACTS = 'false';
  process.env.PR_NUMBER = '';
});

test('a push to a release branch with affected projects publishes all projects at the new version, then tags', async () => {
  process.env.RELEASE_FLOW = 'true';
  const execMock = mockGit();
  mockBranch('release/26.4');
  const affected = jest
    .spyOn(Utils, 'getAffectedNxProjects')
    .mockReturnValue([new NxProject('lib a', NxProjectKind.Library)]);
  const allProjects = jest.spyOn(Utils, 'getAllNxProjects').mockReturnValue([]);
  const publish = mockPublish();
  const versionFile = Utils.writeReleaseVersionFile as jest.Mock;
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  // affected since the previous release of the line, not since the pushed range
  expect(affected).toHaveBeenCalledWith(
    'version/26.4.2',
    NxProjectKind.Library,
    TASK.RELEASE,
    expect.anything(),
    '@cplace-frontend-applications'
  );
  expect(execMock).toHaveBeenCalledWith('git tag version/26.4.3');
  expect(execMock).toHaveBeenCalledWith('git push origin version/26.4.3');
  expect(allProjects).toHaveBeenCalledWith(
    TASK.RELEASE,
    expect.objectContaining({ major: 26, minor: 4, patch: 3 }),
    '@cplace-frontend-applications'
  );
  // the cleanup step learns the version before anything is published
  expect(versionFile).toHaveBeenCalledWith('version/26.4.3');
  expect(versionFile.mock.invocationCallOrder[0]).toBeLessThan(
    publish.mock.invocationCallOrder[0]
  );
  expect(publish.mock.invocationCallOrder[0]).toBeLessThan(
    tagCallOrder(execMock)
  );
  expect(output).toHaveBeenCalledWith('tag', 'version/26.4.3');
  expect(output).toHaveBeenCalledWith('previous_tag', 'version/26.4.2');
  expect(output).toHaveBeenCalledWith('is_latest', 'true');
});

test('a push to a release branch with nothing affected neither tags nor publishes', async () => {
  process.env.RELEASE_FLOW = 'true';
  const execMock = mockGit();
  mockBranch('release/26.4');
  jest.spyOn(Utils, 'getAffectedNxProjects').mockReturnValue([]);
  const allProjects = jest.spyOn(Utils, 'getAllNxProjects').mockReturnValue([]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(gitTagOrPushCalls(execMock)).toEqual([]);
  expect(allProjects).not.toHaveBeenCalled();
  expect(output).not.toHaveBeenCalled();
});

test('a forced run on a release branch tags and publishes without running nx affected', async () => {
  process.env.RELEASE_FLOW = 'true';
  process.env.FORCE = 'true';
  const execMock = mockGit();
  mockBranch('release/26.4');
  const affected = jest
    .spyOn(Utils, 'getAffectedNxProjects')
    .mockReturnValue([]);
  const allProjects = jest.spyOn(Utils, 'getAllNxProjects').mockReturnValue([]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(affected).not.toHaveBeenCalled();
  expect(gitTagOrPushCalls(execMock)).toEqual([
    'git tag version/26.4.3',
    'git push origin version/26.4.3',
  ]);
  expect(allProjects).toHaveBeenCalledTimes(1);
  expect(output).toHaveBeenCalledWith('tag', 'version/26.4.3');
});

test('the first push of a new release line tags X.Y.1 even if nothing is affected', async () => {
  process.env.RELEASE_FLOW = 'true';
  const execMock = mockGit();
  mockBranch('release/26.5');
  const affected = jest
    .spyOn(Utils, 'getAffectedNxProjects')
    .mockReturnValue([]);
  const allProjects = jest.spyOn(Utils, 'getAllNxProjects').mockReturnValue([]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(affected).not.toHaveBeenCalled();
  expect(gitTagOrPushCalls(execMock)).toEqual([
    'git tag version/26.5.1',
    'git push origin version/26.5.1',
  ]);
  expect(allProjects).toHaveBeenCalledWith(
    TASK.RELEASE,
    expect.objectContaining({ major: 26, minor: 5, patch: 1 }),
    '@cplace-frontend-applications'
  );
  expect(output).toHaveBeenCalledWith('previous_tag', '');
  expect(output).toHaveBeenCalledWith('is_latest', 'true');
  expect(output).toHaveBeenCalledWith('tag', 'version/26.5.1');
});

test('a release on an older line is not the latest and refers to its own previous tag', async () => {
  process.env.RELEASE_FLOW = 'true';
  const execMock = mockGit();
  mockBranch('release/26.3');
  jest
    .spyOn(Utils, 'getAffectedNxProjects')
    .mockReturnValue([new NxProject('lib a', NxProjectKind.Library)]);
  jest.spyOn(Utils, 'getAllNxProjects').mockReturnValue([]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(execMock).toHaveBeenCalledWith('git tag version/26.3.6');
  expect(output).toHaveBeenCalledWith('tag', 'version/26.3.6');
  expect(output).toHaveBeenCalledWith('previous_tag', 'version/26.3.5');
  expect(output).toHaveBeenCalledWith('is_latest', 'false');
});

test('a failed publish fails the run without tagging, leaving the version for the cleanup step', async () => {
  process.env.RELEASE_FLOW = 'true';
  const execMock = mockGit();
  mockBranch('release/26.4');
  jest
    .spyOn(Utils, 'getAffectedNxProjects')
    .mockReturnValue([new NxProject('lib a', NxProjectKind.Library)]);
  jest.spyOn(Utils, 'getAllNxProjects').mockReturnValue([]);
  mockPublish().mockRejectedValue(new Error('publish failed'));
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await expect(new ArtifactsHandler().handle()).rejects.toThrow(
    'publish failed'
  );

  expect(Utils.writeReleaseVersionFile).toHaveBeenCalledWith('version/26.4.3');
  expect(gitTagOrPushCalls(execMock)).toEqual([]);
  expect(output).not.toHaveBeenCalled();
});

test('a failed tag push fails the run after publishing, without tag outputs', async () => {
  process.env.RELEASE_FLOW = 'true';
  jest
    .spyOn(child_process, 'execSync')
    .mockImplementation((command: string) => {
      if (command.startsWith('git push')) throw new Error('push rejected');
      return Buffer.from(
        command.startsWith('git ls-remote --tags') ? lsRemote : ''
      );
    });
  mockBranch('release/26.4');
  jest
    .spyOn(Utils, 'getAffectedNxProjects')
    .mockReturnValue([new NxProject('lib a', NxProjectKind.Library)]);
  jest.spyOn(Utils, 'getAllNxProjects').mockReturnValue([]);
  const publish = mockPublish();
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await expect(new ArtifactsHandler().handle()).rejects.toThrow(
    'push rejected'
  );

  expect(publish).toHaveBeenCalledTimes(1);
  expect(output).not.toHaveBeenCalled();
});

test('a forced run on the default branch publishes a snapshot of all projects without a tag', async () => {
  process.env.RELEASE_FLOW = 'true';
  process.env.FORCE = 'true';
  const execMock = mockGit();
  mockBranch('master');
  const allProjects = jest.spyOn(Utils, 'getAllNxProjects').mockReturnValue([]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(gitTagOrPushCalls(execMock)).toEqual([]);
  expect(allProjects).toHaveBeenCalledTimes(1);
  const [task, version] = allProjects.mock.calls[0];
  expect(task).toBe(TASK.MAIN_SNAPSHOT);
  expect(version.toString()).toContain(`-${ArtifactsHandler.SNAPSHOT}-`);
  expect(output).not.toHaveBeenCalled();
});

test('a run on the default branch without force does nothing', async () => {
  process.env.RELEASE_FLOW = 'true';
  const execMock = mockGit();
  mockBranch('master');
  const affected = jest.spyOn(Utils, 'getAffectedNxProjects');
  const allProjects = jest.spyOn(Utils, 'getAllNxProjects');
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(gitTagOrPushCalls(execMock)).toEqual([]);
  expect(affected).not.toHaveBeenCalled();
  expect(allProjects).not.toHaveBeenCalled();
  expect(output).not.toHaveBeenCalled();
});

test('the old version bump mode writes no outputs', async () => {
  process.env.ONLY_BUMP_VERSION = 'true';
  const execMock = mockGit();
  mockBranch('release/26.4');
  jest
    .spyOn(Utils, 'getAffectedNxProjects')
    .mockReturnValue([new NxProject('lib a', NxProjectKind.Library)]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(execMock).toHaveBeenCalledWith('git push origin version/26.4.3');
  expect(output).not.toHaveBeenCalled();
});

test('a [branch-off] tip commit wins over a forced release flow', async () => {
  process.env.RELEASE_FLOW = 'true';
  process.env.FORCE = 'true';
  const execMock = mockGit();
  mockBranch('release/26.4');
  jest.spyOn(Utils, 'isBranchOffCommit').mockReturnValue(true);
  const allProjects = jest.spyOn(Utils, 'getAllNxProjects');

  await new ArtifactsHandler().handle();

  expect(gitTagOrPushCalls(execMock)).toEqual([]);
  expect(allProjects).not.toHaveBeenCalled();
});

test('the cleanup deletes the artifacts of the given version tag on a release branch', async () => {
  process.env.ONLY_DELETE_ARTIFACTS = 'true';
  process.env.TAG = 'version/26.4.3';
  mockGit();
  mockBranch('release/26.4');
  const allProjects = jest.spyOn(Utils, 'getAllNxProjects').mockReturnValue([]);

  await new ArtifactsHandler().handle();

  // the tag's version, not the X.Y.0 of the release branch
  expect(allProjects).toHaveBeenCalledWith(
    TASK.RELEASE,
    expect.objectContaining({ major: 26, minor: 4, patch: 3 }),
    '@cplace-frontend-applications'
  );
});

function mockPublish() {
  return jest
    .spyOn(ArtifactsHandler.prototype as any, 'buildAndPublishProjects')
    .mockResolvedValue(undefined);
}

function gitTagOrPushCalls(execMock: jest.SpyInstance) {
  return execMock.mock.calls
    .map(([command]) => String(command))
    .filter(
      (command) =>
        command.startsWith('git tag') || command.startsWith('git push')
    );
}

function mockGit() {
  return jest
    .spyOn(child_process, 'execSync')
    .mockImplementation((command: string) =>
      Buffer.from(command.startsWith('git ls-remote --tags') ? lsRemote : '')
    );
}

function mockBranch(branch: string) {
  jest
    .spyOn(Utils, 'getCurrentBranchNameFromGithubEnv')
    .mockReturnValue(branch);
  jest
    .spyOn(Utils, 'parseScopeFromPackageJson')
    .mockReturnValue('@cplace-frontend-applications');
  jest.spyOn(Utils, 'getRootDir').mockReturnValue(rootDir);
  jest.spyOn(Utils, 'initGithubActionsFile').mockReturnValue();
  jest.spyOn(Utils, 'appendStepSummary').mockReturnValue();
  jest.spyOn(Utils, 'writeReleaseVersionFile').mockReturnValue();
  jest.spyOn(Utils, 'isBranchOffCommit').mockReturnValue(false);
}

function tagCallOrder(execMock: jest.SpyInstance) {
  const index = execMock.mock.calls.findIndex(([command]) =>
    String(command).startsWith('git tag')
  );
  return execMock.mock.invocationCallOrder[index];
}
