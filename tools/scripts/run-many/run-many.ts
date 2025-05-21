import { getAffectedProjects } from './affected-projects';
import { execSync } from 'child_process';
import * as core from '@actions/core';
import * as path from 'path';
import { getCoverageThresholds } from './threshold-handler';
import { evaluateCoverage } from './coverage-evaluator';

function getE2ECommand(command: string, base: string): string {
  command = command.concat(` -c ci --base=${base} --verbose`);
  return command;
}

function runCommand(command: string): void {
  core.info(`Running > ${command}`);

  try {
    const output = execSync(command, { stdio: 'pipe', maxBuffer: 1024 * 1024 * 1024, encoding: 'utf-8' }); // 1GB
    core.info(output.toString())
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

  const projectsString = getAffectedProjects(target, jobIndex, jobCount, base, ref);
  const projects = projectsString ? projectsString.split(',') : [];

  // Check if coverage gate is enabled
  const coverageEnabled = !!process.env.COVERAGE_THRESHOLDS;

  if (coverageEnabled && target === 'test') {
    core.info('Coverage gate is enabled');
  }

  // Modified command construction
  const runManyProjectsCmd = `npx nx run-many --targets=${target} --projects="${projectsString}"`;
  let cmd = `${runManyProjectsCmd} --parallel=false --prod`;

  // Add coverage flag if enabled and target is test
  if (coverageEnabled && target === 'test') {
    // Add coverage reporters for HTML, JSON, and JUnit output
    cmd += ' --coverage --coverageReporters=json,lcov,text,clover,html,json-summary --reporters=default,jest-junit';
  }

  if (target.includes('e2e')) {
    cmd = getE2ECommand(cmd, base);
  }

  if (projects.length > 0) {
    runCommand(cmd);

    // Evaluate coverage if enabled and target is test
    if (coverageEnabled && target === 'test') {
      const thresholds = getCoverageThresholds();

      // Log the current coverage thresholds for debugging
      core.info('Coverage threshold configuration:');
      core.info(JSON.stringify(thresholds, null, 2));

      const passed = evaluateCoverage(projects, thresholds);

      if (!passed) {
        core.setFailed('One or more projects failed to meet coverage thresholds');
        process.exit(1);
      }
    }
  } else {
    core.info('No affected projects :)');
  }
}

main();
