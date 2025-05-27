import { getAffectedProjects } from './affected-projects';
import { execSync } from 'child_process';
import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { getCoverageThresholds } from './threshold-handler';
import { evaluateCoverage, generateEmptyCoverageReport, generateTestFailureReport, generatePlaceholderCoverageReport } from './coverage-evaluator';
import { Utils } from '../artifacts/utils';

function getE2ECommand(command: string, base: string): string {
  command = command.concat(` -c ci --base=${base} --verbose`);
  return command;
}

function runCommand(command: string): boolean {
  core.info(`Running > ${command}`);

  try {
    const output = execSync(command, { stdio: 'pipe', maxBuffer: 1024 * 1024 * 1024, encoding: 'utf-8' }); // 1GB
    core.info(output.toString())
    return true; // Command succeeded
  } catch (error) {
    if (error.signal === 'SIGTERM') {
      core.error('Timed out');
    } else if (error.code === 'ENOBUFS') {
      core.error('Buffer exceeded');
    }
    core.info(error.stdout.toString());
    core.error(error.stderr.toString());
    core.error(`Error message: ${error.message}`);
    core.error(`Error name: ${error.name}`);
    core.error(`Stacktrace:\n${error.stack}`);
    core.setFailed(error);
    return false; // Command failed
  }
}

function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function main() {
  const target = process.argv[2];
  const jobIndex = Number(process.argv[3]);
  const jobCount = Number(process.argv[4]);
  let base = process.argv[5];

  // in case base is not a SHA1 commit hash add origin
  if (!/\b[0-9a-f]{5,40}\b/.test(base)) base = 'origin/' + base;
  if(base.includes('0000000000000000')){
    base = execSync(`git rev-parse --abbrev-ref origin/HEAD `).toString().trim();
  }
  const ref = process.argv[6];

  core.info(`Inputs:\n target ${target},\n jobIndex: ${jobIndex},\n jobCount ${jobCount},\n base ${base},\n ref ${ref}`)

  // Check if coverage gate is enabled
  const coverageEnabled = !!process.env.COVERAGE_THRESHOLDS;

  // Get the affected projects
  const projectsString = getAffectedProjects(target, jobIndex, jobCount, base, ref);
  const projects = projectsString ? projectsString.split(',') : [];

  // Check if there are any affected projects (for first job only, to avoid duplicate reports)
  const areAffectedProjects = projects.length > 0;
  const isFirstJob = jobIndex === 1;

  // For the first job with coverage enabled, ensure a coverage report is always created
  // This handles cases where job 1 has no projects but other jobs do
  if (coverageEnabled && target === 'test' && isFirstJob && !areAffectedProjects) {
    // Ensure coverage directory exists for artifact upload
    ensureDirectoryExists(path.resolve(process.cwd(), 'coverage'));

    // Check if there are any affected projects across all jobs
    const allAffectedProjects = Utils.getAllProjects(true, base, target);
    if (allAffectedProjects.length === 0) {
      // No projects affected at all
      generateEmptyCoverageReport();
    } else {
      // Other jobs will have projects, so create a placeholder that indicates processing
      generatePlaceholderCoverageReport();
    }
  }

  // Modified command construction
  const runManyProjectsCmd = `npx nx run-many --targets=${target} --projects="${projectsString}"`;

  // Disable parallel execution when coverage is enabled to avoid conflicts
  const parallelFlag = (coverageEnabled && target === 'test') ? '--parallel=false' : '--parallel=true';
  let cmd = `${runManyProjectsCmd} ${parallelFlag} --prod`;

  // Add coverage flag if enabled and target is test
  if (coverageEnabled && target === 'test') {
    core.info('Coverage gate is enabled');
    // Add coverage reporters for HTML, JSON, and JUnit output
    // Note: Using individual project coverage directories
    cmd += ' --coverage --coverageReporters=json,lcov,text,clover,html,json-summary --reporters=default,jest-junit';
  }

  if (target.includes('e2e')) {
    cmd = getE2ECommand(cmd, base);
  }

  if (areAffectedProjects) {
    const commandSucceeded = runCommand(cmd);

    // Always evaluate coverage or generate report if enabled and target is test
    if (coverageEnabled && target === 'test') {
      const thresholds = getCoverageThresholds();

      // Log the current coverage thresholds for debugging
      core.info('Coverage threshold configuration:');
      core.info(JSON.stringify(thresholds, null, 2));

      if (commandSucceeded) {
        // Command succeeded, evaluate actual coverage
        const failedProjectsCount = evaluateCoverage(projects, thresholds);

        if (failedProjectsCount > 1) {
          core.setFailed(`Multiple projects (${failedProjectsCount}) failed to meet coverage thresholds`);
          // Don't exit immediately - we set the failed status but continue running
        } else if (failedProjectsCount === 1) {
          core.warning('One project failed to meet coverage thresholds - this should be fixed before merging');
          // Continue running, with a warning
        }
      } else {
        // Command failed, generate a failure report for first job only
        if (isFirstJob) {
          generateTestFailureReport(projects);
        }
      }
    }
  } else {
    core.info('No affected projects in this job');

    // For the first job, generate an appropriate coverage report when coverage is enabled
    if (coverageEnabled && target === 'test' && isFirstJob) {
      // Ensure coverage directory exists for artifact upload
      ensureDirectoryExists(path.resolve(process.cwd(), 'coverage'));

      // Check if there are any affected projects across all jobs
      const allAffectedProjects = Utils.getAllProjects(true, base, target);
      if (allAffectedProjects.length === 0) {
        // No projects affected at all
        generateEmptyCoverageReport();
      } else {
        // Other jobs will handle the projects, let the workflow's fallback handle the report
        core.info('Other jobs will process affected projects - coverage report will be generated by workflow fallback if needed');
      }
    }
  }
}

main();
