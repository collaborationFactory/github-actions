import { getAffectedProjects } from './affected-projects';

import { execSync } from 'child_process';

const target = process.argv[2];
const jobIndex = Number(process.argv[3]);
const jobCount = Number(process.argv[4]);
let base = process.argv[5];
// in case base is not a SHA1 commit hash add origin
if (!/\b[0-9a-f]{5,40}\b/.test(base)) base = 'origin/' + base;
const ref = process.argv[6];

const projects = getAffectedProjects(target, jobIndex, jobCount, base, ref);

const runManyProjectsCmd = `./node_modules/.bin/nx run-many --target=${target} --projects=${projects}`;
let cmd = `${runManyProjectsCmd} --parallel --prod`;

if (target.includes('e2e')) {
  cmd = getE2ECommand(cmd);
}

console.log('Running > ', cmd);
if (projects.length > 0) {
  execSync(cmd, {
    stdio: [0, 1, 2],
  });
}

function getE2ECommand(command: string): string {
  const withPercy = process.env.PERCY_TOKEN;
  command = command.concat(` -c ci --base=${base}`);
  if (withPercy) {
    command = `./node_modules/.bin/percy exec --parallel -- ${command}`;
    if (!ref) {
      const defaultBranch = execSync(
        'git remote show origin | grep "HEAD branch" | cut -d" " -f5'
      ).toString('utf-8');
      command = command.concat(` --head=origin/${defaultBranch}`);
    }
  }
  return command;
}
