import { Utils } from '../artifacts/utils';

export function  distributeProjectsEvenly(
  allProjects: string[],
  jobCount: number
): string[][] {
  const distributedProjects: string[][] = Array(jobCount).fill([]).map(() => []);

  allProjects.forEach((project, index) => {
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
  if (target === 'e2e' && ref === '') {
    allAffectedProjects = Utils.getAllProjects(false, null, target);
  } else {
    allAffectedProjects = Utils.getAllProjects(true, base, target);
  }
  
  const projects= distributeProjectsEvenly(allAffectedProjects, jobCount);
  console.log(`Affected Projects: ${projects.toString()}`);
  return projects[jobIndex].join(',');
}
