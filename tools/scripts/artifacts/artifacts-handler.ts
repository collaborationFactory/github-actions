import { execSync } from 'child_process';

import { Utils } from './utils';
import { JfrogCredentials } from './jfrog-credentials';
import { NxProject, NxProjectKind } from './nx-project';
import { Version } from './version';

export enum TASK {
  MAIN_SNAPSHOT = 'MAIN_SNAPSHOT',
  PR_SNAPSHOT = 'PR_SNAPSHOT',
  RELEASE = 'RELEASE',
}

export class ArtifactsHandler {
  public static readonly SNAPSHOT_VERSION = '0.0.0';
  public static readonly SNAPSHOT = 'SNAPSHOT';
  public static readonly RELEASE_BRANCH_PREFIX = 'release/';
  // semver regex from https://gist.github.com/jhorsman/62eeea161a13b80e39f5249281e17c39
  public static readonly SEMVER_REGEX =
    /([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+)?$/;
  public static readonly VERSION_PREFIX = 'version/';

  public projects: NxProject[] = [];
  public base = '';
  public tag = '';
  public currentVersion: Version = new Version('');
  public calculatedNewVersion: Version = new Version('');
  public onlyAffected = true;
  public isSnapshot = true;
  public task: TASK = TASK.MAIN_SNAPSHOT;
  private onlyDeleteArtifacts = false;
  private onlyBumpVersion = false;
  private prNumber = '';
  private currentBranch = '';
  private jfrogCredentials: JfrogCredentials;
  private scope = '';

  constructor() {
    this.scope = Utils.parseScopeFromPackageJson();
    // parse ENV variables
    this.jfrogCredentials = new JfrogCredentials();
    this.tag = process.env.TAG != undefined ? process.env.TAG : '';
    this.currentBranch = Utils.getCurrentBranchNameFromGithubEnv();
    this.prNumber =
      process.env.PR_NUMBER != undefined ? process.env.PR_NUMBER : '';
    if (process.env.ONLY_DELETE_ARTIFACTS != undefined)
      this.onlyDeleteArtifacts = JSON.parse(process.env.ONLY_DELETE_ARTIFACTS);
    if (process.env.ONLY_BUMP_VERSION != undefined)
      this.onlyBumpVersion = JSON.parse(process.env.ONLY_BUMP_VERSION);
    if (process.env.SNAPSHOT != undefined)
      this.isSnapshot = JSON.parse(process.env.SNAPSHOT);
    this.base = process.env.BASE != undefined ? process.env.BASE : 'main';

    // in case base is not a SHA1 commit hash add origin
    if (!/\b[0-9a-f]{5,40}\b/.test(this.base))
      this.base = 'origin/' + this.base;

    // in case of a release Tag (e.g. version/22.3.1) all projects should be built and published
    if (this.tag.startsWith(ArtifactsHandler.VERSION_PREFIX)) {
      this.onlyAffected = false;
      this.isSnapshot = false;
      this.currentVersion = new Version(this.tag.replace('version/', ''));
      this.task = TASK.RELEASE;
    }
    // in case of a release Branch
    if (this.currentBranch.startsWith(ArtifactsHandler.RELEASE_BRANCH_PREFIX)) {
      this.currentVersion = Utils.getVersionFromReleaseBranch(
        this.currentBranch
      );
      this.isSnapshot = false;
      this.task = TASK.RELEASE;
    }
    // in case a snapshot for Main Branch should be done
    if (this.isSnapshot) {
      this.currentVersion = new Version(
        ArtifactsHandler.SNAPSHOT_VERSION,
        Utils.getUniqueSnapshotIdentifier()
      );
      this.tag = this.currentVersion.toString();
    }

    // in case a snapshot for a PR should be done -> init a valid Version
    if (this.prNumber !== '') {
      this.isSnapshot = true;
      this.currentVersion = new Version(
        ArtifactsHandler.SNAPSHOT_VERSION,
        Utils.getPRVersion(this.currentBranch, this.prNumber)
      );
      this.task = TASK.PR_SNAPSHOT;
    }
    console.log('Configuration ' + JSON.stringify(this));
  }

  async handle() {
    Utils.initGithubActionsFile();
    if (
      this.onlyBumpVersion &&
      this.currentBranch.startsWith(ArtifactsHandler.RELEASE_BRANCH_PREFIX)
    ) {
      console.log(`About to bump version for release Branch`);
      this.bumpVersionForReleaseBranch();
    } else {
      console.log(`About to build and release projects`);
      this.initProjects();
      await this.buildAndPublishProjects();
    }
    return Promise.resolve();
  }

  private async buildAndPublishProjects() {
    console.log(`Number of projects being processed: ${this.projects.length}`);
    console.log(`Projects being processed: ${JSON.stringify(this.projects)}`);
    for (const project of this.projects) {
      console.log(`Currently processing: ${JSON.stringify(project)}`);
      if (project.isPublishable) {
        if (this.onlyDeleteArtifacts)
          await project.deleteArtifact(
            this.jfrogCredentials,
            this.currentVersion
          );
        else {
          project.build();
          project.writeNPMRCInDist(this.jfrogCredentials, this.scope);
          project.copyFossList();
          project.setVersionOrGeneratePackageJsonInDist(this.currentVersion, this.jfrogCredentials.url);
          if (this.task === TASK.PR_SNAPSHOT)
            await project.deleteArtifact(
              this.jfrogCredentials,
              this.currentVersion
            );
          await project.publish();
        }
      }
    }
  }

  private initProjects() {
    if (this.onlyAffected) {
      this.initAffectedProjects();
    } else {
      this.projects = Utils.getAllNxProjects(
        this.task,
        this.currentVersion,
        this.scope
      );
    }
  }

  private initAffectedProjects() {
    this.projects = Utils.getAffectedNxProjects(
      this.base,
      NxProjectKind.Application,
      this.task,
      this.currentVersion,
      this.scope
    );
    this.projects.push(
      ...Utils.getAffectedNxProjects(
        this.base,
        NxProjectKind.Library,
        this.task,
        this.currentVersion,
        this.scope
      )
    );
  }

  private bumpVersionForReleaseBranch() {
    this.initAffectedProjects();
    this.calculatedNewVersion = Utils.calculateNewVersion(this.currentBranch);
    console.log(
      `The calculated new tag/version for branch ${this.currentBranch} is ${this.calculatedNewVersion}`
    );
    if (this.projects.length > 0 || this.calculatedNewVersion.patch === 1) {
      console.log(
        execSync(`git tag ${this.calculatedNewVersion.getGitTag()}`).toString()
      );
      console.log(
        execSync(
          `git push origin ${this.calculatedNewVersion.getGitTag()}`
        ).toString()
      );
    } else {
      console.log(
        'No projects are affected and no new Minor Release Branch was added therefore no new Minor/Patch version is needed'
      );
    }
  }
}
