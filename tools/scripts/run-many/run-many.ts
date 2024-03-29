import { getAffectedProjects } from './affected-projects';

import { execSync } from 'child_process';

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

console.log(`Inputs:\n target ${target},\n jobIndex: ${target},\n jobCount ${jobCount},\n base ${base},\n ref ${ref}`)

const projects = getAffectedProjects(target, jobIndex, jobCount, base, ref);

const runManyProjectsCmd = `./node_modules/.bin/nx run-many --targets=${target} --projects=${projects}`;
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
  command = command.concat(` -c ci --base=${base} --verbose`);
  return command;
}
