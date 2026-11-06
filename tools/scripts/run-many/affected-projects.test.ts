import { expect } from '@jest/globals';
import { getAffectedProjects, normalizeRef } from './affected-projects';
import { Utils } from '../artifacts/utils';

afterEach(() => {
  jest.restoreAllMocks();
});

test('an empty ref lists all projects with the target, ignoring base', () => {
  const getAllProjects = jest
    .spyOn(Utils, 'getAllProjects')
    .mockReturnValue(['app-a', 'lib-b', 'lib-c']);

  const projects = getAffectedProjects(
    'build',
    1,
    1,
    'origin/release/26.4',
    ''
  );

  expect(getAllProjects).toHaveBeenCalledWith(false, null, 'build');
  expect(projects).toBe('app-a,lib-b,lib-c');
});

test('a non-empty ref lists the affected projects against base', () => {
  const getAllProjects = jest
    .spyOn(Utils, 'getAllProjects')
    .mockReturnValue(['lib-b']);

  const projects = getAffectedProjects(
    'build',
    1,
    1,
    'origin/release/26.4',
    'feature/x'
  );

  expect(getAllProjects).toHaveBeenCalledWith(
    true,
    'origin/release/26.4',
    'build'
  );
  expect(projects).toBe('lib-b');
});

test('normalizeRef turns an undefined or empty ref into an empty string', () => {
  expect(normalizeRef(undefined)).toBe('');
  expect(normalizeRef('')).toBe('');
  expect(normalizeRef('feature/x')).toBe('feature/x');
});

test('projects are distributed over the jobs in sorted order', () => {
  jest
    .spyOn(Utils, 'getAllProjects')
    .mockReturnValue(['lib-e', 'lib-c', 'lib-a', 'lib-d', 'lib-b']);

  expect(getAffectedProjects('build', 1, 2, 'origin/master', '')).toBe(
    'lib-a,lib-c,lib-e'
  );
  expect(getAffectedProjects('build', 2, 2, 'origin/master', '')).toBe(
    'lib-b,lib-d'
  );
});
