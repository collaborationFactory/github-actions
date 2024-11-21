export function getNpmRegistryRepo(): string {
  return process.env.NPM_REGISTRY !== undefined ? process.env.NPM_REGISTRY : 'cplace-npm-local';
}
