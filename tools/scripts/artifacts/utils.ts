import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { ArtifactsHandler, TASK } from './artifacts-handler';
import { NxProject, NxProjectKind, VERSION_BUMP } from './nx-project';
import { Version } from './version';

export class Utils {
  public static readonly PULL_REQUEST = 'pull_request';
  public static readonly GITHUB_COMMENTS_FILE = 'githubCommentsForPR.txt';
  public static readonly EMPTY_GITHUB_COMMENTS =
    'No snapshots of projects have been published (probably no project is affected)';

  public static globProjectJSON(): string[] {
    const projects = execSync('ls */**/project.json').toString().trim();
    return projects.split('\n').filter((projectJSON) => {
      return (
        !projectJSON.startsWith('dist/') &&
        !projectJSON.includes('node_modules') &&
        !projectJSON.includes('.git')
      );
    });
  }

  public static getAffectedNxProjects(
    base: string,
    nxProjectKind: NxProjectKind,
    task: TASK = TASK.MAIN_SNAPSHOT,
    version: Version = new Version(),
    scope: string = ''
  ): NxProject[] {
    let affectedProjects = [];
    if (nxProjectKind === NxProjectKind.Application) {
      affectedProjects = Utils.getListOfAllAffectedApps(base);
    } else {
      affectedProjects = Utils.getListOfAllAffectedLibs(base);
    }
    console.log(
      `Affected ${
        nxProjectKind === NxProjectKind.Application ? 'apps' : 'libs'
      }: ` + affectedProjects.toString()
    );
    let filteredAffected: string[] = affectedProjects
      .filter((project) => !project.endsWith('-e2e'))
      .filter((project) => !project.startsWith('api-'))
      .sort();
    let projects: NxProject[] = [];
    filteredAffected.forEach((affected) => {
      projects.push(
        new NxProject(affected, nxProjectKind, task, version, scope)
      );
    });
    return projects;
  }

  public static getAllNxProjects(
    task: TASK = TASK.MAIN_SNAPSHOT,
    version: Version = new Version(),
    scope: string = ''
  ): NxProject[] {
    const libs = Utils.getListOfAllLibs();
    const apps = Utils.getListOfAllApps();

    const projects = [...libs, ...apps];
    const nxProjects: NxProject[] = projects
      .filter((project) => !project.endsWith('-e2e'))
      .filter((project) => !project.startsWith('api-'))
      .map((project) => {
        return new NxProject(
          project,
          libs.includes(project)
            ? NxProjectKind.Library
            : NxProjectKind.Application,
          task,
          version,
          scope
        );
      });
    console.log(
      'All Projects: ' + nxProjects.map((nxProject) => nxProject.name)
    );
    return nxProjects;
  }

  public static getListOfAllAffectedLibs(base: string): string[] {
    const projects = Utils.getAllProjects(true, base);
    return projects.filter((project) =>
      fs.readdirSync(this.getLibsDir()).includes(project)
    );
  }

  public static getListOfAllAffectedApps(base: string): string[] {
    const projects = Utils.getAllProjects(true, base);
    return projects.filter((project) =>
      fs.readdirSync(this.getAppsDir()).includes(project)
    );
  }

  public static getListOfAllLibs(): string[] {
    const projects = Utils.getAllProjects(false);
    return projects.filter((project) =>
      fs.readdirSync(this.getLibsDir()).includes(project)
    );
  }

  public static getListOfAllApps(): string[] {
    const projects = Utils.getAllProjects(false);
    return projects.filter((project) =>
      fs.readdirSync(this.getAppsDir()).includes(project)
    );
  }

  public static getAllProjects(
    affected: boolean,
    base?: string,
    target?: string
  ): string[] {
    let cmd = `npx nx show projects --affected=${affected} `;
    if (base) {
      cmd = cmd.concat(`--base=${base} `);
    }
    if (target) {
      cmd = cmd.concat(`--withTarget=${target} `);
    }
    const projectsString = execSync(cmd).toString();
    return Utils.getListOfProjectsFromProjectsString(projectsString);
  }

  public static getListOfProjectsFromProjectsString(
    projectsString: string | undefined
  ) {
    if (projectsString?.length) {
      return projectsString.trim().split('\n');
    }
    return [];
  }

  public static getLatestTagForReleaseBranch(
    branch: string,
    versionOfBranch: Version
  ): Version {
    let tags: Version[] = [];
    if (branch.startsWith(ArtifactsHandler.RELEASE_BRANCH_PREFIX)) {
      tags = this.getAllVersionTagsInAscendingOrder()
        .filter(
          (version) =>
            version.major === versionOfBranch.major &&
            version.minor === versionOfBranch.minor
        )
        .sort((r1, r2) => {
          return r2.compareTo(r1);
        });
    }
    if (tags.length > 0) return tags[0];
    return new Version('');
  }

  public static calculateNewVersion(branch: string): Version {
    const versionOfBranch: Version = Utils.getVersionFromReleaseBranch(branch);
    const latestExistingTag = Utils.getLatestTagForReleaseBranch(
      branch,
      versionOfBranch
    );
    if (!latestExistingTag.isValid()) {
      versionOfBranch.patch = 1;
      return versionOfBranch;
    } else {
      latestExistingTag.patchVersion(VERSION_BUMP.PATCH);
      return latestExistingTag;
    }
  }

