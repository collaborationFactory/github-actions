import * as core from '@actions/core';
import { getCoverageThresholds, getProjectThresholds, CoverageThreshold, ThresholdConfig } from './threshold-handler';

// Mock @actions/core
jest.mock('@actions/core', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
}));

describe('threshold-handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getCoverageThresholds', () => {
    it('should return empty thresholds when COVERAGE_THRESHOLDS is not set', () => {
      delete process.env.COVERAGE_THRESHOLDS;

      const result = getCoverageThresholds();

      expect(result).toEqual({ global: {}, projects: {} });
      expect(core.info).toHaveBeenCalledWith('No coverage thresholds defined, using empty configuration');
    });

    it('should parse valid JSON from COVERAGE_THRESHOLDS', () => {
      const thresholdConfig: ThresholdConfig = {
        global: { lines: 80, statements: 80, functions: 75, branches: 70 },
        projects: {
          'project-a': { lines: 90, statements: 90, functions: 85, branches: 80 },
          'project-b': null
        }
      };

      process.env.COVERAGE_THRESHOLDS = JSON.stringify(thresholdConfig);

      const result = getCoverageThresholds();

      expect(result).toEqual(thresholdConfig);
      expect(core.info).toHaveBeenCalledWith('Successfully parsed coverage thresholds');
    });

    it('should handle invalid JSON in COVERAGE_THRESHOLDS', () => {
      process.env.COVERAGE_THRESHOLDS = 'invalid-json';

      const result = getCoverageThresholds();

      expect(result).toEqual({ global: {}, projects: {} });
      expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Error parsing COVERAGE_THRESHOLDS'));
    });

    it('should log warning when global thresholds are missing', () => {
      process.env.COVERAGE_THRESHOLDS = JSON.stringify({
        projects: {
          'project-a': { lines: 90 }
        }
      });

      const result = getCoverageThresholds();

      expect(result).toEqual({
        projects: {
          'project-a': { lines: 90 }
        }
      });
      expect(core.warning).toHaveBeenCalledWith('No global thresholds defined in configuration');
    });

    it('should handle thresholds with missing properties', () => {
      // Only specify lines and branches
      const thresholdConfig = {
        global: { lines: 80, branches: 70 },
        projects: {
          'project-a': { functions: 85 }
        }
      };

      process.env.COVERAGE_THRESHOLDS = JSON.stringify(thresholdConfig);

      const result = getCoverageThresholds();

      expect(result).toEqual(thresholdConfig);
    });
  });

  describe('getProjectThresholds', () => {
    it('should return null for projects explicitly set to null', () => {
      const thresholds: ThresholdConfig = {
        global: { lines: 80 },
        projects: { 'project-a': null }
      };

      const result = getProjectThresholds('project-a', thresholds);

      expect(result).toBeNull();
      expect(core.info).toHaveBeenCalledWith('Project project-a is set to null in config, skipping coverage evaluation');
    });

    it('should return project-specific thresholds when available', () => {
      const projectThresholds: CoverageThreshold = {
        lines: 90,
        statements: 90,
        functions: 85,
        branches: 80
      };

      const thresholds: ThresholdConfig = {
        global: { lines: 80, statements: 80, functions: 75, branches: 70 },
        projects: {
          'project-a': projectThresholds
        }
      };

      const result = getProjectThresholds('project-a', thresholds);

      expect(result).toEqual(projectThresholds);
      expect(core.info).toHaveBeenCalledWith('Using specific thresholds for project project-a');
    });

    it('should fall back to global thresholds when project-specific ones don\'t exist', () => {
      const globalThresholds: CoverageThreshold = {
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 70
      };

      const thresholds: ThresholdConfig = {
        global: globalThresholds,
        projects: {
          'project-a': { lines: 90, statements: 90, functions: 85, branches: 80 }
        }
      };

      const result = getProjectThresholds('project-b', thresholds);

      expect(result).toEqual(globalThresholds);
      expect(core.info).toHaveBeenCalledWith('Using global thresholds for project project-b');
    });

    it('should return empty object when global exists but is empty', () => {
      const thresholds: ThresholdConfig = {
        global: {}, // Empty but exists
        projects: {}
      };

      const result = getProjectThresholds('project-a', thresholds);

      // Since global exists but is empty, it will return the empty object
      expect(result).toEqual({});
      expect(core.info).toHaveBeenCalledWith('Using global thresholds for project project-a');
    });

    it('should return null when global is undefined', () => {
      // Create a config where global is undefined
      const thresholds = {
        projects: {}
      } as ThresholdConfig;

      const result = getProjectThresholds('project-a', thresholds);

      expect(result).toBeNull();
      expect(core.warning).toHaveBeenCalledWith('No thresholds defined for project project-a and no global thresholds available');
    });

    it('should handle partial project thresholds', () => {
      const thresholds: ThresholdConfig = {
        global: { lines: 80, statements: 80, functions: 75, branches: 70 },
        projects: {
          'project-a': { lines: 90 } // Only line threshold specified
        }
      };

      const result = getProjectThresholds('project-a', thresholds);

      expect(result).toEqual({ lines: 90 });
      expect(core.info).toHaveBeenCalledWith('Using specific thresholds for project project-a');
    });

    it('should handle missing projects object', () => {
      const thresholds = {
        global: { lines: 80, statements: 80, functions: 75, branches: 70 }
      } as ThresholdConfig;

      const result = getProjectThresholds('project-a', thresholds);

      expect(result).toEqual({ lines: 80, statements: 80, functions: 75, branches: 70 });
      expect(core.info).toHaveBeenCalledWith('Using global thresholds for project project-a');
    });
  });
});
