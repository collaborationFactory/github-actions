export class JfrogCredentials {
  public url = '';
  public user = '';
  public base64Token = '';

  constructor() {
    this.url = process.env.JFROG_URL != undefined ? process.env.JFROG_URL : '';
    this.user = process.env.JFROG_USER != undefined ? process.env.JFROG_USER : '';
    this.base64Token = process.env.JFROG_BASE64_TOKEN != undefined ? process.env.JFROG_BASE64_TOKEN : '';
  }

  public getJfrogUrlNoHttp(): string {
    return this.url.replace('https:', '');
  }

}