  public static getAllVersionTagsInAscendingOrder(): Version[] {
    const gitRootDir = this.getRootDir();
    console.log(`Root dir is ${gitRootDir}`);
    let tags: string[] = execSync(`git ls-remote --tags`, { cwd: gitRootDir })
      .toString()
      .split(/\r?\n/)
      .filter((i) => i !== '' && i.includes(ArtifactsHandler.VERSION_PREFIX))
      .map((i) =>
        i.substring(
          i.indexOf(ArtifactsHandler.VERSION_PREFIX) +
            ArtifactsHandler.VERSION_PREFIX.length,
          i.length
        )
      );
    console.log(`The following tags were found ${tags}`);
    return tags
      .map((tag) => new Version(tag, ''))
      .sort((r1, r2) => {
        return r1.compareTo(r2);
      });
  }

  public static getRootDir() {
    return execSync(`git rev-parse --show-toplevel`).toString().trim();
  }

  public static getLibsDir() {
    return path.resolve(this.getRootDir(), 'libs');
  }

  public static getAppsDir() {
    return path.resolve(this.getRootDir(), 'apps');
  }

  public static getGitHubCommentsFile() {
    return path.join(Utils.getRootDir(), Utils.GITHUB_COMMENTS_FILE);
  }

  public static getCurrentBranchNameFromGithubEnv(): string {
    // On a PR:
    // GITHUB_EVENT_NAME=pull_request
    // GITHUB_HEAD_REF=feature/PFM-ISSUE-1234-add-awesome-feature
    if (
      process.env.GITHUB_EVENT_NAME &&
      process.env.GITHUB_EVENT_NAME.toLocaleLowerCase() === Utils.PULL_REQUEST
    ) {
      return process.env.GITHUB_HEAD_REF || '';
    } else {
      // On push of a commit
      // GITHUB_EVENT_NAME=push
      // GITHUB_REF_NAME=main
      return process.env.GITHUB_REF_NAME || '';
    }
  }

  public static getVersionFromReleaseBranch(releaseBranch: string): Version {
    return new Version(
      releaseBranch
        .trim()
        .replace(ArtifactsHandler.RELEASE_BRANCH_PREFIX, '')
        .concat('.0'),
      ''
    );
  }

  public static getUniqueSnapshotIdentifier() {
    return `-${ArtifactsHandler.SNAPSHOT}-${Utils.getHashedTimestamp()}`;
  }

  public static getPRVersion(branch: string, prNumber: string): string {
    return `-${branch
      .substring(0, 50)
      .replace(/[^0-9A-Za-z-.@]/g, '-')}-${prNumber}`;
  }

  public static getHashedTimestamp(): string {
    const date = new Date();
    const day: number = date.getDate();
    const month: number = date.getMonth() + 1;
    const year: number = date.getFullYear();
    const currentDate: string = `${year}${month < 10 ? '0' + month : month}${
      day < 10 ? '0' + day : day
    }`;
    return `${(+date).toString(36)}-${currentDate}`;
  }

  public static getAllSnapshotVersionsOfPackage(
    packageName: string,
    projectDistDir: string,
    scope: string
  ): string[] {
    const snapshotVersions = JSON.parse(
      execSync(`npm view ${scope}/${packageName} --json`, {
        cwd: projectDistDir,
      }).toString()
    ).versions;
    return snapshotVersions.filter((version: string) =>
      version.toLowerCase().includes('snapshot')
    );
  }

  public static getVersionFromSnapshotString(snapshot: string): Version {
    const version = snapshot.slice(0, snapshot.indexOf('-'));
    const suffix = snapshot.slice(snapshot.indexOf('-'));
    return new Version(version, suffix);
  }

  public static initGithubActionsFile() {
    const gitHubCommentsFile = Utils.getGitHubCommentsFile();
    if (!fs.existsSync(gitHubCommentsFile)) {
      fs.writeFileSync(gitHubCommentsFile, Utils.EMPTY_GITHUB_COMMENTS);
    }
  }

  public static writePublishedProjectToGithubCommentsFile(message: string) {
    const gitHubCommentsFile = Utils.getGitHubCommentsFile();
    if (!fs.existsSync(gitHubCommentsFile)) {
      fs.writeFileSync(gitHubCommentsFile, `${message}\n`);
    } else {
      if (
        fs
          .readFileSync(gitHubCommentsFile)
          .toString()
          .includes(Utils.EMPTY_GITHUB_COMMENTS)
      ) {
        fs.writeFileSync(
          gitHubCommentsFile,
          `:tada: Snapshots of the following projects have been published:
                 Last updated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} \n`
        );
      }
      fs.appendFileSync(gitHubCommentsFile, `${message}\n`);
    }
  }

  public static parseScopeFromPackageJson(): string {
    const gitRootDir = Utils.getRootDir();
    const pathToRootPackageJson = path.join(gitRootDir, NxProject.PACKAGEJSON);
    console.log(fs.readFileSync(pathToRootPackageJson));
    const packageJsonContent = JSON.parse(
      fs.readFileSync(pathToRootPackageJson).toString()
    );
    const name = packageJsonContent.name;
    let scope = (name.match(/@[\S]+\//) || '')[0]?.replace('/', '');
    if (!scope || scope === '') {
      console.error(
        `No scope could be found, please provide a scope in root package.json (e.g. @YourScope/yourAppOrLib)`
      );
      process.exit(1);
    }
    console.log(
      `Found scope ${scope} in package.json ${pathToRootPackageJson}`
    );
    return scope;
  }
}
