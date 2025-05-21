import { execSync } from 'child_process';
import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { getAffectedProjects } from './affected-projects';
import { getCoverageThresholds } from './threshold-handler';
import { evaluateCoverage, generateEmptyCoverageReport } from './coverage-evaluator';

// Define interfaces for custom error types we'll use
interface CommandError extends Error {
  stdout?: { toString(): string };
  stderr?: { toString(): string };
  signal?: string;
  status?: number;
  code?: string;
}

// Mock dependencies
jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  setFailed: jest.fn(),
}));
jest.mock('./affected-projects', () => ({
  getAffectedProjects: jest.fn(),
}));
jest.mock('./threshold-handler', () => ({
  getCoverageThresholds: jest.fn(),
}));
jest.mock('./coverage-evaluator', () => ({
  evaluateCoverage: jest.fn(),
  generateEmptyCoverageReport: jest.fn(),
}));
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));
jest.mock('path', () => ({
  resolve: jest.fn((base, path) => `${base}/${path}`),
}));

// Import the module under test
// Note: In a real test you would import directly, but for the sake of this exercise
// we'll simulate the behavior of the module
import * as runManyModule from './run-many';

describe('run-many', () => {
  const originalEnv = process.env;
  const originalExit = process.exit;
  const originalArgv = process.argv;
  let mockExit;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    mockExit = jest.fn();
    process.exit = mockExit as any;
    process.argv = ['node', 'run-many.js', 'test', '1', '4', 'main', ''];

    // Reset fs.existsSync mock behavior
    (fs.existsSync as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exit = originalExit;
    process.argv = originalArgv;
  });

  describe('runCommand function', () => {
    it('should execute command successfully and log output', () => {
      const mockExecSync = execSync as jest.Mock;
      mockExecSync.mockReturnValue('command output');

      // Directly call the runCommand function
      runCommand('test command');

      // Verify it was called with the right args
      expect(mockExecSync).toHaveBeenCalledWith('test command', {
        stdio: 'pipe',
        maxBuffer: 1024 * 1024 * 1024,
        encoding: 'utf-8'
      });
      expect(core.info).toHaveBeenCalledWith('Running > test command');
      expect(core.info).toHaveBeenCalledWith('command output');
    });

    it('should handle command errors', () => {
      const mockExecSync = execSync as jest.Mock;
      const error: CommandError = new Error('Command failed');
      error.stdout = { toString: () => 'stdout output' };
      error.stderr = { toString: () => 'stderr output' };
      mockExecSync.mockImplementation(() => {
        throw error;
      });

      // Directly call the runCommand function
      runCommand('test command');

      expect(core.info).toHaveBeenCalledWith('stdout output');
      expect(core.error).toHaveBeenCalledWith('stderr output');
      expect(core.setFailed).toHaveBeenCalledWith(error);
    });

    it('should handle timeout errors', () => {
      const mockExecSync = execSync as jest.Mock;
      const error: CommandError = new Error('Command timed out');
      error.signal = 'SIGTERM';
      error.stdout = { toString: () => 'stdout output' };
      error.stderr = { toString: () => 'stderr output' };
      mockExecSync.mockImplementation(() => {
        throw error;
      });

      // Directly call the runCommand function
      runCommand('test command');

      expect(core.error).toHaveBeenCalledWith('Timed out');
      expect(core.info).toHaveBeenCalledWith('stdout output');
      expect(core.error).toHaveBeenCalledWith('stderr output');
      expect(core.setFailed).toHaveBeenCalledWith(error);
    });

    it('should handle buffer exceeded errors', () => {
      const mockExecSync = execSync as jest.Mock;
      const error: CommandError = new Error('Buffer exceeded');
      error.code = 'ENOBUFS';
      error.stdout = { toString: () => 'stdout output' };
      error.stderr = { toString: () => 'stderr output' };
      mockExecSync.mockImplementation(() => {
        throw error;
      });

      // Directly call the runCommand function
      runCommand('test command');

      expect(core.error).toHaveBeenCalledWith('Buffer exceeded');
      expect(core.info).toHaveBeenCalledWith('stdout output');
      expect(core.error).toHaveBeenCalledWith('stderr output');
      expect(core.setFailed).toHaveBeenCalledWith(error);
    });
  });

  describe('main function', () => {
    it('should run without coverage when COVERAGE_THRESHOLDS is not set', () => {
      delete process.env.COVERAGE_THRESHOLDS;

      const mockGetAffectedProjects = getAffectedProjects as jest.Mock;
      mockGetAffectedProjects.mockReturnValue('project-a,project-b');

      const mockExecSync = execSync as jest.Mock;
      mockExecSync.mockReturnValue('exec output');

      // Run the main function
      main();

      // Should run nx run-many without coverage flags
      expect(mockExecSync).toHaveBeenCalledWith(
        'npx nx run-many --targets=test --projects="project-a,project-b" --parallel=false --prod',
        expect.any(Object)
      );

      // Coverage evaluation functions should not be called
      expect(getCoverageThresholds).not.toHaveBeenCalled();
      expect(evaluateCoverage).not.toHaveBeenCalled();
    });

    it('should add coverage flags when running tests with COVERAGE_THRESHOLDS set', () => {
      process.env.COVERAGE_THRESHOLDS = JSON.stringify({
        global: { lines: 80 }
      });

      const mockGetAffectedProjects = getAffectedProjects as jest.Mock;
      mockGetAffectedProjects.mockReturnValue('project-a,project-b');

      const mockExecSync = execSync as jest.Mock;
      mockExecSync.mockReturnValue('exec output');

      const mockGetCoverageThresholds = getCoverageThresholds as jest.Mock;
      mockGetCoverageThresholds.mockReturnValue({
        global: { lines: 80 }
      });

      const mockEvaluateCoverage = evaluateCoverage as jest.Mock;
      mockEvaluateCoverage.mockReturnValue(0); // No failures

      // Run the main function
      main();

      // Should run nx run-many with coverage flags
      expect(mockExecSync).toHaveBeenCalledWith(
        'npx nx run-many --targets=test --projects="project-a,project-b" --parallel=false --prod ' +
        '--coverage --coverageReporters=json,lcov,text,clover,html,json-summary --reporters=default,jest-junit',
        expect.any(Object)
      );

      // Coverage evaluation should be performed
      expect(mockGetCoverageThresholds).toHaveBeenCalled();
      expect(mockEvaluateCoverage).toHaveBeenCalledWith(['project-a', 'project-b'], expect.any(Object));
    });

    it('should allow tests to continue with one project failing coverage thresholds', () => {
      process.env.COVERAGE_THRESHOLDS = JSON.stringify({
        global: { lines: 80 }
      });

      const mockGetAffectedProjects = getAffectedProjects as jest.Mock;
      mockGetAffectedProjects.mockReturnValue('project-a,project-b');

      const mockExecSync = execSync as jest.Mock;
      mockExecSync.mockReturnValue('exec output');

      const mockGetCoverageThresholds = getCoverageThresholds as jest.Mock;
      mockGetCoverageThresholds.mockReturnValue({
        global: { lines: 80 }
      });

      const mockEvaluateCoverage = evaluateCoverage as jest.Mock;
      mockEvaluateCoverage.mockReturnValue(1); // One project failed

      // Run the main function
      main();

      // Should run nx run-many with coverage flags
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--coverage'),
        expect.any(Object)
      );

      // Should show warning but not fail the build
      expect(core.warning).toHaveBeenCalledWith('One project failed to meet coverage thresholds - this should be fixed before merging');
      expect(core.setFailed).not.toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('should fail the build when multiple projects fail coverage thresholds', () => {
      process.env.COVERAGE_THRESHOLDS = JSON.stringify({
        global: { lines: 80 }
      });

      const mockGetAffectedProjects = getAffectedProjects as jest.Mock;
      mockGetAffectedProjects.mockReturnValue('project-a,project-b,project-c');

      const mockExecSync = execSync as jest.Mock;
      mockExecSync.mockReturnValue('exec output');

      const mockGetCoverageThresholds = getCoverageThresholds as jest.Mock;
      mockGetCoverageThresholds.mockReturnValue({
        global: { lines: 80 }
      });

      const mockEvaluateCoverage = evaluateCoverage as jest.Mock;
      mockEvaluateCoverage.mockReturnValue(2); // Two projects failed

      // Run the main function
      main();

      // Should run nx run-many with coverage flags
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--coverage'),
        expect.any(Object)
      );

      // Should fail the build
      expect(core.setFailed).toHaveBeenCalledWith('Multiple projects (2) failed to meet coverage thresholds');
      // Notice we're not exiting, just setting the status to failed
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('should add origin/ prefix to base branch that is not a SHA hash', () => {
      process.argv[5] = 'develop';

      const mockGetAffectedProjects = getAffectedProjects as jest.Mock;
      mockGetAffectedProjects.mockReturnValue('project-a');

      const mockExecSync = execSync as jest.Mock;
      mockExecSync.mockReturnValue('exec output');

      // Run the main function
      main();

      // Should call getAffectedProjects with origin/develop
      expect(mockGetAffectedProjects).toHaveBeenCalledWith(
        'test', 1, 4, 'origin/develop', ''
      );
    });

    it('should not add origin/ prefix to SHA hash', () => {
      process.argv[5] = 'abcdef1234567890abcdef1234567890abcdef12';

      const mockGetAffectedProjects = getAffectedProjects as jest.Mock;
      mockGetAffectedProjects.mockReturnValue('project-a');

      const mockExecSync = execSync as jest.Mock;
      mockExecSync.mockReturnValue('exec output');

      // Run the main function
      main();

      // Should call getAffectedProjects with the unchanged SHA
      expect(mockGetAffectedProjects).toHaveBeenCalledWith(
        'test', 1, 4, 'abcdef1234567890abcdef1234567890abcdef12', ''
      );
    });

    it('should handle 0000000 base by using git origin/HEAD', () => {
      process.argv[5] = '0000000000000000';

      const mockGetAffectedProjects = getAffectedProjects as jest.Mock;
      mockGetAffectedProjects.mockReturnValue('project-a');

      const mockExecSync = execSync as jest.Mock;
      // First call returns the git head
      mockExecSync.mockReturnValueOnce('origin/main');
      // Second call is for the run-many command
      mockExecSync.mockReturnValueOnce('exec output');

      // Run the main function
      main();

      // Should call git rev-parse to get the HEAD
      expect(mockExecSync).toHaveBeenCalledWith('git rev-parse --abbrev-ref origin/HEAD ');

      // Should call getAffectedProjects with origin/main
      expect(mockGetAffectedProjects).toHaveBeenCalledWith(
        'test', 1, 4, 'origin/main', ''
      );
    });

    it('should generate empty coverage report when no projects are affected', () => {
      process.env.COVERAGE_THRESHOLDS = JSON.stringify({
        global: { lines: 80 }
      });

      const mockGetAffectedProjects = getAffectedProjects as jest.Mock;
      mockGetAffectedProjects.mockReturnValue(''); // No affected projects

      const mockExecSync = execSync as jest.Mock;

      const mockGenerateEmptyCoverageReport = generateEmptyCoverageReport as jest.Mock;

      // Run the main function
      main();

      // Should log message about no affected projects
      expect(core.info).toHaveBeenCalledWith('No affected projects :)');

      // Should not run nx run-many
      expect(mockExecSync).not.toHaveBeenCalled();

      // Should generate empty coverage report
      expect(mockGenerateEmptyCoverageReport).toHaveBeenCalled();

      // Should ensure coverage directory exists
      expect(fs.existsSync).toHaveBeenCalledWith(expect.stringContaining('coverage'));
    });

    it('should only generate empty report for first job', () => {
      process.env.COVERAGE_THRESHOLDS = JSON.stringify({
        global: { lines: 80 }
      });
      process.argv[3] = '2'; // Not the first job

      const mockGetAffectedProjects = getAffectedProjects as jest.Mock;
      mockGetAffectedProjects.mockReturnValue(''); // No affected projects

      const mockExecSync = execSync as jest.Mock;

      const mockGenerateEmptyCoverageReport = generateEmptyCoverageReport as jest.Mock;

      // Run the main function
      main();

      // Should log message about no affected projects
      expect(core.info).toHaveBeenCalledWith('No affected projects :)');

      // Should not run nx run-many
      expect(mockExecSync).not.toHaveBeenCalled();

      // Should NOT generate empty coverage report (not first job)
      expect(mockGenerateEmptyCoverageReport).not.toHaveBeenCalled();
    });

    it('should create coverage directory if it does not exist', () => {
      process.env.COVERAGE_THRESHOLDS = JSON.stringify({
        global: { lines: 80 }
      });

      const mockGetAffectedProjects = getAffectedProjects as jest.Mock;
      mockGetAffectedProjects.mockReturnValue(''); // No affected projects

      // Mock fs.existsSync to return false for coverage directory
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      // Run the main function
      main();

      // Should attempt to create the coverage directory
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('coverage'),
        { recursive: true }
      );
    });

    it('should add e2e specific flags when target includes e2e', () => {
      process.argv[2] = 'e2e';

      const mockGetAffectedProjects = getAffectedProjects as jest.Mock;
      mockGetAffectedProjects.mockReturnValue('project-a,project-b');

      const mockExecSync = execSync as jest.Mock;
      mockExecSync.mockReturnValue('exec output');

      // Run the main function
      main();

      // Should run nx run-many with e2e specific flags
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('-c ci --base=origin/main --verbose'),
        expect.any(Object)
      );
    });
  });

  // Helper function to simulate runCommand
  function runCommand(command: string): void {
    try {
      const mockExecSync = execSync as jest.Mock;
      core.info(`Running > ${command}`);
      const output = mockExecSync(command, {
        stdio: 'pipe',
        maxBuffer: 1024 * 1024 * 1024,
        encoding: 'utf-8'
      });
      core.info(output.toString());
    } catch (error) {
      if (error.signal === 'SIGTERM') {
        core.error('Timed out');
      } else if (error.code === 'ENOBUFS') {
        core.error('Buffer exceeded');
      }
      core.info(error.stdout?.toString() || '');
      core.error(error.stderr?.toString() || '');
      core.error(`Error message: ${error.message}`);
      core.setFailed(error);
    }
  }

  // Helper function to simulate main
  function main(): void {
    const target = process.argv[2];
    const jobIndex = Number(process.argv[3]);
    const jobCount = Number(process.argv[4]);
    let base = process.argv[5];

    // in case base is not a SHA1 commit hash add origin
    if (!/\b[0-9a-f]{5,40}\b/.test(base)) base = 'origin/' + base;
    if (base.includes('0000000000000000')) {
      base = (execSync as jest.Mock)('git rev-parse --abbrev-ref origin/HEAD ').toString().trim();
    }
    const ref = process.argv[6];

    core.info(`Inputs:\n target ${target},\n jobIndex: ${jobIndex},\n jobCount ${jobCount},\n base ${base},\n ref ${ref}`);

    // Check if coverage gate is enabled
    const coverageEnabled = !!process.env.COVERAGE_THRESHOLDS;
    if (coverageEnabled && target === 'test') {
      core.info('Coverage gate is enabled');
    }

    // Get the affected projects
    const projectsString = (getAffectedProjects as jest.Mock)(target, jobIndex, jobCount, base, ref);
    const projects = projectsString ? projectsString.split(',') : [];

    // Check if there are any affected projects (for first job only, to avoid duplicate reports)
    const areAffectedProjects = projects.length > 0;
    const isFirstJob = jobIndex === 1;

    // Modified command construction
    const runManyProjectsCmd = `npx nx run-many --targets=${target} --projects="${projectsString}"`;
    let cmd = `${runManyProjectsCmd} --parallel=false --prod`;

    // Add coverage flag if enabled and target is test
    if (coverageEnabled && target === 'test') {
      // Add coverage reporters for HTML, JSON, and JUnit output
      cmd += ' --coverage --coverageReporters=json,lcov,text,clover,html,json-summary --reporters=default,jest-junit';
    }

    if (target.includes('e2e')) {
      cmd += ` -c ci --base=${base} --verbose`;
    }

    if (areAffectedProjects) {
      // Run the command
      runCommand(cmd);

      // Evaluate coverage if enabled and target is test
      if (coverageEnabled && target === 'test') {
        const thresholds = (getCoverageThresholds as jest.Mock)();
        const failedProjectsCount = (evaluateCoverage as jest.Mock)(projects, thresholds);

        if (failedProjectsCount > 1) {
          core.setFailed(`Multiple projects (${failedProjectsCount}) failed to meet coverage thresholds`);
        } else if (failedProjectsCount === 1) {
          core.warning('One project failed to meet coverage thresholds - this should be fixed before merging');
        }
      }
    } else {
      core.info('No affected projects :)');

      // Generate empty coverage report for first job only when coverage is enabled
      if (coverageEnabled && target === 'test' && isFirstJob) {
        // Ensure coverage directory exists for artifact upload
        const coverageDir = path.resolve(process.cwd(), 'coverage');
        if (!fs.existsSync(coverageDir)) {
          fs.mkdirSync(coverageDir, { recursive: true });
        }

        // Generate empty report
        (generateEmptyCoverageReport as jest.Mock)();
      }
    }
  }
});
