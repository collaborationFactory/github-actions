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
 * Evaluates coverage for all projects against their thresholds
 */
export function evaluateCoverage(projects: string[], thresholds: ThresholdConfig): boolean {
  if (!process.env.COVERAGE_THRESHOLDS) {
    core.info('No coverage thresholds defined, skipping evaluation');
    return true; // No thresholds defined, pass by default
  }

  let allProjectsPassed = true;
  const coverageResults: ProjectCoverageResult[] = [];

  core.info(`Evaluating coverage for ${projects.length} projects`);

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

    const coveragePath = path.resolve(process.cwd(), `coverage/${project}/coverage-summary.json`);

    if (!fs.existsSync(coveragePath)) {
      core.warning(`No coverage report found for ${project} at ${coveragePath}`);
      coverageResults.push({
        project,
        thresholds: projectThresholds,
        actual: null,
        status: 'FAILED' // Mark as failed if no coverage report is found
      });
      allProjectsPassed = false;
      continue;
    }

    try {
      const coverageData = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
      const summary = coverageData.total as CoverageSummary;

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
        allProjectsPassed = false;
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
    } catch (error) {
      core.error(`Error processing coverage for ${project}: ${error.message}`);
      coverageResults.push({
        project,
        thresholds: projectThresholds,
        actual: null,
        status: 'FAILED'
      });
      allProjectsPassed = false;
    }
  }

  // Post results to PR comment
  postCoverageComment(coverageResults);

  return allProjectsPassed;
}

/**
 * Formats the coverage results into a markdown table
 */
function formatCoverageComment(results: ProjectCoverageResult[], artifactUrl: string): string {
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
      comment += `| ${result.project} | All | Defined | No Data | ❌ FAILED |\n`;
    } else {
      const metrics = ['lines', 'statements', 'functions', 'branches'];
      metrics.forEach((metric, index) => {
        // Skip metrics that don't have a threshold
        if (!result.thresholds[metric]) return;

        const threshold = result.thresholds[metric];
        const actual = result.actual[metric].toFixed(2);
        const status = actual >= threshold ? '✅ PASSED' : '❌ FAILED';

        // Only include project name in the first row for this project
        const projectCell = index === 0 ? result.project : '';

        comment += `| ${projectCell} | ${metric} | ${threshold}% | ${actual}% | ${status} |\n`;
      });
    }
  });

  // Add overall status
  const overallStatus = results.every(r => r.status !== 'FAILED') ? '✅ PASSED' : '❌ FAILED';
  comment += `\n### Overall Status: ${overallStatus}\n`;

  // Add link to detailed HTML reports
  if (artifactUrl) {
    comment += `\n📊 [View Detailed HTML Coverage Reports](${artifactUrl})\n`;
  }

  return comment;
}

/**
 * Writes the coverage results to a file for PR comment
 */
function postCoverageComment(results: ProjectCoverageResult[]): void {
  // The actual artifact URL will be provided by GitHub Actions in the workflow
  const artifactUrl = process.env.COVERAGE_ARTIFACT_URL || '';

  const comment = formatCoverageComment(results, artifactUrl);

  // Write to a file that will be used by thollander/actions-comment-pull-request action
  const gitHubCommentsFile = path.resolve(process.cwd(), 'coverage-report.txt');
  fs.writeFileSync(gitHubCommentsFile, comment);

  core.info('Coverage results saved for PR comment');
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
