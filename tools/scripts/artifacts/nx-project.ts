import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { request } from 'https';
import { IncomingMessage } from 'http';

import { Utils } from './utils';
import { ArtifactsHandler, TASK } from './artifacts-handler';
import { JfrogCredentials } from './jfrog-credentials';
import { Version } from './version';

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
  public static readonly REGISTRY_DOWNLOAD_URL =
    'https://cplace.jfrog.io/ui/repos/tree/NpmInfo/cplace-npm-local';
  public static readonly PACKAGEJSON = 'package.json';
  public static readonly FOSS_LIST_FILENAME = 'cplace-foss-list.json';
  private _npmrcContent = '';
  private _packageJsonContent: any = {};
  public isPublishable: boolean = false;
  public hasPackageJson = false;
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

  public getJfrogUrl(): string {
    return `${NxProject.REGISTRY_DOWNLOAD_URL}/${this.scope}/${this.name}/-/${
      this.scope
    }/${this.name}-${this.version.toString()}.tgz`;
  }

  public getMarkdownLink(): string {
    return `[${this.getPackageInstallPath()}](${this.getJfrogUrl()})`;
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
          `An error ocurred while publishing the artifact: ${error}`
        );
        if (error.status !== 0) process.exit(1);
      }
    }
  }

  public build() {
    console.log(
      execSync(
        `./node_modules/.bin/nx build ${this.name} --prod ${
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
      await this.deleteArtifact(
        jfrogCredentials,
        Utils.getVersionFromSnapshotString(snapshot)
      );
    }
  }

  public async deleteArtifact(
    jfrogCredentials: JfrogCredentials,
    version: Version
  ) {
    return new Promise(async (resolve, reject) => {
      console.log(
        `About to delete artifact from Jfrog: ${
          this.name
        }@${version.toString()}`
      );
      const options = {
        hostname: 'cplace.jfrog.io',
        path: `/artifactory/cplace-npm-local/${this.scope}/${this.name}/-/${
          this.scope
        }/${this.name}-${version.toString()}.tgz`,
        method: 'DELETE',
        headers: {
          Authorization: 'Basic ' + jfrogCredentials.base64Token,
        },
      };
      const req = request(options, (res: IncomingMessage) => {
        console.log(`Http-StatusCode of Delete request: ${res.statusCode}`);
        req.on('error', (error: any) => {
          console.error(
            `An error ocurred while deleting the artifact: ${error}`
          );
          reject();
        });
        resolve(res.statusCode);
      });
      req.end();
    });
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
    fs.writeFileSync(this.getNpmrcPathInDist(), this.npmrcContent);
    console.log('wrote .npmrc to:  ' + this.getNpmrcPathInDist());
  }

  public setVersionOrGeneratePackageJsonInDist(version: Version) {
    if (this.hasPackageJson) {
      try {
        this.packageJsonContent = JSON.parse(
          fs.readFileSync(this.getPackageJsonPathInDist()).toString()
        );
        this.packageJsonContent.author = 'squad-fe';
        this.packageJsonContent.version = version.toString();
        this.packageJsonContent.publishConfig = {
          registry: ArtifactsHandler.REGISTRY,
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
          registry: ArtifactsHandler.REGISTRY,
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
    if (this.task === TASK.RELEASE) return this.version.getNpmTag();
    return 'snapshot';
  }

  public getPrettyPackageJson(): string {
    return JSON.stringify(this.packageJsonContent, null, 2);
  }

  public getPathToProjectInDist(): string {
    const nestedPath = this.pathToProject;
    console.log('getPathToProjectInDist nestedPath', nestedPath);
    const projectType = this.nxProjectKind === NxProjectKind.Application ? 'apps' : 'libs';
    const subPath = nestedPath
      ? nestedPath
      : path.join(
            projectType,
          this.name
        );
    console.log('getPathToProjectInDist subPath', subPath);
    const base = subPath.split(projectType)[0];
    const relativePath = subPath.split(projectType)[1];
    console.log('getPathToProjectInDist base', base);
    console.log('getPathToProjectInDist base', relativePath);
    const distPath = path.join(base, 'dist', projectType, relativePath);
    console.log('getPathToProjectInDist distPath', distPath);
    return distPath;
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
