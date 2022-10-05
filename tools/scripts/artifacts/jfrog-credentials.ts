export class JfrogCredentials {
  constructor(public url = '', public user = '', public base64Token = '') {}

  public getJfrogUrlNoHttp(): string {
    return this.url.replace('https:', '');
  }
}
