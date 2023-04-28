import { execSync } from "child_process";
import { NxProject, NxProjectKind } from "./nx-project";
import { ArtifactsHandler } from "./artifacts-handler";
import { Version } from "./version";
import { Utils } from "./utils";

interface VersionWithDate {
  version: string;
  date: Date;
}

interface NpmSearchResult {
  name: string;
  description: string;
  maintainers: string[];
  version: string;
  date: string;
  keywords: string[];
  author: string;
  versions: string[];
  sortedVersions: VersionWithDate[];
  scope: string;
}

export class CleanupSnapshots {
  public static async cleanupSnapshots() {
    const scope = Utils.parseScopeFromPackageJson();
    const scopeSearchResult = execSync(`npm search ${scope} --json`).toString();
    let npmSearchResults: NpmSearchResult[] = JSON.parse(scopeSearchResult);
    npmSearchResults = npmSearchResults.filter((entry) => {
      return entry.name.includes(scope);
    });
    for (const entry of npmSearchResults) {
      const versionInfo = execSync(`npm view ${entry.name} --json`).toString()
      entry.versions = JSON.parse(versionInfo).versions;
      entry.versions = entry.versions.filter((version) => {
        return version.toLowerCase().includes('snapshot');
      });
      entry.sortedVersions = [];
      entry.versions.forEach((version) => {
        let dateString = (version.match(/[0-9]{8}$/) || '')[0];
        const year: number = parseInt(dateString.substring(0, 4));
        const month: number = parseInt(dateString.substring(4, 6)) - 1;
        const day: number = parseInt(dateString.substring(6, 8));
        const versionWithDate: VersionWithDate = {
          date: new Date(year, month, day),
          version: version
        };
        entry.sortedVersions.push(versionWithDate);
      });
      entry.sortedVersions.sort((a, b) => b.date.getTime() - a.date.getTime());
      // remove latest version from array so it is kept in the registry
      entry.sortedVersions.shift()
      entry.scope = entry.name.split('/')[0];
      entry.name = entry.name.split('/')[1];
      for (const sortedVersion of entry.sortedVersions) {
        const currentVersion = sortedVersion.version.replace(`${ArtifactsHandler.SNAPSHOT_VERSION}`, '');
        const project: NxProject = new NxProject(entry.name, NxProjectKind.Application, undefined, new Version(ArtifactsHandler.SNAPSHOT_VERSION, currentVersion), entry.scope);
        //await project.deleteArtifact(new JfrogCredentials(), project.version);
        console.log(project)
        console.log(project.version)
      }
    };
  }
}
