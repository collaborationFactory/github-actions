import { expect } from '@jest/globals';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { NxProject, NxProjectKind } from './nx-project';
import { globResult, packageJsonLib1 } from './test-data';
import { Utils } from './utils';
import { sep } from 'node:path';
import { Version } from './version';
import { TASK } from './artifacts-handler';

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

  function npmShowLists(...versions: string[]) {
    (execSync as jest.Mock).mockReturnValueOnce(
      Buffer.from(JSON.stringify({ name: '@cplace-next/my-app', versions }))
    );
  }

  function npmUnpublishReportsSuccess() {
    (execSync as jest.Mock).mockReturnValueOnce(
      Buffer.from('- @cplace-next/my-app@0.0.0-my-branch-46')
    );
  }

  function commands(): string[] {
    return (execSync as jest.Mock).mock.calls.map(([command]) => command);
  }

  const SHOW = `npm show @cplace-next/my-app --json --registry=${JFROG_REGISTRY}`;
  const UNPUBLISH =
    'npm unpublish @cplace-next/my-app@0.0.0-my-branch-46 --force';

  beforeEach(() => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(NxProject, 'sleep').mockResolvedValue();
  });

  test('looks the version up in the JFrog registry, not the public one', async () => {
    npmShowLists('0.0.0-my-branch-46');
    npmUnpublishReportsSuccess();
    npmShowLists();

    await anApp().deleteArtifact(version);

    const [command, options] = (execSync as jest.Mock).mock.calls[0];
    expect(command).toBe(
      `npm show @cplace-next/my-app --json --registry=${JFROG_REGISTRY}`
    );
    expect(options.cwd).toContain('dist/apps/my-app'.replace(/\//g, sep));
  });

  test('unpublishes the version when the registry has it, then checks it is gone', async () => {
    npmShowLists('0.0.0-my-branch-46');
    npmUnpublishReportsSuccess();
    npmShowLists('0.0.0-my-branch-45');

    await anApp().deleteArtifact(version);

    expect(commands()).toEqual([SHOW, UNPUBLISH, SHOW]);
    expect(NxProject.sleep).not.toHaveBeenCalled();
  });

  test('a version still listed right after the unpublish is checked again before it counts', async () => {
    npmShowLists('0.0.0-my-branch-46');
    npmUnpublishReportsSuccess();
    npmShowLists('0.0.0-my-branch-46'); // metadata not recalculated yet
    npmShowLists();

    await anApp().deleteArtifact(version);

    expect(commands()).toEqual([SHOW, UNPUBLISH, SHOW, SHOW]);
    expect(NxProject.sleep).toHaveBeenCalledWith(
      NxProject.UNPUBLISH_RECHECK_DELAY_MS
    );
  });

  test('an unpublish that reported success but deleted nothing is retried', async () => {
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    npmShowLists('0.0.0-my-branch-46');
    npmUnpublishReportsSuccess();
    npmShowLists('0.0.0-my-branch-46');
    npmShowLists('0.0.0-my-branch-46');
    npmUnpublishReportsSuccess();
    npmShowLists();

    await anApp().deleteArtifact(version);

    expect(commands()).toEqual([SHOW, UNPUBLISH, SHOW, SHOW, UNPUBLISH, SHOW]);
    expect(console.warn).toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  test('fails the run when the version survives two unpublish attempts', async () => {
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    npmShowLists('0.0.0-my-branch-46');
    npmUnpublishReportsSuccess();
    npmShowLists('0.0.0-my-branch-46');
    npmShowLists('0.0.0-my-branch-46');
    npmUnpublishReportsSuccess();
    npmShowLists('0.0.0-my-branch-46');
    npmShowLists('0.0.0-my-branch-46');

    await anApp().deleteArtifact(version);

    expect(commands()).toEqual([
      SHOW,
      UNPUBLISH,
      SHOW,
      SHOW,
      UNPUBLISH,
      SHOW,
      SHOW,
    ]);
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'still in the registry after two npm unpublish attempts'
      )
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

describe('NxProject release dist-tags', () => {
  const JFROG_REGISTRY = 'https://cplace.jfrog.io/artifactory/cplace-npm-local';
  const version = new Version('26.4.3');

  function aReleaseApp(): NxProject {
    return new NxProject(
      'my-app',
      NxProjectKind.Application,
      TASK.RELEASE,
      version,
      '@cplace-next'
    );
  }

  test('a release publishes under release-X.Y unless it is staged', () => {
    const project = aReleaseApp();
    expect(project.getTag()).toBe('release-26.4');

    project.stageRelease = true;
    expect(project.getTag()).toBe('release-26.4-pending');
  });

  test('promote moves release-X.Y to the version, then removes the staging tag', () => {
    (execSync as jest.Mock).mockReturnValue(Buffer.from(''));

    aReleaseApp().promote();

    const calls = (execSync as jest.Mock).mock.calls;
    expect(calls.map(([command]) => command)).toEqual([
      `npm dist-tag add @cplace-next/my-app@26.4.3 release-26.4 --registry=${JFROG_REGISTRY}`,
      `npm dist-tag rm @cplace-next/my-app release-26.4-pending --registry=${JFROG_REGISTRY}`,
    ]);
    expect(calls[0][1].cwd).toContain('dist/apps/my-app'.replace(/\//g, sep));
  });

  test('a failed move of release-X.Y fails the run and keeps the staging tag', () => {
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    (execSync as jest.Mock).mockImplementationOnce(() => {
      throw Object.assign(new Error('Command failed'), { status: 1 });
    });

    aReleaseApp().promote();

    expect(exit).toHaveBeenCalledWith(1);
    expect((execSync as jest.Mock).mock.calls).toHaveLength(1);
  });

  test('a staging tag that cannot be removed does not fail the release', () => {
    const exit = jest.spyOn(process, 'exit');
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (execSync as jest.Mock)
      .mockReturnValueOnce(Buffer.from(''))
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('Command failed'), { status: 1 });
      });

    aReleaseApp().promote();

    expect(exit).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  test('promote skips projects that are not published', () => {
    // a library without a package.json is not publishable
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const lib = new NxProject(
      'my-lib',
      NxProjectKind.Library,
      TASK.RELEASE,
      version,
      '@cplace-next'
    );

    lib.promote();

    expect(execSync).not.toHaveBeenCalled();
  });
});
