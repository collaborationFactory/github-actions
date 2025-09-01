import { expect } from '@jest/globals';
import * as fs from 'fs';
import { NxProject, NxProjectKind } from './nx-project';
import { globResult, packageJsonLib1 } from './test-data';
import { Utils } from './utils';
import { sep } from 'node:path';

afterEach(() => {
  jest.resetAllMocks();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.spyOn(Utils, 'globProjectJSON').mockReturnValue(globResult);
});

test('NxProject can provide jfrog Url', async () => {
  jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  jest.spyOn(fs, 'readFileSync').mockReturnValueOnce(packageJsonLib1);
  jest.spyOn(fs, 'writeFileSync').mockReturnValue();

  const nxProject = new NxProject(
    'test',
    NxProjectKind.Library,
    undefined,
    undefined,
    '@cplace-next'
  );
  expect(nxProject.getJfrogNpmArtifactUrl()).toBe(
    'https://cplace.jfrog.io/artifactory/cplace-npm-local/@cplace-next/test/-/@cplace-next/test-0.0.0.tgz'
  );
  expect(nxProject.getMarkdownLink()).toBe(
    '[@cplace-next/test@0.0.0](https://cplace.jfrog.io/artifactory/cplace-npm-local/@cplace-next/test/-/@cplace-next/test-0.0.0.tgz)'
  );
});

test('NxProject can get actual folder of project', async () => {
  const nxProject = new NxProject(
    'my-cf-platform',
    NxProjectKind.Application,
    undefined,
    undefined,
    '@cplace-next'
  );
  expect(nxProject.pathToProject).toBe('apps/my/cf-platform');
});

test('NxProject can find folder in src', async () => {
  const nxProject = new NxProject(
    'my-lib',
    NxProjectKind.Library,
    undefined,
    undefined,
    '@cplace-next'
  );
  expect(nxProject.getPathToProjectInSource()).toContain(
    'libs/my-lib'.replace(/\//g, sep)
  );
});

test('NxProject can find folder in dist', async () => {
  const nxProject = new NxProject(
    'my-app',
    NxProjectKind.Application,
    undefined,
    undefined,
    '@cplace-next'
  );
  expect(nxProject.getPathToProjectInDist()).toContain(
    'dist/apps/my-app'.replace(/\//g, sep)
  );
});

test('e2e app is publishable when public_api.ts exists', async () => {
  jest.spyOn(fs, 'existsSync').mockReturnValue(true);

  const nxProject = new NxProject(
    'my-app-e2e',
    NxProjectKind.Application,
    undefined,
    undefined,
    '@cplace-next'
  );

  expect(nxProject.isPublishable).toBe(true);
});

test('e2e app is not publishable when public_api.ts does not exist', async () => {
  jest.spyOn(fs, 'existsSync').mockReturnValue(false);

  const nxProject = new NxProject(
    'my-app-e2e',
    NxProjectKind.Application,
    undefined,
    undefined,
    '@cplace-next'
  );

  expect(nxProject.isPublishable).toBe(false);
});

test('regular app is always publishable regardless of public_api.ts', async () => {
  jest.spyOn(fs, 'existsSync').mockReturnValue(false);

  const nxProject = new NxProject(
    'my-regular-app',
    NxProjectKind.Application,
    undefined,
    undefined,
    '@cplace-next'
  );

  expect(nxProject.isPublishable).toBe(true);
});
