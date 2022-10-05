import { ArtifactsHandler } from './artifacts-handler';
import { VERSION_BUMP } from './nx-project';

export class Version {
  public major: number = -1;
  public minor: number = -1;
  public patch: number = -1;
  public uniqueIdentifier: string = '';

  constructor(versionString: string = ArtifactsHandler.SNAPSHOT_VERSION, public customSuffix: string = '') {
    if (versionString.match(ArtifactsHandler.SEMVER_REGEX)) {
      this.major = Number.parseInt(versionString.split('.')[0]);
      this.minor = Number.parseInt(versionString.split('.')[1]);
      this.patch = Number.parseInt(versionString.split('.')[2]);
    }
  }

  public patchVersion(versionBump: VERSION_BUMP) {
    switch (versionBump) {
      case VERSION_BUMP.MINOR:
        this.minor = this.minor + 1;
        break;
      case VERSION_BUMP.PATCH:
        this.patch = this.patch + 1;
        break;
    }
  }

  public isValid(): boolean {
    return this.major != -1 && this.minor != -1 && this.patch != -1;
  }

  public compareTo(other: Version): number {
    if (this.major !== other.major) {
      return this.major - other.major;
    } else if (this.minor !== other.minor) {
      return this.minor - other.minor;
    } else {
      return this.patch - other.patch;
    }
  }

  public toString() {
    return `${this.major}.${this.minor}.${this.patch}${this.customSuffix}${this.uniqueIdentifier}`;
  }

  public getGitTag() {
    return `${ArtifactsHandler.VERSION_PREFIX}${this.toString()}`;
  }

  public getNpmTag() {
    return `release-${this.major}.${this.minor}`;
  }
}
