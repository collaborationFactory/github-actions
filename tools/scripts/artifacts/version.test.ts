import { expect } from '@jest/globals';
import * as fs from 'fs';

import { Version } from './version';
import { packageJsonLib1 } from './test-data';

afterEach(() => {
  jest.resetAllMocks();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

test('can generate a NPM tag', async () => {
  jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  jest.spyOn(fs, 'readFileSync').mockReturnValueOnce(packageJsonLib1);
  jest.spyOn(fs, 'writeFileSync').mockReturnValue();

  const version = new Version('24.2.3');
  expect(version.getNpmTag()).toBe('release-24.2');
});
