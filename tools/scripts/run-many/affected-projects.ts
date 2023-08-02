import { Utils } from '../artifacts/utils';

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
  const sliceSize = Math.max(
    Math.floor(allAffectedProjects.length / jobCount),
    1
  );
  const projects =
    jobIndex < jobCount
      ? allAffectedProjects.slice(
          sliceSize * (jobIndex - 1),
          sliceSize * jobIndex
        )
      : allAffectedProjects.slice(sliceSize * (jobIndex - 1));
  console.log(`Affected Projects: ${projects.toString()}`);
  return projects;
}
