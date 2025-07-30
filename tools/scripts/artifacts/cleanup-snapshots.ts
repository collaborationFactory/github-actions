import { execSync } from 'child_process';
import { NxProject, NxProjectKind } from './nx-project';
import { ArtifactsHandler } from './artifacts-handler';
import { Version } from './version';
import { Utils } from './utils';
import { DateTime } from 'luxon';
import { JfrogCredentials } from './jfrog-credentials';
import { NpmPackage } from './types';

export class CleanupSnapshots {
  private _npmSearchResults: NpmPackage[] = [];
  private scope = '';
  private static readonly RELEASE_CADENCE = 4;

  constructor() {
    this.initPackagesAndVersions();
  }

  get npmSearchResults(): NpmPackage[] {
    return this._npmSearchResults;
  }

  private initPackagesAndVersions() {
    this.scope = Utils.parseScopeFromPackageJson();
    this._npmSearchResults = this.searchNPMPackages();
    console.log(
      'filteredSearchResults: ',
      JSON.stringify(this._npmSearchResults, null, '  ')
    );
    for (const npmPackage of this._npmSearchResults) {
      const versionInfo = execSync(
        `npm view ${npmPackage.name} --json`
      ).toString();
      npmPackage.versions = this.getFilteredVersionsToDelete(versionInfo);
      console.log(
        'versions to delete: ',
        JSON.stringify(npmPackage.versions, null, '  ')
      );
    }
  }

  private getFilteredVersionsToDelete(versionInfo: string): string[] {
    console.log('versionInfo: ', versionInfo);
    const versions = JSON.parse(versionInfo).versions;
    console.log('all versions: ', versions);
    return versions
      .filter((version) => version.toLowerCase().includes('snapshot'))
      .filter((version) => {
        const parts = version.split('-');
        // takes only a year and a month
        const dateString = parts[parts.length - 1].substring(0, 6);
        const date = DateTime.fromISO(dateString);
        const now = DateTime.fromISO(new Date().toISOString());
        const diff = date.diff(now, ['years', 'months']);
        console.log('version with date', date.toISO());
        console.log('now', now.toISO());
        console.log(
          'rounded diff in months',
          Math.round(Math.abs(diff.months))
        );
        // all versions older than threshold should be deleted
        return (
          Math.round(Math.abs(diff.months)) >= CleanupSnapshots.RELEASE_CADENCE
        );
      });
  }

  private searchNPMPackages() {
    const scopeSearchResult = execSync(
      `npm search ${this.scope} --json`
    ).toString();
    console.log('scopeSearchResult: ', scopeSearchResult);
    const npmSearchResults: NpmPackage[] = JSON.parse(scopeSearchResult);
    return npmSearchResults.filter((entry) => entry.name.includes(this.scope));
  }

  public async deleteSuperfluousArtifacts() {
    for (const npmPackage of this._npmSearchResults) {
      if (npmPackage.versions.length) {
        await this.removeSnapshotArtifacts(npmPackage);
      }
    }
  }

  private async removeSnapshotArtifacts(npmPackage: NpmPackage) {
    npmPackage.scope = npmPackage.name.split('/')[0];
    npmPackage.name = npmPackage.name.split('/')[1];
    for (const sortedVersion of npmPackage.versions) {
      const currentVersion = sortedVersion.replace(
        `${ArtifactsHandler.SNAPSHOT_VERSION}`,
        ''
      );
      const project: NxProject = new NxProject(
        npmPackage.name,
        NxProjectKind.Application,
        undefined,
        new Version(ArtifactsHandler.SNAPSHOT_VERSION, currentVersion),
        npmPackage.scope
      );
      await project.deleteArtifact(project.version);
    }
  }
}
