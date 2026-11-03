import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { Utils } from './utils';
import { TASK } from './artifacts-handler';
import { JfrogCredentials } from './jfrog-credentials';
import { Version } from './version';
import { getJfrogUrl } from './configuration';
import { NpmPackage } from './types';

interface PackageJson {
  author: string;
  name: string;
  version: string;
  publishConfig: {
    registry: string;
    access: string;
    tag: string;
  };
}

export enum NxProjectKind {
  Application = 'application',
  Library = 'library',
}

export enum VERSION_BUMP {
  MINOR = 'MINOR',
  PATCH = 'PATCH',
}

export class NxProject {
  public static readonly PACKAGEJSON = 'package.json';
  public static readonly FOSS_LIST_FILENAME = 'cplace-foss-list.json';
  public static readonly PENDING_TAG_SUFFIX = '-pending';
  public static readonly UNPUBLISH_RECHECK_DELAY_MS = 5000;
  private _npmrcContent = '';
  private _packageJsonContent: any = {};
  public isPublishable: boolean = false;
  public hasPackageJson = false;
  // release flow: publish under release-X.Y-pending, promote() moves release-X.Y later
  public stageRelease = false;
  private _pathToProject = '';

  constructor(
    public name: string,
    public nxProjectKind: NxProjectKind,
    public task: TASK = TASK.MAIN_SNAPSHOT,
    public version: Version = new Version(),
    public scope: string = ''
  ) {
    if (this.nxProjectKind === NxProjectKind.Library) {
      if (fs.existsSync(this.getPackageJsonPathInSource())) {
        this.hasPackageJson = true;
        this.packageJsonContent = JSON.parse(
          fs.readFileSync(this.getPackageJsonPathInSource()).toString()
        );
        if (this.packageJsonContent.publishable === true)
          this.isPublishable = true;
      }
    } else {
      this.isPublishable = true;
    }
  }

