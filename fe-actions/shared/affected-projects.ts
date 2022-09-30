import { execSync } from 'child_process';

export function getAffectedProjects(target: string, jobIndex: number, jobCount: number, base: string) {

  console.log(`./node_modules/.bin/nx print-affected --base=${base} --target=${target}`);
  const affected = execSync(`./node_modules/.bin/nx print-affected --base=${base} --target=${target}`).toString('utf-8');
  const array = JSON.parse(affected)
    .tasks.map((t) => t.target.project)
    .slice()
    .sort();
  const sliceSize = Math.max(Math.floor(array.length / jobCount), 1);
  const projects =
    jobIndex < jobCount ? array.slice(sliceSize * (jobIndex - 1), sliceSize * jobIndex) : array.slice(sliceSize * (jobIndex - 1));
  console.log(`Affected Projects: ${projects.toString()}`);
  return projects;
}
