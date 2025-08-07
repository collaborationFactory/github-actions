import { getAffectedProjects } from './affected-projects';
import { execSync } from 'child_process';
import * as core from '@actions/core';

function getE2ECommand(command: string, base: string): string {
  command = command.concat(` -c ci --base=${base} --verbose`);
  return command;
}

function runCommand(command: string): void {
  if (command.includes('--targets=e2e')) {
    const commandArr = command.split(' ');
    command = commandArr.filter((c) => !c.includes('--base=')).join(' ');
  }
  core.info(`Running > ${command}`);

  try {
    const output = execSync(command, {
      stdio: 'pipe',
      maxBuffer: 1024 * 1024 * 1024,
      encoding: 'utf-8',
    }); // 10MB
    core.info(output.toString());
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
  if (base.includes('0000000000000000')) {
    base = execSync(`git rev-parse --abbrev-ref origin/HEAD `)
      .toString()
      .trim();
  }
  const ref = process.argv[6];

  core.info(
    `Inputs:\n target ${target},\n jobIndex: ${jobIndex},\n jobCount ${jobCount},\n base ${base},\n ref ${ref}`
  );

  const projects = getAffectedProjects(target, jobIndex, jobCount, base, ref);

  const runManyProjectsCmd = `npx nx run-many --targets=${target} --projects="${projects}"`;
  let cmd = `${runManyProjectsCmd} --parallel=false --prod`;

  if (target.includes('e2e')) {
    cmd = getE2ECommand(cmd, base);
  }

  // Add coverage flag if enabled and target is test
  if (target === 'test') {
    core.info('Coverage gate is enabled');
    // Add coverage reporters for HTML, JSON, and JUnit output
    // Note: Using individual project coverage directories
    cmd += ' --coverage --coverageReporters=lcov,html';
  }

  if (projects.length > 0) {
    runCommand(cmd);
  } else {
    core.info('No affected projects :)');
  }
}

main();
