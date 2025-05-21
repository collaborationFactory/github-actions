# Coverage Gate Implementation Plan

## 1. Project Structure

We'll modify/create these files:
- Modify: `.github/workflows/fe-code-quality.yml` - Enhance existing workflow 
- Create: `tools/scripts/run-many/coverage-evaluator.ts` - Module for evaluating coverage reports
- Create: `tools/scripts/run-many/threshold-handler.ts` - Module to parse and handle thresholds

## 2. Detailed Implementation Steps

### 2.1. Create Coverage Threshold Handler Module

First, create `tools/scripts/run-many/threshold-handler.ts`:

```typescript
import * as core from '@actions/core';

export interface CoverageThreshold {
  lines?: number;
  statements?: number;
  functions?: number;
  branches?: number;
}

export interface ThresholdConfig {
  global: CoverageThreshold;
  projects: Record<string, CoverageThreshold | null>;
}

/**
 * Parses the COVERAGE_THRESHOLDS environment variable
 */
export function getCoverageThresholds(): ThresholdConfig {
  if (!process.env.COVERAGE_THRESHOLDS) {
    return { global: {}, projects: {} };
  }

  try {
    return JSON.parse(process.env.COVERAGE_THRESHOLDS);
  } catch (error) {
    core.error(`Error parsing COVERAGE_THRESHOLDS: ${error.message}`);
    return { global: {}, projects: {} };
  }
}

/**
 * Gets thresholds for a specific project
 */
export function getProjectThresholds(project: string, thresholds: ThresholdConfig): CoverageThreshold | null {
  // If project explicitly set to null, return null to skip
  if (thresholds.projects && thresholds.projects[project] === null) {
    return null;
  }

  // If project has specific thresholds, use those
  if (thresholds.projects && thresholds.projects[project]) {
    return thresholds.projects[project];
  }

  // Otherwise, use global thresholds if available
  if (thresholds.global) {
    return thresholds.global;
  }

  // If no thresholds defined, return null
  return null;
}
```

### 2.2. Create Coverage Evaluator Module

Next, create `tools/scripts/run-many/coverage-evaluator.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import { CoverageThreshold, getProjectThresholds, ThresholdConfig } from './threshold-handler';

interface CoverageSummary {
  lines: { pct: number };
  statements: { pct: number };
  functions: { pct: number };
  branches: { pct: number };
}

interface ProjectCoverageResult {
  project: string;
  thresholds: CoverageThreshold | null;
  actual: {
    lines: number;
    statements: number;
    functions: number;
    branches: number;
  } | null;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
}

/**
 * Evaluates coverage for all projects against their thresholds
 */
export function evaluateCoverage(projects: string[], thresholds: ThresholdConfig): boolean {
  if (!process.env.COVERAGE_THRESHOLDS) {
    return true; // No thresholds defined, pass by default
  }
  
  let allProjectsPassed = true;
  const coverageResults: ProjectCoverageResult[] = [];
  
  for (const project of projects) {
    const projectThresholds = getProjectThresholds(project, thresholds);
    
    // Skip projects with null thresholds
    if (projectThresholds === null) {
      core.info(`Coverage evaluation skipped for ${project}`);
      coverageResults.push({
        project,
        thresholds: null,
        actual: null,
        status: 'SKIPPED'
      });
      continue;
    }
    
    const coveragePath = path.resolve(process.cwd(), `coverage/${project}/coverage-summary.json`);
    
    if (!fs.existsSync(coveragePath)) {
      core.warning(`No coverage report found for ${project} at ${coveragePath}`);
      coverageResults.push({
        project,
        thresholds: projectThresholds,
        actual: null,
        status: 'FAILED' // Mark as failed if no coverage report is found
      });
      allProjectsPassed = false;
      continue;
    }
    
    try {
      const coverageData = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
      const summary = coverageData.total as CoverageSummary;
      
      const projectPassed = 
        (!projectThresholds.lines || summary.lines.pct >= projectThresholds.lines) &&
        (!projectThresholds.statements || summary.statements.pct >= projectThresholds.statements) &&
        (!projectThresholds.functions || summary.functions.pct >= projectThresholds.functions) &&
        (!projectThresholds.branches || summary.branches.pct >= projectThresholds.branches);
      
      if (!projectPassed) {
        allProjectsPassed = false;
      }
      
      coverageResults.push({
        project,
        thresholds: projectThresholds,
        actual: {
          lines: summary.lines.pct,
          statements: summary.statements.pct,
          functions: summary.functions.pct,
          branches: summary.branches.pct
        },
        status: projectPassed ? 'PASSED' : 'FAILED'
      });
    } catch (error) {
      core.error(`Error processing coverage for ${project}: ${error.message}`);
      coverageResults.push({
        project,
        thresholds: projectThresholds,
        actual: null,
        status: 'FAILED'
      });
      allProjectsPassed = false;
    }
  }
  
  // Post results to PR comment
  postCoverageComment(coverageResults);
  
  return allProjectsPassed;
}

/**
 * Formats the coverage results into a markdown table
 */
function formatCoverageComment(results: ProjectCoverageResult[], artifactUrl: string): string {
  let comment = '## Test Coverage Results\n\n';
  comment += '| Project | Metric | Threshold | Actual | Status |\n';
  comment += '|---------|--------|-----------|--------|--------|\n';
  
  results.forEach(result => {
    if (result.status === 'SKIPPED') {
      comment += `| ${result.project} | All | N/A | N/A | ⏩ SKIPPED |\n`;
    } else if (result.actual === null) {
      comment += `| ${result.project} | All | Defined | No Data | ❌ FAILED |\n`;
    } else {
      const metrics = ['lines', 'statements', 'functions', 'branches'];
      metrics.forEach((metric, index) => {
        // Skip metrics that don't have a threshold
        if (!result.thresholds[metric]) return;
        
        const threshold = result.thresholds[metric];
        const actual = result.actual[metric].toFixed(2);
        const status = actual >= threshold ? '✅ PASSED' : '❌ FAILED';
        
        // Only include project name in the first row for this project
        const projectCell = index === 0 ? result.project : '';
        
        comment += `| ${projectCell} | ${metric} | ${threshold}% | ${actual}% | ${status} |\n`;
      });
    }
  });
  
  // Add overall status
  const overallStatus = results.every(r => r.status !== 'FAILED') ? '✅ PASSED' : '❌ FAILED';
  comment += `\n### Overall Status: ${overallStatus}\n`;
  
  // Add link to detailed HTML reports
  if (artifactUrl) {
    comment += `\n📊 [View Detailed HTML Coverage Reports](${artifactUrl})\n`;
  }
  
  return comment;
}

