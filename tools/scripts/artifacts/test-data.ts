export const npmViewResult =
  '{"versions":[\n' +
  '  "0.0.0-SNAPSHOT-lgwc1g48-2023015",\n' +
  '  "0.0.0-SNAPSHOT-le5my1cs-20230110",\n' +
  '  "0.0.0-SNAPSHOT-le5my1cs-20230112",\n' +
  '  "0.0.0-SNAPSHOT-le5my1cs-20230213",\n' +
  '  "0.0.0-SNAPSHOT-lfsbr6h6-20230328",\n' +
  '  "0.0.0-SNAPSHOT-lgwc4m48-20230425",\n' +
  '  "0.0.0-SNAPSHOT-lgwc4m48-20230503",\n' +
  '  "0.0.0-feature-PFM-ISSUE-12053-feature-PFM-ISSUE-12053-Up-820",\n' +
  '  "0.0.0-fix-PFM-TASK-3503-Adjust-the-getMFConfig-in-the-SD-821",\n' +
  '  "0.1.93-hotfix-cplace-5.17.0",\n' +
  '  "0.11.0",\n' +
  '  "0.11.2",\n' +
  '  "0.51.0",\n' +
  '  "22.3.16",\n' +
  '  "23.1.2"]}';

export const npmSearchResult =
  '[\n' +
  '\n' +
  '{"name":"@cplace-next/cf-components","description":null,"maintainers":[],"version":"23.1.2","date":null,"keywords":[],"author":"squad-fe"}\n' +
  ']';

export const globResult = [
  'libs/cf-storybook-lib/project.json',
  'libs/cf-shell-lib/project.json',
  'libs/cf-platform-lib/project.json',
  'libs/cf-core-lib/project.json',
  'libs/cf-frontend-sdk/project.json',
  'libs/my-lib/project.json',
  'apps/cf-shell/project.json',
  'apps/my/cf-platform/project.json',
  'apps/cf-project-planning/project.json',
  'apps/cf-project-planning-lib-e2e/project.json',
  'apps/my-app/project.json',
  'apps/my-app-e2e/project.json',
  'apps/my-regular-app/project.json',
];

export const packageJsonLib1 =
  '{\n' +
  '  "name": "@cplace-frontend-applications/cf-core-lib",\n' +
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
export const app3 = 'cf-project-planning-lib-e2e';
export const lib1 = 'cf-core-lib';
export const lib2 = 'cf-frontend-sdk';
export const affectedApps = app1
  .concat('\n')
  .concat(app2)
  .concat('\n')
  .concat(app3);
export const affectedLibs = lib1.concat('\n').concat(lib2);

export const libsDir: any = affectedLibs.split('\n');
export const appsDir: any = affectedApps.split('\n');
export const base = 'e67bf7f141419e8d1936a2de3eb3970c6a9ec311';
export const npmrc =
  '@cplace-frontend-applications:registry=jfrog_url \n' +
  'jfrog_url:_auth=jfrog_base64_token \n' +
  'jfrog_url:always-auth=true \n' +
  'jfrog_url:email=jfrog_user';
