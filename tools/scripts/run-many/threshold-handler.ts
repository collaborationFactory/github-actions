import * as core from '@actions/core';

export interface CoverageThreshold {
  lines?: number;
  statements?: number;
  functions?: number;
  branches?: number;
}

export interface ThresholdConfig {
  global: CoverageThreshold;
  projects: Record<string, CoverageThreshold | null>;
}

/**
 * Parses the COVERAGE_THRESHOLDS environment variable
 *
 * Configuration format:
 * {
 *   "global": { "lines": 80, "statements": 80, "functions": 75, "branches": 70 },
 *   "projects": {
 *     "project-a": { "lines": 90 },     // Override global thresholds
 *     "project-b": null,                // Explicitly skip this project
 *     "project-c": {}                   // Skip this project (empty thresholds)
 *   }
 * }
 *
 * Projects are skipped when:
 * - Explicitly set to null in the projects configuration
 * - Have empty threshold objects ({})
 * - No thresholds defined anywhere (no global, no project-specific)
 */
export function getCoverageThresholds(): ThresholdConfig {
  if (!process.env.COVERAGE_THRESHOLDS) {
    core.info('No coverage thresholds defined, using empty configuration');
    return { global: {}, projects: {} };
  }

  try {
    const thresholdConfig = JSON.parse(process.env.COVERAGE_THRESHOLDS);
    core.info(`Successfully parsed coverage thresholds`);

    // Validate structure
    if (!thresholdConfig.global) {
      core.warning('No global thresholds defined in configuration');
    }

    return thresholdConfig;
  } catch (error) {
    core.error(`Error parsing COVERAGE_THRESHOLDS: ${error.message}`);
    return { global: {}, projects: {} };
  }
}

/**
 * Gets thresholds for a specific project
 */
export function getProjectThresholds(project: string, thresholds: ThresholdConfig): CoverageThreshold | null {
  // If project explicitly set to null, return null to skip
  if (thresholds.projects && thresholds.projects[project] === null) {
    core.info(`Project ${project} is set to null in config, skipping coverage evaluation`);
    return null;
  }

  // If project has specific thresholds, use those
  if (thresholds.projects && thresholds.projects[project]) {
    core.info(`Using specific thresholds for project ${project}`);
    return thresholds.projects[project];
  }

  // Otherwise, use global thresholds if available
  if (thresholds.global) {
    core.info(`Using global thresholds for project ${project}`);
    return thresholds.global;
  }

  // If no thresholds defined, return null
  core.warning(`No thresholds defined for project ${project} and no global thresholds available`);
  return null;
}
