import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import { CoverageThreshold, getProjectThresholds, ThresholdConfig } from './threshold-handler';

interface CoverageSummary {
  lines: { pct: number };
  statements: { pct: number };
  functions: { pct: number };
  branches: { pct: number };
}

interface ProjectCoverageResult {
  project: string;
  thresholds: CoverageThreshold | null;
  actual: {
    lines: number;
    statements: number;
    functions: number;
    branches: number;
  } | null;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
}

/**
 * Tries to find coverage summary file in common locations
 */
function findCoverageSummaryFile(project: string): string | null {
  const possiblePaths = [
    // Standard Nx project structure
    `coverage/${project}/coverage-summary.json`,
    // Alternative coverage directory structure
    `coverage/coverage-summary.json`,
    // Project-specific coverage in different patterns
    `coverage/apps/${project}/coverage-summary.json`,
    `coverage/libs/${project}/coverage-summary.json`,
    // Jest default location for the project
    `coverage/lcov-report/coverage-summary.json`,
    // Project-specific coverage in project directory
    `apps/${project}/coverage/coverage-summary.json`,
    `libs/${project}/coverage/coverage-summary.json`,
    // Nx workspace structure variations
    `dist/coverage/${project}/coverage-summary.json`,
    `tmp/coverage/${project}/coverage-summary.json`
  ];

  for (const possiblePath of possiblePaths) {
    const fullPath = path.resolve(process.cwd(), possiblePath);
    if (fs.existsSync(fullPath)) {
      core.info(`Found coverage file for ${project} at: ${fullPath}`);
      return fullPath;
    }
  }

  return null;
}

/**
 * Tries to read coverage from a global coverage file that might contain multiple projects
 */
function tryReadFromGlobalCoverage(project: string): CoverageSummary | null {
  const globalCoveragePath = path.resolve(process.cwd(), 'coverage/coverage-summary.json');

  if (!fs.existsSync(globalCoveragePath)) {
    return null;
  }

  try {
    const globalCoverageData = JSON.parse(fs.readFileSync(globalCoveragePath, 'utf8'));

    // Look for project-specific data in the global file
    const projectPatterns = [
      project,
      `apps/${project}`,
      `libs/${project}`,
      `src/app/${project}`,
      `projects/${project}`
    ];

    for (const pattern of projectPatterns) {
      if (globalCoverageData[pattern]) {
        core.info(`Found coverage data for ${project} under key '${pattern}' in global coverage file`);
        return globalCoverageData[pattern];
      }
    }

    // Try to find any key that contains the project name
    const keys = Object.keys(globalCoverageData);
    for (const key of keys) {
      if (key.includes(project) && globalCoverageData[key] &&
          globalCoverageData[key].lines && globalCoverageData[key].statements) {
        core.info(`Found coverage data for ${project} under key '${key}' in global coverage file`);
        return globalCoverageData[key];
      }
    }

    return null;
  } catch (error) {
    core.warning(`Error reading global coverage file: ${error.message}`);
    return null;
  }
}

/**
 * Lists all files in coverage directory for debugging
 */
function debugCoverageDirectory(): void {
  const coverageDir = path.resolve(process.cwd(), 'coverage');

  if (!fs.existsSync(coverageDir)) {
    core.warning('Coverage directory does not exist');
    return;
  }

  core.info('Coverage directory contents:');
  try {
    const listDirectory = (dir: string, depth = 0): void => {
      if (depth > 3) return; // Prevent infinite recursion

      const items = fs.readdirSync(dir);
      items.forEach(item => {
        const fullPath = path.join(dir, item);
        const stats = fs.statSync(fullPath);
        const indent = '  '.repeat(depth);

        if (stats.isDirectory()) {
          core.info(`${indent}📁 ${item}/`);
          listDirectory(fullPath, depth + 1);
        } else {
          core.info(`${indent}📄 ${item}`);
        }
      });
    };

    listDirectory(coverageDir);
  } catch (error) {
    core.warning(`Error listing coverage directory: ${error.message}`);
  }
}

