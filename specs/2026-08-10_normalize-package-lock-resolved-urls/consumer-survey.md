---
date: 2026-08-11
topic: 'PFM-ISSUE-34454 prep: consumer FE repo lockfile survey'
parent_issue: PFM-ISSUE-34453
target_issue: PFM-ISSUE-34454
status: complete
---

# Consumer FE lockfile survey — prep for PFM-ISSUE-34454

`design.md` noted an out-of-band consumer lockfile survey as prep, "so 34454 starts knowing its blast radius". This is
that survey, run 2026-08-11 while PFM-ISSUE-34453's PR #163 was in review.

## Method

**41 non-archived FE repositories** in the `collaborationFactory` org (`gh repo list … | endswith("-fe")`). For each,
every real `release/*`, `master`, `main` and `develop` branch was enumerated via the branches API, then
`package-lock.json` was fetched raw at that ref and counted:

```
gh api "repos/collaborationFactory/<repo>/contents/package-lock.json?ref=<branch>" \
  -H "Accept: application/vnd.github.raw" | grep -c 'registry\.npmjs\.org'
```

**299 repo/branch combinations** with a lockfile were measured. Script: `survey2.sh` (scratchpad, not committed).

> **Do not repeat the first pass's mistake.** An initial run surveyed only *default* branches and reported
> "0 affected, 41 clean" — which is wrong twice over. It missed all release-branch contamination, and it counted
> repos whose probe simply failed (missing branch, error payload) as "clean". The corrected script rejects any
> response that does not begin with `{` and reports `MISSING` explicitly. **Default branches are not representative.**

## Headline result

| | |
| --- | --- |
| Branches surveyed (with a lockfile) | **299** |
| Affected branches (≥1 `registry.npmjs.org`) | **8** |
| Distinct affected repos | **3** |
| Clean branches | **291** |
| Total npmjs entries across affected branches | **20 537** |

Consumer lockfiles are overwhelmingly clean — **291 of 299 branches resolve 100 % through the JFrog proxy already.**
The contamination is concentrated, not systemic.

## Affected repo/branches

| Repo | Branch | resolved | **npmjs** | jfrog | Character |
| --- | --- | ---: | ---: | ---: | --- |
| `cplace-loomeo-fe` | `release/23.2` | 7386 | **7376** | 10 | essentially un-migrated |
| `cplace-loomeo-fe` | `release/23.3` | 7386 | **7376** | 10 | essentially un-migrated |
| `cplace-loomeo-fe` | `release/22.4` | 2949 | **2901** | 48 | essentially un-migrated |
| `cplace-loomeo-fe` | `release/23.1` | 2988 | **2850** | 138 | essentially un-migrated |
| `cplace-paw-fe` | `release/25.2` | 2576 | **14** | 2562 | migrated, small residue |
| `cplace-paw-fe` | `release/25.3` | 2596 | **14** | 2582 | migrated, small residue |
| `cplace-bayer-prompt-fe` | `release/sprint-56` | 2758 | **3** | 2755 | migrated, small residue |
| `cplace-bayer-prompt-fe` | `release/sprint-57` | 2758 | **3** | 2755 | migrated, small residue |

Two clearly different populations:

1. **`cplace-loomeo-fe` on 22.4–23.3** — these branches predate the JFrog migration entirely and are ~97–100 % npmjs.
   They are almost certainly dormant. Normalizing them is a different (and much larger) job than the residue case, and
   probably not worth doing unless one of those branches is still built.
2. **`cplace-paw-fe` and `cplace-bayer-prompt-fe`** — otherwise fully migrated, with a handful of stragglers. This is
   the same failure shape as `github-actions` itself, at smaller scale, and is what the normalizer is built for.

### The residue is transitive dev dependencies

`cplace-paw-fe` `release/25.2`, all 14:

```
chokidar (×4 paths)   readdirp (×4 paths)   picomatch (×2)   glob-parent (×2)
… under @angular-devkit/architect, @angular/compiler-cli, @compodoc/compodoc, and top level
```

Consistent with `github-actions`' own 171: nested transitive packages that a partial `npm install` re-resolved against
the default registry.

## Why this matters, and the risk it implies

`fe-install-deps.yml` runs `use-npmrc` and then a **workflow-level `npm ci`** against the *consumer's own* lockfile. On
a branch carrying npmjs URLs, that install is exposed to exactly the PFM-ISSUE-34453 failure mode — npm rewrites the
host onto JFrog and drops the path prefix, giving a masked `E404`.

### Verified: `cplace-paw-fe` `release/25.2` and `25.3` are broken today, not merely latent

Checked 2026-08-11. Four independent lines of evidence, and the cache cannot save it:

