import { execSync } from "child_process";
import { NxProject, NxProjectKind } from "./nx-project";
import { ArtifactsHandler } from "./artifacts-handler";
import { Version } from "./version";
import { Utils } from "./utils";
import { DateTime } from 'luxon'

interface VersionWithDate {
  version: string;
  date: Date;
}

interface NpmPackage {
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
  get npmSearchResults(): NpmPackage[] {
    return this._npmSearchResults;
  }
  private _npmSearchResults: NpmPackage[] = [];
  private scope = '';

  constructor() {
    this.initPackagesAndVersions()
  }

  private initPackagesAndVersions() {
    this.scope = Utils.parseScopeFromPackageJson();
    this._npmSearchResults = this.searchNPMPackages();
    for (const npmPackage of this._npmSearchResults) {
      const versionInfo = execSync(`npm view ${npmPackage.name} --json`).toString()
      npmPackage.versions = JSON.parse(versionInfo).versions;
      npmPackage.versions = npmPackage.versions.filter((version) => {
        return version.toLowerCase().includes('snapshot');
      });
      this.initSortedVersions(npmPackage);
    };
  }
  
  private initSortedVersions(npmPackage: NpmPackage) {
    npmPackage.sortedVersions = [];
    npmPackage.versions.forEach((version) => {
      let dateString = (version.match(/[0-9]{8}$/) || '')[0];
      let dateTime: DateTime;
      if (dateString) {
        dateTime = DateTime.fromISO(dateString);
      } else {
        dateTime = DateTime.fromISO('99990101');
      }
      const versionWithDate: VersionWithDate = {
        date: dateTime.toJSDate(),
        version: version
      };
      npmPackage.sortedVersions.push(versionWithDate);
    });
  }

  private searchNPMPackages() {
    const scopeSearchResult = execSync(`npm search ${this.scope} --json`).toString();
    let npmSearchResults: NpmPackage[] = JSON.parse(scopeSearchResult);
    return npmSearchResults.filter((entry) => {
      return entry.name.includes(this.scope);
    });
  }

  public async deleteSuperfluousArtifacts() {
    for (const npmPackage of this._npmSearchResults) {
      if (npmPackage.sortedVersions.length > 5) {
        npmPackage.sortedVersions.sort((a, b) => b.date.getTime() - a.date.getTime());
        // remove latest 5 versions from array so they are kept in the registry
        npmPackage.sortedVersions.splice(0, 5);
        await this.removeSnapshotArtifacts(npmPackage);
      }
    }
  }

  private async removeSnapshotArtifacts(npmPackage: NpmPackage) {
    npmPackage.scope = npmPackage.name.split('/')[0];
    npmPackage.name = npmPackage.name.split('/')[1];
    for (const sortedVersion of npmPackage.sortedVersions) {
      const currentVersion = sortedVersion.version.replace(`${ArtifactsHandler.SNAPSHOT_VERSION}`, '');
      const project: NxProject = new NxProject(npmPackage.name, NxProjectKind.Application, undefined, new Version(ArtifactsHandler.SNAPSHOT_VERSION, currentVersion), npmPackage.scope);
      console.log(`About to delete ${npmPackage.scope}/${npmPackage.name}@${project.version}`)
      //await project.deleteArtifact(new JfrogCredentials(), project.version);
    }
  }
}
