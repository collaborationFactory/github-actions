import { Utils } from '../artifacts/utils';

export function distributeProjectsEvenly(
  allProjects: string[],
  jobCount: number
): string[][] {
  const sortedProjects = [...allProjects].sort((a, b) => a.localeCompare(b));

  const distributedProjects: string[][] = Array(jobCount).fill([]).map(() => []);
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
): string {
  let allAffectedProjects = [];
  if (target === 'e2e' && ref === '') {
    allAffectedProjects = Utils.getAllProjects(false, null, target);
  } else {
    allAffectedProjects = Utils.getAllProjects(true, base, target);
  }

  const projects = distributeProjectsEvenly(allAffectedProjects, jobCount);
  console.log(`Affected Projects:`);
  console.table(projects);

  // Handle case when no projects are assigned to this job index
  if (jobIndex - 1 >= projects.length || !projects[jobIndex - 1] || projects[jobIndex - 1].length === 0) {
    return '';
  }

  return projects[jobIndex - 1].join(',');
}

// Check if there are any affected projects
export function hasAffectedProjects(base: string, target?: string): boolean {
  const projects = Utils.getAllProjects(true, base, target);
  return projects.length > 0;
}
