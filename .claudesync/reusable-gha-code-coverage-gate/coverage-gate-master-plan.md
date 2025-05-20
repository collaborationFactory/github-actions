### Key Benefits

- Enforces coverage standards across the codebase
- Provides immediate feedback to developers about coverage issues
- Uses existing tooling and workflow to minimize disruption
- Allows customization of thresholds per project or globally
- Can skip evaluation for projects where coverage isn't relevant

This implementation will help maintain or improve code quality by ensuring adequate test coverage across the codebase while providing flexibility for different project requirements.# Master Plan: GitHub Actions Coverage Gate Implementation

## Overview

This master plan outlines the implementation of a Jest test coverage quality gate for GitHub Actions workflows. The gate will enforce configurable coverage thresholds on affected projects in the PR pipeline, blocking PRs that don't meet standards.

## 1. JSON Structure for Coverage Thresholds

The coverage thresholds will be stored as a GitHub repository secret (`COVERAGE_THRESHOLDS`) with the following JSON structure:

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
    "cf-components": null,  // Skip coverage evaluation for this project
    "cf-utils": {
      "lines": 70,
      "statements": 70,
      "functions": 65,
      "branches": 60
    }
  }
}
```

Key features:
- `global`: Default thresholds applied to any project without specific settings
- `projects`: Project-specific thresholds that override global defaults
- `null` values: Explicitly skip coverage evaluation for specific projects

## 2. Implementation in run-many.ts

We'll modify the existing `tools/scripts/run-many/run-many.ts` script to:
1. Check for the presence of `COVERAGE_THRESHOLDS` environment variable
2. If present, parse it as JSON and extract thresholds
3. Add coverage collection to the test command
4. Evaluate coverage results against thresholds
5. Generate a coverage report for PR commenting
6. Fail the build if any project doesn't meet its thresholds

### Key Functions to Implement:

#### 2.1 Parse Coverage Thresholds

```typescript
function getCoverageThresholds(): any {
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

function getProjectThresholds(project: string, thresholds: any): any {
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

#### 2.2 Evaluate Coverage Against Thresholds

```typescript
function evaluateCoverage(projects: string[], thresholds: any): boolean {
  if (!process.env.COVERAGE_THRESHOLDS) {
    return true; // No thresholds defined, pass by default
  }
  
  let allProjectsPassed = true;
  const coverageResults = [];
  
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
    
    const coverageData = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
    const summary = coverageData.total; // Use the summary from Jest coverage report
    
    const projectPassed = 
      summary.lines.pct >= projectThresholds.lines &&
      summary.statements.pct >= projectThresholds.statements &&
      summary.functions.pct >= projectThresholds.functions &&
      summary.branches.pct >= projectThresholds.branches;
    
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
  }
  
  // Post results to PR comment
  postCoverageComment(coverageResults);
  
  return allProjectsPassed;
}
```

#### 2.3 Generate PR Comment with Tabular Results

```typescript
function formatCoverageComment(results: any[]): string {
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
  
  return comment;
}

function postCoverageComment(results: any[]): void {
  const comment = formatCoverageComment(results);
  
  // Write to a file that will be used by thollander/actions-comment-pull-request action
  const gitHubCommentsFile = path.resolve(process.cwd(), 'coverage-report.txt');
  fs.writeFileSync(gitHubCommentsFile, comment);
  
  core.info('Coverage results saved for PR comment');
}
```

#### 2.4 Modified Main Function

```typescript
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
    cmd += ' --coverage';
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
```

## 3. Sample PR Comment Output

The PR comment will look like this:

```
## Test Coverage Results

| Project | Metric | Threshold | Actual | Status |
|---------|--------|-----------|--------|--------|
| cf-platform | lines | 85% | 87.42% | ✅ PASSED |
| | statements | 85% | 86.10% | ✅ PASSED |
| | functions | 80% | 82.23% | ✅ PASSED |
| | branches | 75% | 77.18% | ✅ PASSED |
| cf-components | All | N/A | N/A | ⏩ SKIPPED |
| cf-utils | lines | 70% | 65.30% | ❌ FAILED |
| | statements | 70% | 68.45% | ❌ FAILED |
| | functions | 65% | 62.60% | ❌ FAILED |
| | branches | 60% | 55.20% | ❌ FAILED |
| some-lib | lines | 80% | 83.50% | ✅ PASSED |
| | statements | 80% | 81.75% | ✅ PASSED |
| | functions | 75% | 78.30% | ✅ PASSED |
| | branches | 70% | 72.40% | ✅ PASSED |

### Overall Status: ❌ FAILED
```

## 4. Implementation Steps

1. Update the `tools/scripts/run-many/run-many.ts` file:
  - Add functions to parse coverage thresholds
  - Implement thresholds evaluation logic
  - Add coverage report generation

2. Update the GitHub workflow file to:
  - Pass the COVERAGE_THRESHOLDS secret as an environment variable to the run-many.ts script
  - Add a step to post the coverage report as a PR comment using thollander/actions-comment-pull-request@v3

   ```yaml
   # Example step to add to the workflow file
   - name: Comment PR with Coverage Report
     if: github.event_name == 'pull_request' && always()
     uses: thollander/actions-comment-pull-request@v3
     with:
       message_path: 'coverage-report.txt'
       comment_tag: 'coverage-report'
       GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   ```

3. Update the Jest configuration if needed to ensure coverage reports are generated in the expected format and location.

## 5. Testing Approach

1. Local testing:
  - Create mock coverage reports
  - Test threshold evaluation logic
  - Verify comment formatting

2. PR testing:
  - Create a test PR with varying levels of coverage
  - Verify the workflow correctly evaluates thresholds
  - Check that PR comments are formatted properly
  - Confirm build fails when thresholds are not met

## 6. Estimated Development Timeline

1. Day 1: Implement and test coverage threshold parsing and evaluation
2. Day 2: Implement PR comment generation and test output formatting
3. Day 3: Integration testing and documentation

## 7. Future Enhancements

1. Add trending data to show coverage improvement or regression
2. Support for different threshold levels for different branches
3. Visual charts or graphs in PR comments
4. Integration with SonarQube or other code quality tools

## 8. Full Implementation Example

Here's a brief example of the needed changes to GitHub workflow file:

```yaml
# Partial .github/workflows/fe-code-quality.yml
name: Frontend Code Quality

on:
  workflow_call:
    inputs:
      # Existing inputs...
    secrets:
      # Existing secrets...
      COVERAGE_THRESHOLDS:
        required: false

jobs:
  # Existing jobs...
  
  unit-test:
    runs-on: ubuntu-latest
    if: ${{ !inputs.skip_unit_tests }}
    needs: [setup]
    steps:
      # Existing setup steps...
      
      - name: Run Unit Tests
        run: node tools/scripts/run-many/run-many.js test ${{ matrix.index }} ${{ strategy.job-total }} ${{ needs.setup.outputs.base }} ${{ github.head_ref || github.ref_name }}
        env:
          COVERAGE_THRESHOLDS: ${{ secrets.COVERAGE_THRESHOLDS }}
      
      - name: Comment PR with Coverage Report
        if: github.event_name == 'pull_request' && always() && env.COVERAGE_THRESHOLDS != ''
        uses: thollander/actions-comment-pull-request@v3
        with:
          message_path: 'coverage-report.txt'
          comment_tag: 'coverage-report'
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The complete implementation will modify the existing `run-many.ts` script to add coverage gate functionality while providing clear feedback via PR comments using the thollander/actions-comment-pull-request action.