/**
 * Writes the coverage results to a file for PR comment
 */
function postCoverageComment(results: ProjectCoverageResult[]): void {
  // The actual artifact URL will be provided by GitHub Actions in the workflow
  const artifactUrl = process.env.COVERAGE_ARTIFACT_URL || '';
  
  const comment = formatCoverageComment(results, artifactUrl);
  
  // Write to a file that will be used by thollander/actions-comment-pull-request action
  const gitHubCommentsFile = path.resolve(process.cwd(), 'coverage-report.txt');
  fs.writeFileSync(gitHubCommentsFile, comment);
  
  core.info('Coverage results saved for PR comment');
}
```

### 2.3. Modify run-many.ts Script

Update `tools/scripts/run-many/run-many.ts` to incorporate the coverage gate functionality:

```typescript
import { getAffectedProjects } from './affected-projects';
import { execSync } from 'child_process';
import * as core from '@actions/core';
import * as path from 'path';
import { getCoverageThresholds } from './threshold-handler';
import { evaluateCoverage } from './coverage-evaluator';

function getE2ECommand(command: string, base: string): string {
  command = command.concat(` -c ci --base=${base} --verbose`);
  return command;
}

function runCommand(command: string): void {
  core.info(`Running > ${command}`);

  try {
    const output = execSync(command, { stdio: 'pipe', maxBuffer: 1024 * 1024 * 1024, encoding: 'utf-8' }); // 1GB
    core.info(output.toString())
  } catch (error) {
    if (error.signal === 'SIGTERM') {
      core.error('Timed out');
    } else if (error.code === 'ENOBUFS') {
      core.error('Buffer exceeded');
    }
    core.info(error.stdout.toString());
    core.error(error.stderr.toString());
    core.error(`Error message: ${error.message}`);
    core.error(`Error name: ${error.name}`);
    core.error(`Stacktrace:\n${error.stack}`);
    core.setFailed(error);
  }
}

function main() {
  const target = process.argv[2];
  const jobIndex = Number(process.argv[3]);
  const jobCount = Number(process.argv[4]);
  let base = process.argv[5];

  // in case base is not a SHA1 commit hash add origin
  if (!/\b[0-9a-f]{5,40}\b/.test(base)) base = 'origin/' + base;
  if(base.includes('0000000000000000')){
    base = execSync(`git rev-parse --abbrev-ref origin/HEAD `).toString().trim();
  }
  const ref = process.argv[6];

  core.info(`Inputs:\n target ${target},\n jobIndex: ${jobIndex},\n jobCount ${jobCount},\n base ${base},\n ref ${ref}`)

  const projectsString = getAffectedProjects(target, jobIndex, jobCount, base, ref);
  const projects = projectsString ? projectsString.split(',') : [];
  
  // Check if coverage gate is enabled
  const coverageEnabled = !!process.env.COVERAGE_THRESHOLDS;
  
  // Modified command construction
  const runManyProjectsCmd = `npx nx run-many --targets=${target} --projects="${projectsString}"`;
  let cmd = `${runManyProjectsCmd} --parallel=false --prod`;
  
  // Add coverage flag if enabled and target is test
  if (coverageEnabled && target === 'test') {
    // Add coverage reporters for HTML, JSON, and JUnit output
    cmd += ' --coverage --coverageReporters=json,lcov,text,clover,html,json-summary --reporters=default,jest-junit';
  }

  if (target.includes('e2e')) {
    cmd = getE2ECommand(cmd, base);
  }

  if (projects.length > 0) {
    runCommand(cmd);
    
    // Evaluate coverage if enabled and target is test
    if (coverageEnabled && target === 'test') {
      const thresholds = getCoverageThresholds();
      const passed = evaluateCoverage(projects, thresholds);
      
      if (!passed) {
        core.setFailed('One or more projects failed to meet coverage thresholds');
        process.exit(1);
      }
    }
  } else {
    core.info('No affected projects :)');
  }
}

