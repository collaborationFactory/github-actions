import { expect } from '@jest/globals';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { NxProject, NxProjectKind } from './nx-project';
import { globResult, packageJsonLib1 } from './test-data';
import { Utils } from './utils';
import { sep } from 'node:path';
import { Version } from './version';

jest.mock('child_process');

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
    'cf-platform',
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

describe('NxProject.deleteArtifact', () => {
  const JFROG_REGISTRY = 'https://cplace.jfrog.io/artifactory/cplace-npm-local';
  const version = new Version('0.0.0', '-my-branch-46');

  function anApp(): NxProject {
    return new NxProject(
      'my-app',
      NxProjectKind.Application,
      undefined,
      version,
      '@cplace-next'
    );
  }

  function npmShowFails(output: string) {
    (execSync as jest.Mock).mockImplementationOnce(() => {
      throw Object.assign(new Error('Command failed'), {
        status: 1,
        stderr: Buffer.from(output),
      });
    });
  }

  beforeEach(() => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  });

  test('looks the version up in the JFrog registry, not the public one', async () => {
    (execSync as jest.Mock).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          name: '@cplace-next/my-app',
          versions: ['0.0.0-my-branch-46'],
        })
      )
    );

    await anApp().deleteArtifact(version);

    const [command, options] = (execSync as jest.Mock).mock.calls[0];
    expect(command).toBe(
      `npm show @cplace-next/my-app --json --registry=${JFROG_REGISTRY}`
    );
    expect(options.cwd).toContain('dist/apps/my-app'.replace(/\//g, sep));
  });

  test('unpublishes the version when the registry has it', async () => {
    (execSync as jest.Mock).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          name: '@cplace-next/my-app',
          versions: ['0.0.0-my-branch-46'],
        })
      )
    );

    await anApp().deleteArtifact(version);

    expect((execSync as jest.Mock).mock.calls[1][0]).toBe(
      'npm unpublish @cplace-next/my-app@0.0.0-my-branch-46 --force'
    );
  });

  test('skips the deletion when the package is unknown to the registry', async () => {
    npmShowFails('npm error code E404\nnpm error 404 Not Found - GET ...');

    await anApp().deleteArtifact(version);

    expect((execSync as jest.Mock).mock.calls).toHaveLength(1);
  });

  test('skips the deletion when the registry knows other versions only', async () => {
    (execSync as jest.Mock).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          name: '@cplace-next/my-app',
          versions: ['0.0.0-my-branch-45'],
        })
      )
    );

    await anApp().deleteArtifact(version);

    expect((execSync as jest.Mock).mock.calls).toHaveLength(1);
  });

  test('fails loudly instead of skipping when the lookup itself broke', async () => {
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    npmShowFails('npm error code E500\nnpm error 500 Internal Server Error');

    await anApp().deleteArtifact(version);

    expect((execSync as jest.Mock).mock.calls).toHaveLength(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
