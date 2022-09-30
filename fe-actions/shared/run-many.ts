import { getAffectedProjects } from './affected-projects';

import { execSync } from 'child_process';

const target = process.argv[2];
const jobIndex = Number(process.argv[3]);
const jobCount = Number(process.argv[4]);
let base = process.argv[5];
// in case base is not a SHA1 commit hash add origin
if (!/\b[0-9a-f]{5,40}\b/.test(base)) base = 'origin/' + base;

const projects = getAffectedProjects(target, jobIndex, jobCount, base);

if (projects.length > 0) {
  execSync(`./node_modules/.bin/nx run-many --target=${target} --projects=${projects} --parallel --prod`, {
    stdio: [0, 1, 2],
  });
}