main();
```

### 2.4. Modify Existing Workflow File for Code Quality

Update the existing `.github/workflows/fe-code-quality.yml`:

```yaml
name: Frontend Code Quality Workflow

on: 
  workflow_call:
    secrets:
      COVERAGE_THRESHOLDS:
        required: false

jobs:
  code-quality:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        target: [ 'test' ]
        jobIndex: [ 1, 2, 3, 4 ]
    env:
      jobCount: 4
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.ref }}
          fetch-depth: 0

      - uses: actions/setup-node@v3
        with:
          node-version: 18.19.1
      - name: Cache Node Modules
        id: npm-cache
        uses: actions/cache@v4
        with:
          path: '**/node_modules'
          key: ${{ runner.os }}-modules-${{ hashFiles('**/package-lock.json') }}

      - name: Formatter
        run: npx nx format:check --base=origin/${{ github.event.pull_request.base.ref }}

      - name: Linter
        run: npx nx affected --target=lint --parallel --configuration=dev --base=origin/${{ github.event.pull_request.base.ref }}

      - name: Unit Tests
        uses: collaborationFactory/github-actions/.github/actions/run-many@master
        with:
          target: ${{ matrix.target }}
          jobIndex: ${{ matrix.jobIndex }}
          jobCount: ${{ env.jobCount }}
          base: ${{ github.event.pull_request.base.ref }}
          ref: ${{ github.event.pull_request.head.ref }}
        env:
          COVERAGE_THRESHOLDS: ${{ secrets.COVERAGE_THRESHOLDS }}

      - name: Upload Coverage Reports
        if: always() && matrix.jobIndex == 1 && secrets.COVERAGE_THRESHOLDS != ''
        uses: actions/upload-artifact@v4
        with:
          name: coverage-reports
          path: coverage/
          retention-days: 7

      - name: Set Artifact URL
        if: github.event_name == 'pull_request' && always() && matrix.jobIndex == 1 && secrets.COVERAGE_THRESHOLDS != ''
        run: |
          echo "COVERAGE_ARTIFACT_URL=${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}" >> $GITHUB_ENV

      - name: Comment PR with Coverage Report
        if: github.event_name == 'pull_request' && always() && matrix.jobIndex == 1 && secrets.COVERAGE_THRESHOLDS != ''
        uses: thollander/actions-comment-pull-request@v3
        with:
          file_path: 'coverage-report.txt'
          comment_tag: 'coverage-report'
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## 3. Usage Instructions

### 3.1. Setting Up Coverage Thresholds

Project maintainers will need to create a GitHub repository secret named `COVERAGE_THRESHOLDS` with JSON content like:

```json
{
  "global": {
    "lines": 80,
    "statements": 80,
    "functions": 75,
    "branches": 70
  },
  "projects": {
    "cf-platform": {
      "lines": 85,
      "statements": 85,
      "functions": 80,
      "branches": 75
    },
    "cf-components": null,
    "cf-utils": {
      "lines": 70,
      "statements": 70,
      "functions": 65,
      "branches": 60
    }
  }
}
```

### 3.2. Enabling the Coverage Gate

To enable the coverage gate in a project:

1. Configure the `COVERAGE_THRESHOLDS` secret in your repository settings
2. Make sure your Jest configuration is compatible with the coverage reporters
3. No changes to workflows needed - the existing code quality workflow will automatically use coverage gates when the secret is set

## 4. Testing Plan

### 4.1. Unit Tests

Create unit tests for:
- Threshold parsing logic
- Coverage evaluation logic
- PR comment formatting

### 4.2. Integration Tests

1. Test with valid thresholds and passing coverage
2. Test with valid thresholds and failing coverage
3. Test with empty or invalid threshold configurations
4. Test with missing coverage reports

### 4.3. End-to-End Tests

Create a sample PR with:
- Projects that pass the thresholds
- Projects that fail the thresholds
- Projects exempt from coverage evaluation

## 5. Implementation Timeline

- Day 1: Implement threshold handling and coverage evaluation modules
- Day 2: Update run-many.ts and modify workflow file
- Day 3: Testing and bug fixes
- Day 4: Documentation and final review

## 6. Future Improvements

- Add trend analysis to show coverage improvement/regression over time
- Support different thresholds for different branches
- Add visual charts to the PR comments
- Integration with code quality tools like SonarQube

## 7. Key Benefits

- Enforces coverage standards across the codebase
- Provides immediate feedback to developers about coverage issues
- Uses existing tooling and workflow to minimize disruption
- Allows customization of thresholds per project or globally
- Can skip evaluation for projects where coverage isn't relevant

This implementation will help maintain or improve code quality by ensuring adequate test coverage across the codebase while providing flexibility for different project requirements.