/**
 * Tries to extract coverage data from a coverage file, handling different formats
 */
function extractCoverageData(filePath: string, project: string): CoverageSummary | null {
  try {
    const coverageData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Try different possible structures
    if (coverageData.total) {
      // Standard jest coverage format
      return coverageData.total as CoverageSummary;
    } else if (coverageData[project]) {
      // Project-specific coverage in the same file
      return coverageData[project] as CoverageSummary;
    } else if (coverageData.lines && coverageData.statements && coverageData.functions && coverageData.branches) {
      // Direct coverage data
      return coverageData as CoverageSummary;
    } else {
      // Try to find any object with coverage data
      const keys = Object.keys(coverageData);
      for (const key of keys) {
        const data = coverageData[key];
        if (data && data.lines && data.statements && data.functions && data.branches) {
          core.info(`Found coverage data under key '${key}' for project ${project}`);
          return data as CoverageSummary;
        }
      }
    }

    core.warning(`Unrecognized coverage file format for ${project}. Keys found: ${Object.keys(coverageData).join(', ')}`);
    return null;
  } catch (error) {
    core.error(`Error parsing coverage file for ${project}: ${error.message}`);
    return null;
  }
}

/**
 * Evaluates coverage for all projects against their thresholds
 */
export function evaluateCoverage(projects: string[], thresholds: ThresholdConfig): number {
  if (!process.env.COVERAGE_THRESHOLDS) {
    core.info('No coverage thresholds defined, skipping evaluation');
    return 0; // No thresholds defined, 0 failures
  }

  let failedProjectsCount = 0;
  const coverageResults: ProjectCoverageResult[] = [];

  core.info(`Evaluating coverage for ${projects.length} projects: ${projects.join(', ')}`);

  // Debug: List coverage directory contents
  debugCoverageDirectory();

  for (const project of projects) {
    const projectThresholds = getProjectThresholds(project, thresholds);

    // Skip projects with null thresholds
    if (projectThresholds === null) {
      core.info(`Coverage evaluation skipped for ${project}`);
      coverageResults.push({
        project,
        thresholds: null,
        actual: null,
        status: 'SKIPPED'
      });
      continue;
    }

    // Try to find coverage file in various locations
    const coveragePath = findCoverageSummaryFile(project);
    let summary: CoverageSummary | null = null;

    if (coveragePath) {
      summary = extractCoverageData(coveragePath, project);
    }

    // If we didn't find project-specific coverage, try global coverage file
    if (!summary) {
      core.info(`Trying to find coverage data for ${project} in global coverage file`);
      summary = tryReadFromGlobalCoverage(project);
    }

    if (!summary) {
      core.warning(`No coverage data found for ${project} in any location`);

      // Try to list what files exist for this project specifically
      const projectSpecificDir = path.resolve(process.cwd(), `coverage/${project}`);
      if (fs.existsSync(projectSpecificDir)) {
        const files = fs.readdirSync(projectSpecificDir);
        core.info(`Files in coverage/${project}/: ${files.join(', ')}`);
      }

      coverageResults.push({
        project,
        thresholds: projectThresholds,
        actual: null,
        status: 'FAILED' // Mark as failed if no coverage report is found
      });
      failedProjectsCount++;
      continue;
    }

    // Log the actual coverage data found
    core.info(`Coverage data for ${project}: lines=${summary.lines.pct}%, statements=${summary.statements.pct}%, functions=${summary.functions.pct}%, branches=${summary.branches.pct}%`);

    let projectPassed = true;
    const failedMetrics: string[] = [];

    // Check each metric if threshold is defined
    if (projectThresholds.lines !== undefined && summary.lines.pct < projectThresholds.lines) {
      projectPassed = false;
      failedMetrics.push(`lines: ${summary.lines.pct.toFixed(2)}% < ${projectThresholds.lines}%`);
    }

    if (projectThresholds.statements !== undefined && summary.statements.pct < projectThresholds.statements) {
      projectPassed = false;
      failedMetrics.push(`statements: ${summary.statements.pct.toFixed(2)}% < ${projectThresholds.statements}%`);
    }

    if (projectThresholds.functions !== undefined && summary.functions.pct < projectThresholds.functions) {
      projectPassed = false;
      failedMetrics.push(`functions: ${summary.functions.pct.toFixed(2)}% < ${projectThresholds.functions}%`);
    }

    if (projectThresholds.branches !== undefined && summary.branches.pct < projectThresholds.branches) {
      projectPassed = false;
      failedMetrics.push(`branches: ${summary.branches.pct.toFixed(2)}% < ${projectThresholds.branches}%`);
    }

    if (!projectPassed) {
      core.error(`Project ${project} failed coverage thresholds: ${failedMetrics.join(', ')}`);
      failedProjectsCount++;
    } else {
      core.info(`Project ${project} passed all coverage thresholds`);
    }

    coverageResults.push({
      project,
      thresholds: projectThresholds,
      actual: {
        lines: summary.lines.pct,
        statements: summary.statements.pct,
        functions: summary.functions.pct,
        branches: summary.branches.pct
      },
      status: projectPassed ? 'PASSED' : 'FAILED'
    });
  }

  // Post results to PR comment
  postCoverageComment(coverageResults, failedProjectsCount);

  return failedProjectsCount;
}