  public initPathToProject() {
    let globResults = [];
    try {
      globResults = Utils.globProjectJSON();
    } catch (e) {
      console.error('Error while searching for project.json', e);
    }

    this.pathToProject = '';

    const foundProjectPath = globResults.find((result) => {
      const normalizedPath = result.replace(/\//g, '-');
      return (
        normalizedPath.includes(this.name) &&
        !normalizedPath.includes('-e2e') &&
        normalizedPath.includes(
          this.nxProjectKind === NxProjectKind.Application ? 'apps' : 'libs'
        )
      );
    });
    if (foundProjectPath) {
      this.pathToProject = foundProjectPath.replace('/project.json', '');
    }
  }

  public getPackageInstallPath(): string {
    return `${this.scope}/${this.name}@${this.version.toString()}`;
  }

  /**
   * we are no longer using this method and can be removed along with the unit tests REF:PFM-ISSUE-28695
   */
  public getJfrogNpmArtifactUrl(): string {
    return (
      getJfrogUrl() +
      `/${this.scope}/${this.name}/-/${this.scope}/${
        this.name
      }-${this.version.toString()}.tgz`
    );
  }

  public getMarkdownLink(): string {
    return `${this.getPackageInstallPath()}`;
  }

  public async publish() {
    if (this.isPublishable) {
      try {
        console.log(
          execSync(`npm publish`, {
            cwd: `${this.getPathToProjectInDist()}`,
          }).toString()
        );
        Utils.writePublishedProjectToGithubCommentsFile(
          `${this.getMarkdownLink()}`
        );
      } catch (error: any) {
        console.error(
          `An error occurred while publishing the artifact: ${error}`
        );
        if (error.status !== 0) process.exit(1);
      }
    }
  }

  public build() {
    console.log(
      execSync(
        `npx nx build ${this.name} --prod ${
          this.nxProjectKind === NxProjectKind.Application &&
          this.task !== TASK.RELEASE
            ? '--sourceMap=true'
            : ''
        }`
      ).toString()
    );
  }

  /**
   * Copies the foss-list.json file to the dist
   */
  public copyFossList(): void {
    const rootDir = Utils.getRootDir();
    const fossListSrcPath = path.resolve(rootDir, NxProject.FOSS_LIST_FILENAME);
    if (fs.existsSync(fossListSrcPath)) {
      const fossListDestPath = path.resolve(
        this.getPathToProjectInDist(),
        NxProject.FOSS_LIST_FILENAME
      );
      console.log(`Copying ${fossListSrcPath} to ${fossListDestPath}`);
      fs.copyFileSync(fossListSrcPath, fossListDestPath);
    } else {
      console.log(
        `${fossListSrcPath} not found! Please generate the ${NxProject.FOSS_LIST_FILENAME}!`
      );
    }
  }

  public async deleteSnapshots(jfrogCredentials: JfrogCredentials) {
    const snapshots = Utils.getAllSnapshotVersionsOfPackage(
      this.name,
      this.getPathToProjectInDist(),
      this.scope
    );
    console.log('The following snapshots have been found and will be removed');
    console.log(...snapshots);
    for (const snapshot of snapshots) {
      await this.deleteArtifact(Utils.getVersionFromSnapshotString(snapshot));
    }
  }

  /**
   * `npm show` has to be pinned to the JFrog registry explicitly. Run without
   * `--registry` it resolves against whatever the current working directory's
   * `.npmrc` configures, and from the repository root that is the public
   * registry, where the private scope does not exist. The resulting 404 is
   * indistinguishable from a genuinely absent version, so the deletion is
   * skipped and the subsequent publish collides with the version that is
   * actually there.
   */
  private packageExists(pkg: string, version: string): boolean {
    const registry = getJfrogUrl();
    const pathToProjectInDist = this.getPathToProjectInDist();
    try {
      const scopeSearchResult = execSync(
        `npm show ${pkg} --json --registry=${registry}`,
        {
          // The dist .npmrc carries the credentials for the registry above.
          ...(fs.existsSync(pathToProjectInDist)
            ? { cwd: pathToProjectInDist }
            : {}),
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      ).toString();
      console.log(`Search result from registry: ${scopeSearchResult}`);
      const npmPackage = JSON.parse(scopeSearchResult);
      console.log(`Package found in registry: ${npmPackage.name}`);
      console.log(`Package versions in registry: ${npmPackage.versions}`);
      return npmPackage.versions.includes(version);
    } catch (error: any) {
      if (NxProject.isMissingFromRegistry(error)) {
        console.log(`Package ${pkg} not found in registry ${registry}.`);
        return false;
      }
      throw new Error(
        `Could not determine whether ${pkg}@${version} exists in ${registry}. ` +
          `Refusing to skip the deletion, because publishing over an existing ` +
          `version fails with a 403. Cause: ${
            error?.stderr?.toString() || error?.message || error
          }`
      );
    }
  }

  /**
   * Only a 404 means the package or version is absent. Every other failure
   * (auth, DNS, a registry outage) leaves the question unanswered and must not
   * be reported as "does not exist".
   */
  private static isMissingFromRegistry(error: any): boolean {
    const output = [
      error?.stderr?.toString(),
      error?.stdout?.toString(),
      error?.message,
    ]
      .filter(Boolean)
      .join('\n');
    return output.includes('E404') || output.includes('404 Not Found');
  }

  public async deleteArtifact(
    version: Version,
    jfrogCredentials: JfrogCredentials = null
  ) {
    const scopedPackage = `${this.scope}/${this.name}`;
    try {
      const pathToProjectInDist = this.getPathToProjectInDist();
      if (!fs.existsSync(pathToProjectInDist) && jfrogCredentials) {
        console.log(
          `Path to project in dist does not exist, creating it: ${pathToProjectInDist}`
        );
        this.writeNPMRCInDist(jfrogCredentials, this.scope);
        console.log(
          `Setting version in package.json for ${
            this.name
          } to ${version.toString()}`
        );
        this.setVersionOrGeneratePackageJsonInDist(
          version,
          jfrogCredentials.url
        );
        console.log(`Generated package.json: ${this.getPrettyPackageJson()}`);
      }
      // Has to run after the dist .npmrc exists, so the lookup is authenticated
      // against JFrog rather than falling through to an anonymous 404.
      console.log('Checking if package exists in registry');
      if (!this.packageExists(scopedPackage, version.toString())) {
        console.log(
          `Package ${scopedPackage}@${version.toString()} does not exist in the registry. Skipping deletion.`
        );
        return;
      }
      console.log(
        `Package ${scopedPackage}@${version.toString()} exists in registry`
      );
      console.log(
        `About to delete artifact from Jfrog: ${
          this.name
        }@${version.toString()}`
      );
      this.unpublish(version);
      if (await this.isStillPublished(scopedPackage, version)) {
        console.warn(
          `${scopedPackage}@${version.toString()} is still in the registry after npm unpublish reported success, retrying`
        );
        this.unpublish(version);
        if (await this.isStillPublished(scopedPackage, version)) {
          console.error(
            `${scopedPackage}@${version.toString()} is still in the registry after two npm unpublish attempts. ` +
              `Unpublish it by hand before the next publish of this version.`
          );
          process.exit(1);
          return;
        }
      }
      console.log(
        `Deleted artifact from Jfrog: ${this.name}@${version.toString()}`
      );
    } catch (error: any) {
      console.error(`An error occurred while deleting the artifact: ${error}`);
      if (error.status !== 0) process.exit(1);
    }
  }

  private unpublish(version: Version) {
    console.log(
      execSync(
        `npm unpublish ${this.scope}/${
          this.name
        }@${version.toString()} --force`,
        {
          cwd: `${this.getPathToProjectInDist()}`,
        }
      ).toString()
    );
  }

  /**
   * npm unpublish can report success and delete nothing (live test A9: the
   * version stayed in JFrog), so the deletion is checked. The registry metadata
   * may still list a just deleted version, so a hit is checked once more after
   * a delay before it counts.
   */
  private async isStillPublished(
    scopedPackage: string,
    version: Version
  ): Promise<boolean> {
    if (!this.packageExists(scopedPackage, version.toString())) return false;
    await NxProject.sleep(NxProject.UNPUBLISH_RECHECK_DELAY_MS);
    return this.packageExists(scopedPackage, version.toString());
  }

  public static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public writeNPMRCInDist(jfrogCredentials: JfrogCredentials, scope: string) {
    this.npmrcContent = `${scope}:registry=${jfrogCredentials.url} \n`;
    this.npmrcContent =
      this.npmrcContent +
      `${jfrogCredentials.getJfrogUrlNoHttp()}:_auth=${
        jfrogCredentials.base64Token
      } \n`;
    this.npmrcContent =
      this.npmrcContent +
      `${jfrogCredentials.getJfrogUrlNoHttp()}:always-auth=true \n`;
    this.npmrcContent =
      this.npmrcContent +
      `${jfrogCredentials.getJfrogUrlNoHttp()}:email=${jfrogCredentials.user}`;
    console.log(this.npmrcContent + '\n\n');
    const npmrcPathInDist = this.getNpmrcPathInDist();
    if (!fs.existsSync(npmrcPathInDist)) {
      fs.mkdirSync(path.dirname(npmrcPathInDist), { recursive: true });
    }
    fs.writeFileSync(npmrcPathInDist, this.npmrcContent);
    console.log('wrote .npmrc to:  ' + npmrcPathInDist);
  }

  public setVersionOrGeneratePackageJsonInDist(
    version: Version,
    registry: string
  ) {
    if (this.hasPackageJson) {
      try {
        this.packageJsonContent = JSON.parse(
          fs.readFileSync(this.getPackageJsonPathInDist()).toString()
        );
        this.packageJsonContent.author = 'squad-fe';
        this.packageJsonContent.version = version.toString();
        this.packageJsonContent.publishConfig = {
          registry: registry,
          access: 'restricted',
          tag: this.getTag(),
        };
      } catch (e) {
        console.error(e);
      }
    } else {
      this.packageJsonContent = {
        author: 'squad-fe',
        name: `${this.scope}/${this.name}`,
        version: `${version.toString()}`,
        publishConfig: {
          registry: registry,
          access: 'restricted',
          tag: this.getTag(),
        },
      };
    }
    fs.writeFileSync(
      this.getPackageJsonPathInDist(),
      this.getPrettyPackageJson(),
      { encoding: 'utf-8' }
    );

    console.log('wrote package.json to: ' + this.getPackageJsonPathInDist());
    console.log(this.getPrettyPackageJson() + '\n\n');
  }

  public getTag(): string {
    if (this.task === TASK.PR_SNAPSHOT) return 'latest-pr-snapshot';
    if (this.task === TASK.RELEASE)
      return this.stageRelease
        ? this.version.getNpmTag() + NxProject.PENDING_TAG_SUFFIX
        : this.version.getNpmTag();
    return 'snapshot';
  }

  /**
   * Moves the release dist-tag (release-X.Y) of a staged release to this version
   * and removes the staging tag. Unpublishing a version also drops every dist-tag
   * that points to it, so release-X.Y may only move once the whole release is
   * published: a failed run then leaves it on the previous version.
   */
  public promote() {
    if (!this.isPublishable) return;
    const scopedPackage = `${this.scope}/${this.name}`;
    const releaseTag = this.version.getNpmTag();
    const options = { cwd: this.getPathToProjectInDist() };
    try {
      console.log(
        execSync(
          `npm dist-tag add ${scopedPackage}@${this.version.toString()} ${releaseTag} --registry=${getJfrogUrl()}`,
          options
        ).toString()
      );
    } catch (error: any) {
      console.error(
        `An error occurred while moving ${releaseTag} to ${scopedPackage}@${this.version.toString()}: ${error}`
      );
      if (error.status !== 0) process.exit(1);
      return;
    }
    // only cosmetic once release-X.Y moved: a leftover staging tag must not fail the release
    try {
      execSync(
        `npm dist-tag rm ${scopedPackage} ${releaseTag}${
          NxProject.PENDING_TAG_SUFFIX
        } --registry=${getJfrogUrl()}`,
        options
      );
    } catch (error: any) {
      console.warn(
        `Could not remove the staging tag of ${scopedPackage}: ${error}`
      );
    }
  }

  public getPrettyPackageJson(): string {
    return JSON.stringify(this.packageJsonContent, null, 2);
  }

  public getPathToProjectInDist(): string {
    const nestedPath = this.pathToProject;
    const projectType =
      this.nxProjectKind === NxProjectKind.Application ? 'apps' : 'libs';
    const subPath = nestedPath ? nestedPath : path.join(projectType, this.name);
    const base = subPath.split(projectType)[0];
    const relativePath = subPath.split(projectType)[1];
    return path.join(base, 'dist', projectType, relativePath);
  }

  public getNpmrcPathInDist() {
    return path.join(this.getPathToProjectInDist(), '.npmrc');
  }

  public getPackageJsonPathInDist() {
    return path.join(this.getPathToProjectInDist(), NxProject.PACKAGEJSON);
  }

  public getPathToProjectInSource(): string {
    const nestedPath = this.pathToProject;
    return path.resolve(
      nestedPath
        ? nestedPath
        : path.join(
            this.nxProjectKind === NxProjectKind.Application ? 'apps' : 'libs',
            this.name
          )
    );
  }

  public getPackageJsonPathInSource() {
    return path.join(this.getPathToProjectInSource(), NxProject.PACKAGEJSON);
  }

  get npmrcContent(): string {
    return this._npmrcContent;
  }

  set npmrcContent(value: string) {
    this._npmrcContent = value;
  }

  get packageJsonContent(): any {
    return this._packageJsonContent;
  }

  set packageJsonContent(value: PackageJson) {
    this._packageJsonContent = value;
  }

  get pathToProject(): string {
    if (this._pathToProject === '') {
      this.initPathToProject();
    }
    return this._pathToProject;
  }

  set pathToProject(value: string) {
    this._pathToProject = value;
  }
}
