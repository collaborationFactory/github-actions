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
const skipNxCacheFlag = `--skip-nx-cache`;

let cmdArgs = [
  `./node_modules/.bin/nx`,
  `run-many`,
  `--targets=${target}`,
  `--projects=${projects}`,
  `--parallel`,
  `--prod`,
  skipNxCacheFlag,
];

if (target.includes('e2e')) {
  cmdArgs = getE2ECmdArgs(cmdArgs);
}

const cmd = cmdArgs.join(' ');

console.log('Running > ', cmd);
if (projects.length > 0) {
  execSync(cmd, {
    stdio: 'inherit',
  });
}

function getE2ECmdArgs(providedCmdArgs: string[]): string[] {
  const skipNxCacheIndex = providedCmdArgs.indexOf(skipNxCacheFlag);
  if (skipNxCacheIndex !== -1) {
    providedCmdArgs.splice(skipNxCacheIndex, 1);
  }
  return [...providedCmdArgs, `--c=ci`, `--base=${base}`];
}