/**
 * Formats the coverage results into a markdown table
 */
function formatCoverageComment(results: ProjectCoverageResult[], artifactUrl: string, failedProjectsCount: number): string {
  let comment = '## Test Coverage Results\n\n';

  if (results.length === 0) {
    comment += 'No projects were evaluated for coverage.\n';
    return comment;
  }

  comment += '| Project | Metric | Threshold | Actual | Status |\n';
  comment += '|---------|--------|-----------|--------|--------|\n';

  results.forEach(result => {
    if (result.status === 'SKIPPED') {
      comment += `| ${result.project} | All | N/A | N/A | ⏩ SKIPPED |\n`;
    } else if (result.actual === null) {
      // Show individual thresholds when coverage data is missing
      const metrics = ['lines', 'statements', 'functions', 'branches'];
      let hasAnyThreshold = false;
      let firstRow = true;

      metrics.forEach((metric) => {
        // Skip metrics that don't have a threshold
        if (!result.thresholds || !result.thresholds[metric]) return;

        hasAnyThreshold = true;
        const threshold = result.thresholds[metric];

        // Only include project name in the first row for this project
        const projectCell = firstRow ? result.project : '';
        firstRow = false;

        comment += `| ${projectCell} | ${metric} | ${threshold}% | No Data | ❌ FAILED |\n`;
      });

      // Fallback if no specific thresholds are defined
      if (!hasAnyThreshold) {
        comment += `| ${result.project} | All | Defined | No Data | ❌ FAILED |\n`;
      }
    } else {
      // Show actual coverage data with results
      const metrics = ['lines', 'statements', 'functions', 'branches'];
      let firstRow = true;

      metrics.forEach((metric) => {
        // Skip metrics that don't have a threshold
        if (!result.thresholds || !result.thresholds[metric]) return;

        const threshold = result.thresholds[metric];
        const actual = result.actual[metric].toFixed(2);
        const status = parseFloat(actual) >= threshold ? '✅ PASSED' : '❌ FAILED';

        // Only include project name in the first row for this project
        const projectCell = firstRow ? result.project : '';
        firstRow = false;

        comment += `| ${projectCell} | ${metric} | ${threshold}% | ${actual}% | ${status} |\n`;
      });

      // Handle case where project has actual data but no thresholds defined
      if (Object.keys(result.thresholds || {}).length === 0) {
        comment += `| ${result.project} | All | No thresholds | ${result.actual.lines.toFixed(2)}% (lines) | ⏩ SKIPPED |\n`;
      }
    }
  });

  // Add overall status with failed project count
  const overallStatus = failedProjectsCount === 0 ? '✅ PASSED' :
    failedProjectsCount === 1 ? '⚠️ WARNING (1 project failing)' :
      `❌ FAILED (${failedProjectsCount} projects failing)`;
  comment += `\n### Overall Status: ${overallStatus}\n`;

  if (failedProjectsCount === 1) {
    comment += '\n> Note: The build will continue, but this project should be fixed before merging.\n';
  } else if (failedProjectsCount > 1) {
    comment += '\n> Note: Multiple projects fail coverage thresholds. This PR will be blocked until fixed.\n';
  }

  // Add link to detailed HTML reports
  if (artifactUrl) {
    comment += `\n📊 [View Detailed HTML Coverage Reports](${artifactUrl})\n`;
  }

  return comment;
}

