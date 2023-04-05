export const workspaceJson='{\n' +
  '  "version": 2,\n' +
  '  "projects": {\n' +
  '    "api-cf-cplace-platform": "libs/api/cf-cplace-platform",\n' +
  '    "api-cf-frontend-sdk": "libs/api/cf-frontend-sdk",\n' +
  '    "cf-apps-e2e": "apps/cf-apps-e2e",\n' +
  '    "cf-fe-code-coverage": "apps/cf-fe-code-coverage",\n' +
  '    "cf-frontend-customization": "libs/cf-frontend-customization",\n' +
  '    "cf-frontend-licenses": "libs/cf-frontend-licenses",\n' +
  '    "cf-frontend-sdk": "libs/cf-frontend-sdk",\n' +
  '    "cf-frontend-sdk-e2e": "apps/cf-frontend-sdk-e2e",\n' +
  '    "cf-ng-module-generator": "libs/cf-ng-module-generator",\n' +
  '    "cf-platform-lib": "libs/cf-platform-lib",\n' +
  '    "cf-shell": "apps/cf-shell",\n' +
  '    "cf-shell-lib": "libs/cf-shell-lib",\n' +
  '    "cf-storybook-lib": "libs/cf-storybook-lib",\n' +
  '    "cf-type-settings-e2e": "apps/cf-type-settings-e2e",\n' +
  '    "my-cf-platform": "apps/my/cf-platform",\n' +
  '    "storybook-shell": "apps/storybook-shell"\n' +
  '  }\n' +
  '}\n'

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
