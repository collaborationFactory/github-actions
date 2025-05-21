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
}));
jest.mock('path', () => ({
  resolve: jest.fn((_, p) => p),
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
    });

    it('should skip projects with null thresholds and not count them as failures', () => {
      const mockGetProjectThresholds = getProjectThresholds as jest.Mock;
      mockGetProjectThresholds.mockReturnValue(null);

      const result = evaluateCoverage(['project-a'], { global: {}, projects: {} });

      expect(result).toBe(0);
      expect(core.info).toHaveBeenCalledWith('Coverage evaluation skipped for project-a');
      expect(fs.writeFileSync).toHaveBeenCalled();

      // Verify that the comment indicates the project was skipped
      const writeFileSyncMock = fs.writeFileSync as jest.Mock;
      const comment = writeFileSyncMock.mock.calls[0][1];
      expect(comment).toContain('⏩ SKIPPED');
    });

    it('should count as one failure when coverage report is missing', () => {
      const mockGetProjectThresholds = getProjectThresholds as jest.Mock;
      mockGetProjectThresholds.mockReturnValue({ lines: 80 });

      const mockExistsSync = fs.existsSync as jest.Mock;
      mockExistsSync.mockReturnValue(false);

      const result = evaluateCoverage(['project-a'], { global: {}, projects: {} });

      expect(result).toBe(1);
      expect(core.warning).toHaveBeenCalledWith('No coverage report found for project-a at coverage/project-a/coverage-summary.json');

      // Verify that the comment indicates the project failed due to missing report
      const writeFileSyncMock = fs.writeFileSync as jest.Mock;
      const comment = writeFileSyncMock.mock.calls[0][1];
      expect(comment).toContain('❌ FAILED');
      expect(comment).toContain('No Data');
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

      const mockExistsSync = fs.existsSync as jest.Mock;
      mockExistsSync.mockReturnValue(true);

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
      const writeFileSyncMock = fs.writeFileSync as jest.Mock;
      const comment = writeFileSyncMock.mock.calls[0][1];
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

      const mockExistsSync = fs.existsSync as jest.Mock;
      mockExistsSync.mockReturnValue(true);

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
      const writeFileSyncMock = fs.writeFileSync as jest.Mock;
      const comment = writeFileSyncMock.mock.calls[0][1];
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

      const mockExistsSync = fs.existsSync as jest.Mock;
      mockExistsSync.mockReturnValue(true);

      const mockReadFileSync = fs.readFileSync as jest.Mock;
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Test error');
      });

      const result = evaluateCoverage(['project-a'], { global: {}, projects: {} });

      expect(result).toBe(1);
      expect(core.error).toHaveBeenCalledWith('Error processing coverage for project-a: Test error');

      // Verify that the comment shows an error status
      const writeFileSyncMock = fs.writeFileSync as jest.Mock;
      const comment = writeFileSyncMock.mock.calls[0][1];
      expect(comment).toContain('❌ FAILED');
      expect(comment).toContain('No Data');
      expect(comment).toContain('### Overall Status: ⚠️ WARNING (1 project failing)');
    });

    it('should pass even when some metrics are missing from thresholds', () => {
      const mockGetProjectThresholds = getProjectThresholds as jest.Mock;
      // Only include lines and functions thresholds
      mockGetProjectThresholds.mockReturnValue({
        lines: 80,
        functions: 75
      });

      const mockExistsSync = fs.existsSync as jest.Mock;
      mockExistsSync.mockReturnValue(true);

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
      const writeFileSyncMock = fs.writeFileSync as jest.Mock;
      const comment = writeFileSyncMock.mock.calls[0][1];
      expect(comment).toContain('| project-a | lines | 80% | 85.00% | ✅ PASSED |');
      expect(comment).toContain('|  | functions | 75% | 80.00% | ✅ PASSED |');
      expect(comment).not.toContain('|  | statements |');
      expect(comment).not.toContain('|  | branches |');
    });

    it('should treat empty threshold objects as valid thresholds', () => {
      const mockGetProjectThresholds = getProjectThresholds as jest.Mock;
      // Return an empty object instead of null
      mockGetProjectThresholds.mockReturnValue({});

      const mockExistsSync = fs.existsSync as jest.Mock;
      mockExistsSync.mockReturnValue(true);

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

      // Should pass because no specific thresholds were set
      expect(result).toBe(0);
      expect(core.info).toHaveBeenCalledWith('Project project-a passed all coverage thresholds');
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

      const mockExistsSync = fs.existsSync as jest.Mock;
      // Make existsSync return true for project-a and project-c, but false for project-d
      mockExistsSync.mockImplementation((path) => {
        if (path.includes('project-d')) {
          return false; // No coverage file for project-d
        }
        return true;
      });

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
      // No need for third mock since we're making project-d file not exist

      process.env.COVERAGE_ARTIFACT_URL = 'https://example.com/artifact';

      const result = evaluateCoverage(['project-a', 'project-b', 'project-c', 'project-d'], {
        global: { lines: 80, statements: 80, functions: 75, branches: 70 },
        projects: {}
      });

      // Two projects failed
      expect(result).toBe(2);

      // Verify that the comment shows the correct status for each project
      const writeFileSyncMock = fs.writeFileSync as jest.Mock;
      const comment = writeFileSyncMock.mock.calls[0][1];

      // Project A passes
      expect(comment).toContain('| project-a | lines | 80% | 85.00% | ✅ PASSED |');

      // Project B is skipped
      expect(comment).toContain('| project-b | All | N/A | N/A | ⏩ SKIPPED |');

      // Project C fails
      expect(comment).toContain('| project-c | lines | 70% | 65.00% | ❌ FAILED |');

      // Project D has no coverage data
      expect(comment).toContain('| project-d | All | Defined | No Data | ❌ FAILED |');

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

      const writeFileSyncMock = fs.writeFileSync as jest.Mock;
      expect(writeFileSyncMock).toHaveBeenCalledTimes(1);

      const [filePath, content] = writeFileSyncMock.mock.calls[0];
      expect(filePath).toBe('coverage-report.txt');
      expect(content).toContain('## Test Coverage Results');
      expect(content).toContain('No projects were affected by this change that require coverage evaluation');

      expect(core.info).toHaveBeenCalledWith('Empty coverage report generated (no affected projects)');
    });
  });
});
