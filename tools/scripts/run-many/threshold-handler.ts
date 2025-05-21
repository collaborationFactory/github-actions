import * as core from '@actions/core';

/**
 * Interface representing coverage thresholds for a project
 */
export interface CoverageThreshold {
  lines?: number;
  statements?: number;
  functions?: number;
  branches?: number;
}

/**
 * Interface representing the complete threshold configuration
 * with global defaults and project-specific overrides
 */
export interface ThresholdConfig {
  global: CoverageThreshold;
  projects: Record<string, CoverageThreshold | null>;
}

/**
 * Parses the COVERAGE_THRESHOLDS environment variable
 * @returns The parsed threshold configuration or empty defaults if not provided
 */
export function getCoverageThresholds(): ThresholdConfig {
  if (!process.env.COVERAGE_THRESHOLDS) {
    return { global: {}, projects: {} };
  }

  try {
    return JSON.parse(process.env.COVERAGE_THRESHOLDS);
  } catch (error) {
    core.error(`Error parsing COVERAGE_THRESHOLDS: ${error.message}`);
    return { global: {}, projects: {} };
  }
}

/**
 * Gets thresholds for a specific project
 * @param project The project name
 * @param thresholds The threshold configuration
 * @returns Project-specific thresholds, global thresholds, or null if none defined or explicitly skipped
 */
export function getProjectThresholds(project: string, thresholds: ThresholdConfig): CoverageThreshold | null {
  // If project explicitly set to null, return null to skip
  if (thresholds.projects && thresholds.projects[project] === null) {
    return null;
  }

  // If project has specific thresholds, use those
  if (thresholds.projects && thresholds.projects[project]) {
    return thresholds.projects[project];
  }

  // Otherwise, use global thresholds if available
  if (thresholds.global) {
    return thresholds.global;
  }

  // If no thresholds defined, return null
  return null;
}