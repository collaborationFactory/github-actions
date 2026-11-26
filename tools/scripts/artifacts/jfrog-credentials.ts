export enum JfrogAuthMode {
  TOKEN = 'TOKEN',
  LEGACY = 'LEGACY',
  NONE = 'NONE',
}

export class JfrogCredentials {
  /** written literally into the dist .npmrc; npm expands it from the step env */
  public static readonly TOKEN_PLACEHOLDER = '${JFROG_TOKEN}';
  public static readonly LEGACY_WARNING =
    'JFROG_BASE64_TOKEN is deprecated: set the JFROG_TOKEN repository secret and pass ' +
    'JFROG_TOKEN instead of JFROG_BASE64_TOKEN to the github-actions FE workflows.';
  public static readonly MISSING_ERROR =
    'No JFrog credentials: pass the JFROG_TOKEN secret (or the deprecated JFROG_BASE64_TOKEN) ' +
    'to this workflow. Publishing and deleting npm artifacts needs one of them.';
  public url = '';
  public user = '';
  public base64Token = '';
  public token = '';

  constructor() {
    this.url = process.env.JFROG_URL != undefined ? process.env.JFROG_URL : '';
    this.user =
      process.env.JFROG_USER != undefined ? process.env.JFROG_USER : '';
    this.base64Token =
      process.env.JFROG_BASE64_TOKEN != undefined
        ? process.env.JFROG_BASE64_TOKEN
        : '';
    this.token =
      process.env.JFROG_TOKEN != undefined ? process.env.JFROG_TOKEN : '';
  }

  /** an optional secret the caller does not pass arrives as '', so presence is truthiness */
  public get authMode(): JfrogAuthMode {
    if (this.token) return JfrogAuthMode.TOKEN;
    if (this.base64Token) return JfrogAuthMode.LEGACY;
    return JfrogAuthMode.NONE;
  }

  /** call once per run, before anything is published or deleted */
  public requireForPublishing(): void {
    switch (this.authMode) {
      case JfrogAuthMode.TOKEN:
        return;
      case JfrogAuthMode.LEGACY:
        console.log(`::warning::${JfrogCredentials.LEGACY_WARNING}`);
        return;
      default:
        console.log(`::error::${JfrogCredentials.MISSING_ERROR}`);
        throw new Error(JfrogCredentials.MISSING_ERROR);
    }
  }

  public getJfrogUrlNoHttp(): string {
    return this.url.replace('https:', '');
  }

  /** keeps secrets out of JSON.stringify, e.g. the handler's "Configuration" log line */
  public toJSON() {
    return { url: this.url, user: this.user, authMode: this.authMode };
  }
}
