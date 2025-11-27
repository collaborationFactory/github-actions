export interface UpdateResult {
  path: string;
  success: boolean;
  updates?: PackageUpdate[];
  error?: string;
}

export interface PackageUpdate {
  package: string;
  oldVersion: string;
  newVersion: string;
}

export interface UpdateSummary {
  results: UpdateResult[];
  prDescription: string;
  allFailed: boolean;
  branch: string;
  distTag: string;
  scopes: Set<string>;
}
