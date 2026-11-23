import { expect } from '@jest/globals';
import * as child_process from 'child_process';
import { ArtifactsHandler } from './artifacts-handler';
import { NxProject, NxProjectKind } from './nx-project';
import { Utils } from './utils';

process.env.JFROG_BASE64_TOKEN = 'jfrog_base64_token';
process.env.JFROG_URL = 'jfrog_url';
process.env.JFROG_USER = 'jfrog_user';

const SCOPE = '@cplace-next';
const BRANCH = 'feature/PFM-1-some-work';

afterEach(() => {
  jest.restoreAllMocks();
  process.env.BASE = '';
  process.env.TAG = '';
  process.env.ONLY_BUMP_VERSION = 'false';
  process.env.ONLY_DELETE_ARTIFACTS = 'false';
  process.env.PR_NUMBER = '';
});

test('a PR snapshot outputs its version and every published package', async () => {
  process.env.PR_NUMBER = '42';
  mockHandlerDependencies([
    project('cf-platform', NxProjectKind.Application),
    project('cf-frontend-sdk', NxProjectKind.Library, true),
  ]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(output).toHaveBeenCalledWith(
    'version',
    '0.0.0-feature-PFM-1-some-work-42'
  );
  expect(output).toHaveBeenCalledWith(
    'packages',
    '["@cplace-next/cf-platform","@cplace-next/cf-frontend-sdk"]'
  );
});

test('a non-publishable lib is not listed in the packages output', async () => {
  process.env.PR_NUMBER = '42';
  mockHandlerDependencies([
    project('cf-platform', NxProjectKind.Application),
    project('cf-internal-utils', NxProjectKind.Library, false),
  ]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(output).toHaveBeenCalledWith(
    'packages',
    '["@cplace-next/cf-platform"]'
  );
});

test('a PR snapshot with nothing affected outputs an empty packages list and still a version', async () => {
  process.env.PR_NUMBER = '42';
  mockHandlerDependencies([]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(output).toHaveBeenCalledWith(
    'version',
    '0.0.0-feature-PFM-1-some-work-42'
  );
  expect(output).toHaveBeenCalledWith('packages', '[]');
});

test('integrities maps every published package to its integrity', async () => {
  process.env.PR_NUMBER = '42';
  mockHandlerDependencies([
    project('cf-platform', NxProjectKind.Application, true, 'sha512-platform'),
    project('cf-frontend-sdk', NxProjectKind.Library, true, 'sha512-sdk'),
    project('cf-internal-utils', NxProjectKind.Library, false, 'sha512-x'),
  ]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(output).toHaveBeenCalledWith(
    'integrities',
    '{"@cplace-next/cf-platform":"sha512-platform","@cplace-next/cf-frontend-sdk":"sha512-sdk"}'
  );
});

test('integrities is an empty object when nothing was published', async () => {
  process.env.PR_NUMBER = '42';
  mockHandlerDependencies([]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(output).toHaveBeenCalledWith('integrities', '{}');
});

test.each([
  ['a plain summary', '{"name":"x","integrity":"sha512-a"}', 'sha512-a'],
  [
    'script output before the summary',
    '> prepublish\nbuilding\n{\n  "integrity": "sha512-b"\n}',
    'sha512-b',
  ],
  ['a summary keyed by package', '{"@s/x":{"integrity":"sha512-c"}}', 'sha512-c'],
  ['no JSON', 'npm notice published', ''],
  ['a summary without integrity', '{"name":"x"}', ''],
])('integrityOf reads %s', (_case, summary, expected) => {
  expect(NxProject.integrityOf(summary)).toBe(expected);
});

test('a main snapshot writes neither output', async () => {
  mockHandlerDependencies([project('cf-platform', NxProjectKind.Application)]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(output).not.toHaveBeenCalled();
});

test('deleting a PR snapshot on PR close writes neither output', async () => {
  process.env.PR_NUMBER = '42';
  process.env.ONLY_DELETE_ARTIFACTS = 'true';
  mockHandlerDependencies([project('cf-platform', NxProjectKind.Application)]);
  const output = jest.spyOn(Utils, 'writeOutput').mockReturnValue();

  await new ArtifactsHandler().handle();

  expect(output).not.toHaveBeenCalled();
});

function project(
  name: string,
  kind: NxProjectKind,
  publishable = true,
  integrity = ''
): NxProject {
  const nxProject = new NxProject(name, kind);
  nxProject.scope = SCOPE;
  nxProject.isPublishable = publishable;
  nxProject.publishedIntegrity = integrity;
  return nxProject;
}

function mockHandlerDependencies(affected: NxProject[]) {
  jest.spyOn(child_process, 'execSync').mockReturnValue(Buffer.from(''));
  jest
    .spyOn(Utils, 'getCurrentBranchNameFromGithubEnv')
    .mockReturnValue(BRANCH);
  jest.spyOn(Utils, 'parseScopeFromPackageJson').mockReturnValue(SCOPE);
  jest.spyOn(Utils, 'isBranchOffCommit').mockReturnValue(false);
  jest.spyOn(Utils, 'initGithubActionsFile').mockReturnValue();
  // applications and libraries are queried separately: return the whole list once
  jest
    .spyOn(Utils, 'getAffectedNxProjects')
    .mockReturnValueOnce(affected)
    .mockReturnValueOnce([]);
  jest
    .spyOn(ArtifactsHandler.prototype as any, 'buildAndPublishProjects')
    .mockResolvedValue(undefined);
}
