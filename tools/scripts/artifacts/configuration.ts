export function getJfrogUrl(): string {
  return process.env.JFROG_URL !== undefined
    ? process.env.JFROG_URL
    : 'https://cplace.jfrog.io/artifactory/cplace-npm-local';
}
