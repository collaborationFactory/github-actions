import { execSync } from "child_process";
import { NxProject, NxProjectKind } from "./nx-project";
import { ArtifactsHandler } from "./artifacts-handler";
import { Version } from "./version";
import { JfrogCredentials } from "./jfrog-credentials";

interface NpmSearchResult {
  name: string;
  description: string;
  maintainers: string[];
  version: string;
  date: string;
  keywords: string[];
  author: string;
  versions: string[];
  scope: string;
}

export class CleanupSnapshots {
  public static cleanupSnapshots(scope: string) {
    const scopeSearchResult = execSync(`npm search ${scope}`).toString();
    const npmSearchResults: NpmSearchResult[] = JSON.parse(scopeSearchResult);
    npmSearchResults.forEach((entry) => {
      const versionInfo = execSync(`npm view ${entry.name} --json`).toString()
      entry.versions = JSON.parse(versionInfo);
      entry.versions = entry.versions.filter((version) => {
        return version.toLowerCase().includes('snapshot');
      });
      // remove latest version from array so it is kept in the registry
      entry.versions.shift()
      entry.scope = entry.name.split('/')[0];
      entry.name = entry.name.split('/')[1];
      entry.versions.forEach((version) => {
        version = version.replace(`${ArtifactsHandler.SNAPSHOT_VERSION}`, '');
        const project: NxProject = new NxProject(entry.name, NxProjectKind.Application, undefined, new Version(ArtifactsHandler.SNAPSHOT_VERSION, version), entry.scope);
        project.deleteArtifact(new JfrogCredentials(), project.version);
        console.log(project)
      });
    });
  }
}
