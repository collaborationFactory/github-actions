import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import { evaluateCoverage, generateEmptyCoverageReport } from './coverage-evaluator';
import { getProjectThresholds } from './threshold-handler';

// Mock dependencies
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
}));
jest.mock('path', () => ({
  resolve: jest.fn((...args) => args.join('/')),
  join: jest.fn((...args) => args.join('/')),
}));
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
}));
jest.mock('./threshold-handler', () => ({
  getProjectThresholds: jest.fn(),
}));

describe('coverage-evaluator', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.COVERAGE_THRESHOLDS = JSON.stringify({
      global: { lines: 80, statements: 80, functions: 75, branches: 70 },
      projects: {}
    });

    // Setup default mocks for file system operations
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.readdirSync as jest.Mock).mockReturnValue([]);
    (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
    (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);
    (fs.readFileSync as jest.Mock).mockReturnValue('{}');
    (path.resolve as jest.Mock).mockImplementation((...args) => args.join('/'));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('evaluateCoverage', () => {
    it('should return zero failures when COVERAGE_THRESHOLDS is not set', () => {
      delete process.env.COVERAGE_THRESHOLDS;

      const result = evaluateCoverage(['project-a'], { global: {}, projects: {} });

      expect(result).toBe(0);
      expect(core.info).toHaveBeenCalledWith('No coverage thresholds defined, skipping evaluation');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should skip projects with null thresholds and not count them as failures', () => {
      const mockGetProjectThresholds = getProjectThresholds as jest.Mock;
      mockGetProjectThresholds.mockReturnValue(null);

      // Mock coverage directory exists but is empty
      (fs.existsSync as jest.Mock).mockImplementation((filePath) => {
        return filePath.includes('coverage') && !filePath.includes('coverage-summary.json');
      });

      const result = evaluateCoverage(['project-a'], { global: {}, projects: {} });

      expect(result).toBe(0);
      expect(core.info).toHaveBeenCalledWith('Coverage evaluation skipped for project-a');

      // Should write coverage report with skipped project showing individual metrics
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('coverage-report.txt'),
        expect.stringContaining('⏩ SKIPPED')
      );

      // Verify that the comment shows individual metrics for skipped project
      const writeFileCalls = (fs.writeFileSync as jest.Mock).mock.calls;
      const coverageReportCall = writeFileCalls.find(call => call[0].includes('coverage-report.txt'));
      expect(coverageReportCall).toBeDefined();

      const comment = coverageReportCall[1];
      expect(comment).toContain('| project-a | lines | N/A | N/A | ⏩ SKIPPED |');
      expect(comment).toContain('|  | statements | N/A | N/A | ⏩ SKIPPED |');
      expect(comment).toContain('|  | functions | N/A | N/A | ⏩ SKIPPED |');
      expect(comment).toContain('|  | branches | N/A | N/A | ⏩ SKIPPED |');
    });

    it('should count as one failure when coverage report is missing', () => {
      const mockGetProjectThresholds = getProjectThresholds as jest.Mock;
      mockGetProjectThresholds.mockReturnValue({ lines: 80, statements: 75 });

      // Mock coverage directory exists but no coverage files
      (fs.existsSync as jest.Mock).mockImplementation((filePath) => {
        return filePath.includes('coverage') && !filePath.includes('coverage-summary.json');
      });
      (fs.readdirSync as jest.Mock).mockReturnValue([]); // Empty directory

      const result = evaluateCoverage(['project-a'], { global: {}, projects: {} });

      expect(result).toBe(1);
      expect(core.warning).toHaveBeenCalledWith('No coverage data found for project-a in any location');

      // Verify that the comment shows individual thresholds with "No Data"
      const writeFileCalls = (fs.writeFileSync as jest.Mock).mock.calls;
      const coverageReportCall = writeFileCalls.find(call => call[0].includes('coverage-report.txt'));
      expect(coverageReportCall).toBeDefined();

      const comment = coverageReportCall[1];
      expect(comment).toContain('| project-a | lines | 80% | No Data | ❌ FAILED |');
      expect(comment).toContain('|  | statements | 75% | No Data | ❌ FAILED |');
      expect(comment).toContain('⚠️ WARNING (1 project failing)');
    });

    it('should count one failure when coverage is below thresholds', () => {
      const mockGetProjectThresholds = getProjectThresholds as jest.Mock;
      mockGetProjectThresholds.mockReturnValue({
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 70
      });

      // Mock coverage directory and files exist
      (fs.existsSync as jest.Mock).mockImplementation((filePath) => {
        if (filePath.includes('coverage') && !filePath.includes('coverage-summary.json')) {
          return true; // Coverage directory exists
        }
        return filePath.includes('coverage-summary.json'); // Coverage file exists
      });
      (fs.readdirSync as jest.Mock).mockReturnValue(['project-a']);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });

      const mockReadFileSync = fs.readFileSync as jest.Mock;
      mockReadFileSync.mockReturnValue(JSON.stringify({
        total: {
          lines: { pct: 75 },
          statements: { pct: 75 },
          functions: { pct: 70 },
          branches: { pct: 65 }
        }
      }));

      const result = evaluateCoverage(['project-a'], { global: {}, projects: {} });

      expect(result).toBe(1);
      expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Project project-a failed coverage thresholds'));

      // Verify that the comment shows the failed metrics with correct values
      const writeFileCalls = (fs.writeFileSync as jest.Mock).mock.calls;
      const coverageReportCall = writeFileCalls.find(call => call[0].includes('coverage-report.txt'));
      expect(coverageReportCall).toBeDefined();

      const comment = coverageReportCall[1];
      expect(comment).toContain('| project-a | lines | 80% | 75.00% | ❌ FAILED |');
      expect(comment).toContain('|  | statements | 80% | 75.00% | ❌ FAILED |');
      expect(comment).toContain('|  | functions | 75% | 70.00% | ❌ FAILED |');
      expect(comment).toContain('|  | branches | 70% | 65.00% | ❌ FAILED |');
      expect(comment).toContain('### Overall Status: ⚠️ WARNING (1 project failing)');
      expect(comment).toContain('Note: The build will continue, but this project should be fixed before merging.');
    });

    it('should return zero failures when coverage meets thresholds', () => {
      const mockGetProjectThresholds = getProjectThresholds as jest.Mock;
      mockGetProjectThresholds.mockReturnValue({
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 70
      });

      // Mock coverage directory and files exist
      (fs.existsSync as jest.Mock).mockImplementation((filePath) => {
        if (filePath.includes('coverage') && !filePath.includes('coverage-summary.json')) {
          return true; // Coverage directory exists
        }
        return filePath.includes('coverage-summary.json'); // Coverage file exists
      });
      (fs.readdirSync as jest.Mock).mockReturnValue(['project-a']);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });

      const mockReadFileSync = fs.readFileSync as jest.Mock;
      mockReadFileSync.mockReturnValue(JSON.stringify({
        total: {
          lines: { pct: 85 },
          statements: { pct: 85 },
          functions: { pct: 80 },
          branches: { pct: 75 }
        }
      }));

      const result = evaluateCoverage(['project-a'], { global: {}, projects: {} });

      expect(result).toBe(0);
      expect(core.info).toHaveBeenCalledWith('Project project-a passed all coverage thresholds');

      // Verify that the comment shows passing status with correct values
      const writeFileCalls = (fs.writeFileSync as jest.Mock).mock.calls;
      const coverageReportCall = writeFileCalls.find(call => call[0].includes('coverage-report.txt'));
      expect(coverageReportCall).toBeDefined();

      const comment = coverageReportCall[1];
      expect(comment).toContain('| project-a | lines | 80% | 85.00% | ✅ PASSED |');
      expect(comment).toContain('|  | statements | 80% | 85.00% | ✅ PASSED |');
      expect(comment).toContain('|  | functions | 75% | 80.00% | ✅ PASSED |');
      expect(comment).toContain('|  | branches | 70% | 75.00% | ✅ PASSED |');
      expect(comment).toContain('### Overall Status: ✅ PASSED');
    });

    it('should count one failure for errors in coverage processing', () => {
      const mockGetProjectThresholds = getProjectThresholds as jest.Mock;
      mockGetProjectThresholds.mockReturnValue({
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 70
      });

      // Mock coverage directory and files exist
      (fs.existsSync as jest.Mock).mockImplementation((filePath) => {
        if (filePath.includes('coverage') && !filePath.includes('coverage-summary.json')) {
          return true; // Coverage directory exists
        }
        return filePath.includes('coverage-summary.json'); // Coverage file exists
      });
      (fs.readdirSync as jest.Mock).mockReturnValue(['project-a']);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });

      const mockReadFileSync = fs.readFileSync as jest.Mock;
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Test error');
      });

      const result = evaluateCoverage(['project-a'], { global: {}, projects: {} });

      expect(result).toBe(1);
      expect(core.error).toHaveBeenCalledWith('Error parsing coverage file for project-a: Test error');

      // Verify that the comment shows individual thresholds with "No Data"
      const writeFileCalls = (fs.writeFileSync as jest.Mock).mock.calls;
      const coverageReportCall = writeFileCalls.find(call => call[0].includes('coverage-report.txt'));
      expect(coverageReportCall).toBeDefined();

      const comment = coverageReportCall[1];
      expect(comment).toContain('| project-a | lines | 80% | No Data | ❌ FAILED |');
      expect(comment).toContain('|  | statements | 80% | No Data | ❌ FAILED |');
      expect(comment).toContain('|  | functions | 75% | No Data | ❌ FAILED |');
      expect(comment).toContain('|  | branches | 70% | No Data | ❌ FAILED |');
      expect(comment).toContain('### Overall Status: ⚠️ WARNING (1 project failing)');
    });

    it('should pass even when some metrics are missing from thresholds', () => {
      const mockGetProjectThresholds = getProjectThresholds as jest.Mock;
      // Only include lines and functions thresholds
      mockGetProjectThresholds.mockReturnValue({
        lines: 80,
        functions: 75
      });

      // Mock coverage directory and files exist
      (fs.existsSync as jest.Mock).mockImplementation((filePath) => {
        if (filePath.includes('coverage') && !filePath.includes('coverage-summary.json')) {
          return true; // Coverage directory exists
        }
        return filePath.includes('coverage-summary.json'); // Coverage file exists
      });
      (fs.readdirSync as jest.Mock).mockReturnValue(['project-a']);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });

      const mockReadFileSync = fs.readFileSync as jest.Mock;
      mockReadFileSync.mockReturnValue(JSON.stringify({
        total: {
          lines: { pct: 85 },
          statements: { pct: 85 },
          functions: { pct: 80 },
          branches: { pct: 75 }
        }
      }));

      const result = evaluateCoverage(['project-a'], { global: {}, projects: {} });

      expect(result).toBe(0);

      // Verify that only the defined thresholds are in the comment
      const writeFileCalls = (fs.writeFileSync as jest.Mock).mock.calls;
      const coverageReportCall = writeFileCalls.find(call => call[0].includes('coverage-report.txt'));
      expect(coverageReportCall).toBeDefined();

      const comment = coverageReportCall[1];
      expect(comment).toContain('| project-a | lines | 80% | 85.00% | ✅ PASSED |');
      expect(comment).toContain('|  | functions | 75% | 80.00% | ✅ PASSED |');
      expect(comment).not.toContain('|  | statements |');
      expect(comment).not.toContain('|  | branches |');
    });

    it('should skip projects with empty threshold objects', () => {
      const mockGetProjectThresholds = getProjectThresholds as jest.Mock;
      // Return an empty object instead of null
      mockGetProjectThresholds.mockReturnValue({});

      // Mock coverage directory exists but is empty
      (fs.existsSync as jest.Mock).mockImplementation((filePath) => {
        return filePath.includes('coverage') && !filePath.includes('coverage-summary.json');
      });

      const result = evaluateCoverage(['project-a'], { global: {}, projects: {} });

      // Should skip because no specific thresholds were set (empty object)
      expect(result).toBe(0);
      expect(core.info).toHaveBeenCalledWith('Coverage evaluation skipped for project-a (no thresholds defined)');

      // Verify that the comment shows skipped status
      const writeFileCalls = (fs.writeFileSync as jest.Mock).mock.calls;
      const coverageReportCall = writeFileCalls.find(call => call[0].includes('coverage-report.txt'));
      expect(coverageReportCall).toBeDefined();

      const comment = coverageReportCall[1];
      expect(comment).toContain('| project-a | lines | N/A | N/A | ⏩ SKIPPED |');
      expect(comment).toContain('|  | statements | N/A | N/A | ⏩ SKIPPED |');
      expect(comment).toContain('|  | functions | N/A | N/A | ⏩ SKIPPED |');
      expect(comment).toContain('|  | branches | N/A | N/A | ⏩ SKIPPED |');
    });

    it('should correctly handle mix of skipped, passed, and failed projects', () => {
      const mockGetProjectThresholds = getProjectThresholds as jest.Mock;
      mockGetProjectThresholds
        .mockReturnValueOnce(null) // project-a: explicitly null (skip)
        .mockReturnValueOnce({}) // project-b: empty thresholds (skip)
        .mockReturnValueOnce({ lines: 80, statements: 80 }) // project-c: has thresholds
        .mockReturnValueOnce({ lines: 90, statements: 90 }); // project-d: has thresholds

      // Mock coverage directory and files exist for projects that aren't skipped
      (fs.existsSync as jest.Mock).mockImplementation((filePath) => {
        if (filePath.includes('coverage') && !filePath.includes('coverage-summary.json')) {
          return true; // Coverage directory exists
        }
        // Coverage files exist for project-c only
        return filePath.includes('project-c') && filePath.includes('coverage-summary.json');
      });

      (fs.readdirSync as jest.Mock).mockReturnValue(['project-c']);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });

      const mockReadFileSync = fs.readFileSync as jest.Mock;
      mockReadFileSync.mockReturnValue(JSON.stringify({
        total: {
          lines: { pct: 85 },
          statements: { pct: 85 },
          functions: { pct: 80 },
          branches: { pct: 75 }
        }
      }));

      const result = evaluateCoverage(['project-a', 'project-b', 'project-c', 'project-d'], {
        global: { lines: 80, statements: 80 },
        projects: {}
      });

      // One project failed (project-d - no coverage data), two were skipped, one passed
      expect(result).toBe(1);

      // Verify logs
      expect(core.info).toHaveBeenCalledWith('Coverage evaluation skipped for project-a (null thresholds)');
      expect(core.info).toHaveBeenCalledWith('Coverage evaluation skipped for project-b (no thresholds defined)');
      expect(core.info).toHaveBeenCalledWith('Project project-c passed all coverage thresholds');
      expect(core.warning).toHaveBeenCalledWith('No coverage data found for project-d in any location');

      // Verify that the comment shows correct status for each project
      const writeFileCalls = (fs.writeFileSync as jest.Mock).mock.calls;
      const coverageReportCall = writeFileCalls.find(call => call[0].includes('coverage-report.txt'));
      expect(coverageReportCall).toBeDefined();

      const comment = coverageReportCall[1];

      // project-a: skipped (null)
      expect(comment).toContain('| project-a | lines | N/A | N/A | ⏩ SKIPPED |');

      // project-b: skipped (empty)
      expect(comment).toContain('| project-b | lines | N/A | N/A | ⏩ SKIPPED |');

      // project-c: passed
      expect(comment).toContain('| project-c | lines | 80% | 85.00% | ✅ PASSED |');

      // project-d: failed (no coverage data)
      expect(comment).toContain('| project-d | lines | 90% | No Data | ❌ FAILED |');

      // Overall status should show 1 project failing (warning level)
      expect(comment).toContain('### Overall Status: ⚠️ WARNING (1 project failing)');
    });

    it('should count multiple failures correctly', () => {
      // First project passes
      // Second project is skipped
      // Third project fails
      // Fourth project fails because no coverage data
      const mockGetProjectThresholds = getProjectThresholds as jest.Mock;
      mockGetProjectThresholds
        .mockReturnValueOnce({
          lines: 80,
          statements: 80,
          functions: 75,
          branches: 70
        })
        .mockReturnValueOnce(null) // Skip project-b
        .mockReturnValueOnce({
          lines: 70,
          statements: 70,
          functions: 65,
          branches: 60
        })
        .mockReturnValueOnce({
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90
        });

      // Mock coverage directory exists
      (fs.existsSync as jest.Mock).mockImplementation((filePath) => {
        if (filePath.includes('coverage') && !filePath.includes('coverage-summary.json')) {
          return true; // Coverage directory exists
        }
        // Coverage files exist for project-a and project-c
        if (filePath.includes('project-a') || filePath.includes('project-c')) {
          return filePath.includes('coverage-summary.json');
        }
        // No coverage files for project-d
        return false;
      });

      (fs.readdirSync as jest.Mock).mockReturnValue(['project-a', 'project-c']);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });

      const mockReadFileSync = fs.readFileSync as jest.Mock;
      mockReadFileSync
        .mockReturnValueOnce(JSON.stringify({
          total: {
            lines: { pct: 85 },
            statements: { pct: 85 },
            functions: { pct: 80 },
            branches: { pct: 75 }
          }
        }))
        .mockReturnValueOnce(JSON.stringify({
          total: {
            lines: { pct: 65 },
            statements: { pct: 65 },
            functions: { pct: 60 },
            branches: { pct: 55 }
          }
        }));

      process.env.COVERAGE_ARTIFACT_URL = 'https://example.com/artifact';

      const result = evaluateCoverage(['project-a', 'project-b', 'project-c', 'project-d'], {
        global: { lines: 80, statements: 80, functions: 75, branches: 70 },
        projects: {}
      });

      // Two projects failed
      expect(result).toBe(2);

      // Verify that the comment shows the correct status for each project
      const writeFileCalls = (fs.writeFileSync as jest.Mock).mock.calls;
      const coverageReportCall = writeFileCalls.find(call => call[0].includes('coverage-report.txt'));
      expect(coverageReportCall).toBeDefined();

      const comment = coverageReportCall[1];

      // Project A passes
      expect(comment).toContain('| project-a | lines | 80% | 85.00% | ✅ PASSED |');

      // Project B is skipped (now shows individual metrics)
      expect(comment).toContain('| project-b | lines | N/A | N/A | ⏩ SKIPPED |');
      expect(comment).toContain('|  | statements | N/A | N/A | ⏩ SKIPPED |');
      expect(comment).toContain('|  | functions | N/A | N/A | ⏩ SKIPPED |');
      expect(comment).toContain('|  | branches | N/A | N/A | ⏩ SKIPPED |');

      // Project C fails
      expect(comment).toContain('| project-c | lines | 70% | 65.00% | ❌ FAILED |');

      // Project D has no coverage data
      expect(comment).toContain('| project-d | lines | 90% | No Data | ❌ FAILED |');
      expect(comment).toContain('|  | statements | 90% | No Data | ❌ FAILED |');
      expect(comment).toContain('|  | functions | 90% | No Data | ❌ FAILED |');
      expect(comment).toContain('|  | branches | 90% | No Data | ❌ FAILED |');

      // Overall status is failed with multiple projects
      expect(comment).toContain('### Overall Status: ❌ FAILED (2 projects failing)');
      expect(comment).toContain('Note: Multiple projects fail coverage thresholds. This PR will be blocked until fixed.');

      // Artifact URL is included
      expect(comment).toContain('📊 [View Detailed HTML Coverage Reports](https://example.com/artifact)');
    });
  });

  describe('generateEmptyCoverageReport', () => {
    it('should generate an empty report when no projects are affected', () => {
      generateEmptyCoverageReport();

      const writeFileCalls = (fs.writeFileSync as jest.Mock).mock.calls;
      expect(writeFileCalls.length).toBeGreaterThan(0);

      const coverageReportCall = writeFileCalls.find(call => call[0].includes('coverage-report.txt'));
      expect(coverageReportCall).toBeDefined();

      const [filePath, content] = coverageReportCall;
      expect(filePath).toContain('coverage-report.txt');
      expect(content).toContain('## Test Coverage Results');
      expect(content).toContain('No projects were affected by this change that require coverage evaluation');

      expect(core.info).toHaveBeenCalledWith('Empty coverage report generated (no affected projects)');
    });
  });

  describe('generateTestFailureReport', () => {
    it('should generate a test failure report with project names', () => {
      const { generateTestFailureReport } = require('./coverage-evaluator');

      generateTestFailureReport(['project-a', 'project-b']);

      const writeFileCalls = (fs.writeFileSync as jest.Mock).mock.calls;
      expect(writeFileCalls.length).toBeGreaterThan(0);

      const coverageReportCall = writeFileCalls.find(call => call[0].includes('coverage-report.txt'));
      expect(coverageReportCall).toBeDefined();

      const [filePath, content] = coverageReportCall;
      expect(filePath).toContain('coverage-report.txt');
      expect(content).toContain('## Test Coverage Results');
      expect(content).toContain('Tests failed to execute');
      expect(content).toContain('project-a, project-b');
      expect(content).toContain('Overall Status: ❌ FAILED (Test execution failed)');

      expect(core.info).toHaveBeenCalledWith('Test failure report generated for PR comment');
    });

    it('should generate a test failure report with no specific projects', () => {
      const { generateTestFailureReport } = require('./coverage-evaluator');

      generateTestFailureReport([]);

      const writeFileCalls = (fs.writeFileSync as jest.Mock).mock.calls;
      expect(writeFileCalls.length).toBeGreaterThan(0);

      const coverageReportCall = writeFileCalls.find(call => call[0].includes('coverage-report.txt'));
      expect(coverageReportCall).toBeDefined();

      const [filePath, content] = coverageReportCall;
      expect(filePath).toContain('coverage-report.txt');
      expect(content).toContain('## Test Coverage Results');
      expect(content).toContain('Tests failed to execute');
      expect(content).toContain('affected projects');
      expect(content).toContain('Overall Status: ❌ FAILED (Test execution failed)');

      expect(core.info).toHaveBeenCalledWith('Test failure report generated for PR comment');
    });
  });
});
