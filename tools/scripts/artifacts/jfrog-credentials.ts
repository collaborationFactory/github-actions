export enum JfrogAuthMode {
  TOKEN = 'TOKEN',
  LEGACY = 'LEGACY',
  NONE = 'NONE',
}

export class JfrogCredentials {
  /** written literally into the dist .npmrc; npm expands it from the step env */
  public static readonly TOKEN_PLACEHOLDER = '${JFROG_TOKEN}';
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

  public getJfrogUrlNoHttp(): string {
    return this.url.replace('https:', '');
  }

  /** npm looks credentials up by the registry's nerf-dart, which ends in exactly one '/' */
  public getAuthKey(): string {
    return this.getJfrogUrlNoHttp().replace(/\/+$/, '') + '/';
  }

  /** keeps secrets out of JSON.stringify, e.g. the handler's "Configuration" log line */
  public toJSON() {
    return { url: this.url, user: this.user, authMode: this.authMode };
  }
}
