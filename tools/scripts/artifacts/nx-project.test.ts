import { expect } from '@jest/globals';
import * as fs from 'fs';

import { NxProject, NxProjectKind } from './nx-project';
import { packageJsonLib1 } from './test-data';

afterEach(() => {
  jest.resetAllMocks();
  jest.clearAllMocks();
  jest.restoreAllMocks();
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
  expect(nxProject.getJfrogUrl()).toBe(
    'https://cplace.jfrog.io/ui/repos/tree/NpmInfo/cplace-npm-local/@cplace-next/test/-/@cplace-next/test-0.0.0.tgz'
  );
  expect(nxProject.getMarkdownLink()).toBe(
    '[@cplace-next/test@0.0.0](https://cplace.jfrog.io/ui/repos/tree/NpmInfo/cplace-npm-local/@cplace-next/test/-/@cplace-next/test-0.0.0.tgz)'
  );
});