**1. The lockfile itself fails.** `release/25.2`'s `package.json` + `package-lock.json` fetched raw, `npm ci` run with
the standard cplace `~/.npmrc` and a cold cache:

```
npm error code E404
npm error 404 Not Found - GET https://cplace.jfrog.io/readdirp/-/readdirp-3.6.0.tgz
```

Identical mechanism to PFM-ISSUE-34453 — the `/artifactory/api/npm/cplace-npm` prefix dropped.

**2. No cache exists on those branches.** `cplace-paw-fe` has 13 caches; **zero** on `refs/heads/release/25.2` or
`release/25.3`. The most recent are on `26.1`, `26.2`, `26.3`, `25.4`, `master` and a few PR merge refs.

**3. No other branch's cache could match even if one existed.** The key is
`${{ runner.os }}-modules-${{ hashFiles('**/package-lock.json') }}` — content-addressed to the lockfile. A different
branch has a different lockfile, therefore a different key. Cross-branch collision is impossible by construction.

**4. There are no `restore-keys`.** Verified in `fe-install-deps.yml`, `fe-pr-snapshot.yml` and `fe-licenses.yml` on
`release/25.2`: each `actions/cache` block has `path` and `key` only. So only an *exact* key match sets
`cache-hit: true`; there is no partial-restore path that could skip `Install modules`.

On GitHub's documented cache scoping — a PR run *can* restore caches from the **base branch**, as well as its own
branch and the default branch (siblings are excluded, and entries unused for 7 days are evicted). So "a feature branch
gets no cache" is **not** what makes this fail; points 2–4 are. Worth stating precisely, because the base-branch rule
is the one people tend to forget.

**Conclusion:** any pull request into `cplace-paw-fe` `release/25.2` or `release/25.3` that reaches
`fe-install-deps`, `fe-licenses`, `fe-pr-snapshot` or `fe-pr-close` will fail at `Install modules` with a `***`-masked
`E404`. It is unobserved only because no recent PR has targeted those branches. `master` is clean, which is why the
34453 canary pipeline was green.

The fix is the same 34453 normalizer, pointed at those two branches — 14 entries each, all transitive
(`chokidar`, `readdirp`, `picomatch`, `glob-parent`).

## Second finding: non-URL `resolved` values exist in the wild

Four repos have entries whose `resolved` is a **local path**, not a URL:

| Repo | Count | Example |
| --- | ---: | --- |
| `cplace-paw-fe` | 1 | `node_modules/eslint-plugin-local-custom-rules` → `tools/eslint-rules` |
| `cplace-fe` | 1 | — |
| `cplace-project-planning-fe` | 2 | — |
| `cplace-resource-management-fe` | 1 | — |

**This matters for reuse.** `assert_resolvable` in `tools/scripts/lockfile/lib.sh` hard-fails on any non-root entry
whose `resolved` is not an `https?://…/-/….tgz` URL. That is correct and deliberate for `github-actions`, which has
**zero** such entries — but it means the tooling **cannot be pointed at those four consumer repos unmodified.** It
would abort naming the package path, which is the designed behaviour, not a bug; it just makes the loosening a
prerequisite for any consumer-side rollout.

34454 should decide deliberately whether to permit local-path entries (skip them, since they are not registry-hosted
at all) or to keep failing loudly.

## Recommendations for PFM-ISSUE-34454

1. **`cplace-paw-fe` `release/25.2` and `25.3` are already broken — fix them first.** Verified above, not speculative:
   the lockfile fails a cold `npm ci`, no cache exists on those branches, the content-addressed key makes a
   cross-branch hit impossible, and there are no `restore-keys`. 14 entries each; the 34453 normalizer applies
   unchanged. This is arguably not 34454 work at all but a small immediate fix.
2. **Then the remaining residue** — `cplace-bayer-prompt-fe` (`sprint-56`, `sprint-57`), 3 entries each. Check whether
   those branches are still built before spending anything. Same method: no cache on a branch plus a content-addressed
   key means no masking.
3. **Decide `cplace-loomeo-fe` separately.** Its 22.4–23.3 branches are ~20 500 of the 20 537 total entries and look
   dormant. Establish whether they are still built before spending anything on them.
4. **Loosen `assert_resolvable` for local-path entries before any consumer rollout**, or the tooling aborts on four
   repos.
5. **Do not rely on default-branch surveys.** Every affected branch here is a `release/*`; all 41 default branches are
   clean.

## Reproducing

`survey2.sh` lives in the session scratchpad and is not committed — it is a one-shot diagnostic, and re-running it
against a moving org is more reliable than trusting a stale snapshot. The method is fully described above; the whole
survey takes a couple of minutes at 10-way parallelism.
