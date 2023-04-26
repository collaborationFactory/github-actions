export const globResult = ['libs/cf-storybook-lib/project.json',
  'libs/cf-shell-lib/project.json',
  'libs/cf-platform-lib/project.json',
  'apps/cf-shell/project.json',
  'apps/my/cf-platform/project.json'];

export const packageJsonLib1 =
  '{\n' +
  '  "name": "@cplace-frontend-applications/cf-core-lib",\n' +
  '  "version": "1.2.3",\n' +
  '  "peerDependencies": {\n' +
  '    "@angular/common": "^13.2.6",\n' +
  '    "@angular/core": "^13.2.6"\n' +
  '  },\n' +
  '  "dependencies": {\n' +
  '    "tslib": "^2.0.0"\n' +
  '  }\n' +
  '}\n';

export const packageJsonLib2 =
  '{\n' +
  '  "name": "@cplace-frontend-applications/cf-frontend-sdk",\n' +
  '  "version": "1.2.3",\n' +
  '  "publishable": true,\n' +
  '  "peerDependencies": {\n' +
  '    "@angular/common": "^13.2.6",\n' +
  '    "@angular/core": "^13.2.6"\n' +
  '  },\n' +
  '  "dependencies": {\n' +
  '    "tslib": "^2.0.0"\n' +
  '  }\n' +
  '}\n';

export const app1 = 'cf-platform';
export const app2 = 'cf-project-planning';
export const lib1 = 'cf-core-lib';
export const lib2 = 'cf-frontend-sdk';
export const affectedApps = app1.concat(' ').concat(app2).concat('\n');
export const affectedLibs = lib1.concat(' ').concat(lib2).concat('\n');
export const base = 'e67bf7f141419e8d1936a2de3eb3970c6a9ec311';
export const npmrc =
  '@cplace-frontend-applications:registry=jfrog_url \n' +
  'jfrog_url:_auth=jfrog_base64_token \n' +
  'jfrog_url:always-auth=true \n' +
  'jfrog_url:email=jfrog_user';
