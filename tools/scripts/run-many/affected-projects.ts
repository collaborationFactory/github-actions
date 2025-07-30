import { Utils } from '../artifacts/utils';

export function distributeProjectsEvenly(
  allProjects: string[],
  jobCount: number
): string[][] {
  const sortedProjects = [...allProjects].sort((a, b) => a.localeCompare(b));

  const distributedProjects: string[][] = Array(jobCount)
    .fill([])
    .map(() => []);
  sortedProjects.forEach((project, index) => {
    const jobIndex = index % jobCount;
    distributedProjects[jobIndex].push(project);
  });

  return distributedProjects;
}

export function getAffectedProjects(
  target: string,
  jobIndex: number,
  jobCount: number,
  base: string,
  ref: string
) {
  let allAffectedProjects = [];
  if (ref === '') {
    allAffectedProjects = Utils.getAllProjects(false, null, target);
  } else {
    allAffectedProjects = Utils.getAllProjects(true, base, target);
  }

  const projects = distributeProjectsEvenly(allAffectedProjects, jobCount);
  console.log(`Affected Projects:`);
  console.table(projects);
  return projects[jobIndex - 1].join(',');
}