/**
 * Writes the coverage results to a file for PR comment
 */
function postCoverageComment(results: ProjectCoverageResult[], failedProjectsCount: number): void {
  // The actual artifact URL will be provided by GitHub Actions in the workflow
  const artifactUrl = process.env.COVERAGE_ARTIFACT_URL || '';

  const comment = formatCoverageComment(results, artifactUrl, failedProjectsCount);

  // Write to a file that will be used by thollander/actions-comment-pull-request action
  const gitHubCommentsFile = path.resolve(process.cwd(), 'coverage-report.txt');
  fs.writeFileSync(gitHubCommentsFile, comment);

  core.info('Coverage results saved for PR comment');

  // Also create a simple summary for debugging
  createCoverageSummaryFile(results);
}

/**
 * Creates a simple coverage summary file for debugging and artifacts
 */
function createCoverageSummaryFile(results: ProjectCoverageResult[]): void {
  const summaryData = {
    timestamp: new Date().toISOString(),
    results: results.map(result => ({
      project: result.project,
      status: result.status,
      thresholds: result.thresholds,
      actual: result.actual
    }))
  };

  const summaryFile = path.resolve(process.cwd(), 'coverage-summary-debug.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summaryData, null, 2));

  core.info(`Coverage summary debug file created at: ${summaryFile}`);
}

/**
 * Generates a coverage report when no projects are affected
 */
export function generateEmptyCoverageReport(): void {
  const comment = '## Test Coverage Results\n\n⏩ No projects were affected by this change that require coverage evaluation.\n';

  const gitHubCommentsFile = path.resolve(process.cwd(), 'coverage-report.txt');
  fs.writeFileSync(gitHubCommentsFile, comment);

  core.info('Empty coverage report generated (no affected projects)');
}

/**
 * Generates a placeholder coverage report when job 1 has no projects but other jobs do
 */
export function generatePlaceholderCoverageReport(): void {
  const comment = '## Test Coverage Results\n\n⏳ Coverage evaluation is in progress on other parallel jobs...\n\n' +
    '> This report will be updated once all test jobs complete.\n';

  const gitHubCommentsFile = path.resolve(process.cwd(), 'coverage-report.txt');
  fs.writeFileSync(gitHubCommentsFile, comment);

  core.info('Placeholder coverage report generated (projects running in other jobs)');
}

/**
 * Generates a coverage report when tests fail to execute
 */
export function generateTestFailureReport(projects: string[]): void {
  const projectsList = projects.length > 0 ? projects.join(', ') : 'affected projects';
  const comment = `## Test Coverage Results

❌ **Tests failed to execute** for: ${projectsList}

The unit tests failed to run, likely due to compilation errors or configuration issues. Coverage evaluation cannot be performed until the tests can execute successfully.

### Overall Status: ❌ FAILED (Test execution failed)

> Note: Fix the test execution issues before coverage can be evaluated.
`;

  const gitHubCommentsFile = path.resolve(process.cwd(), 'coverage-report.txt');
  fs.writeFileSync(gitHubCommentsFile, comment);

  core.info('Test failure report generated for PR comment');
}
