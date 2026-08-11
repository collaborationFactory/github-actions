# `package-lock.json` registry normalization

Every `resolved` URL in this repository's `package-lock.json` must point at the cplace JFrog npm **proxy**. This
directory contains the tooling that enforces that.

## Why this exists

The composite actions in `.github/actions/` run `npm ci` **inside the action directory, on the consumer's runner**,
while that consumer's `~/.npmrc` is active. When a lockfile entry resolves via `https://registry.npmjs.org/`, npm
rewrites the host onto the configured registry and **discards the registry's path prefix**
(`pacote/lib/remote.js`: `new URL(resolvedURL.pathname, this.registry)`), producing a 404:

| | |
| --- | --- |
| lockfile | `https://registry.npmjs.org/update-browserslist-db/-/update-browserslist-db-1.0.10.tgz` |
| requested | `https://cplace.jfrog.io/update-browserslist-db/-/…` → **404** |
| correct | `https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/update-browserslist-db/-/…` → 200 |

The failure is hard to read because the broken URL's prefix is the `JFROG_URL` secret, so CI masks it as `***`. That
is why **every message these scripts print names a package path, never a URL.**

## Why bash and jq, in a repository that is otherwise TypeScript

Bootstrap independence. `npx ts-node` needs `node_modules`, which needs `npm ci` — which is exactly what is broken when
the lockfile carries npmjs URLs and your `~/.npmrc` points at JFrog. A TypeScript normalizer could not repair the
lockfile it exists to repair. These scripts need only `bash`, `jq` and `git`, all of which work on a fresh clone with
nothing installed.

**Prerequisite:** `jq`. macOS: `brew install jq`. It is pre-installed on GitHub-hosted ubuntu runners.

## The two scripts

| script | what it does |
| --- | --- |
| `normalize-lockfile.sh [<lockfile>]` | Rewrites every `resolved` prefix onto the proxy. Idempotent. Changes nothing else. |
| `check-lockfile.sh [--baseline <ref-or-file>] [<candidate>]` | Proves a lockfile differs from its baseline **only** in registry prefixes. Exit 0 or 1. |

Both default to `./package-lock.json`. Call them by path — there is no npm script and no composite action wrapper, so
that they keep working when `npm ci` does not.

---

## Flow 1 — normalizing a branch

```bash
./tools/scripts/lockfile/normalize-lockfile.sh
git add package-lock.json
git commit -m 'PFM-ISSUE-34453 - github-actions: normalize package-lock.json resolved URLs onto the JFrog npm proxy'
./tools/scripts/lockfile/check-lockfile.sh --baseline HEAD~1
```

Commit the lockfile **on its own**, separate from any tooling change. Then the commit's parent *is* the baseline, and
verification is exactly `--baseline HEAD~1` with no ref to remember.

Expect: `entries rewritten: 171`, `byte delta: 4788`, 342 changed lines, none of them outside a `"resolved"` line.

## Flow 2 — resolving an upmerge conflict on `package-lock.json`

```bash
git checkout --ours -- package-lock.json     # keep this branch's lockfile
./tools/scripts/lockfile/normalize-lockfile.sh
./tools/scripts/lockfile/check-lockfile.sh --baseline :2:   # :2: = ours, :3: = theirs
```

Proceed **only** on exit 0. Never `--theirs`, never a hand edit: the point of the check is that correctness does not
depend on anyone reading a 262 KB diff.

`--baseline` accepts a git ref (`HEAD~1`, `origin/release/25.2`), a merge stage (`:2:`, `:3:`), or a plain file path.
Whatever it resolves to is printed on every run, so a wrong baseline is visible rather than silent.

## Flow 3 — interpreting a guard failure

`.github/workflows/pr-checks.yml` runs `check-lockfile.sh` on every pull request. It makes **two independent
assertions, both of which must pass**:

**1. Graph invariance.** The whole document, with every `resolved` reduced to its bare tarball path, must equal the
baseline's. This catches a changed version, a poisoned `integrity`, a changed tarball filename, a changed dependency
edge, an added or dropped entry.

```
FAIL: the dependency graph differs from the baseline. Drifted entries:
  node_modules/@ampproject/remapping
```

→ Something other than a registry prefix changed. This is the bad-merge case. Do not "fix" it by re-running the
normalizer; work out why that entry moved.

**2. Prefix exactness.** Every `resolved` must carry exactly the one proxy prefix.

```
FAIL: 2 distinct registry prefixes found (expected exactly 1).
These entries do not resolve via the cplace npm proxy:
  node_modules/jest
```

→ An entry is on npmjs, or on a typo'd proxy path. Run `normalize-lockfile.sh`.

Neither assertion subsumes the other. Graph invariance deliberately strips the host, so it cannot see an entry left on
npmjs or a typo'd `cplace-nmp`; prefix exactness sees nothing *but* the host. Both are required, and
`check-lockfile.bats` asserts that each drift class fails via the correct one.

### "no usable tarball URL"

```
ERROR: these entries in package-lock.json have no usable tarball URL:
  node_modules/foo
```

A non-root entry has no `resolved`, or resolves over `link:` / `file:` / `git+ssh:`. There are none today (measured: 0
on all seven branches), and this is a **deliberate** hard failure rather than a silent skip. Introducing such a
dependency legitimately means loosening `assert_resolvable` in `lib.sh` as a reviewed edit — not working around it.

---

## Files

| file | role |
| --- | --- |
| `lib.sh` | Shared constants and helpers. Sourced, never executed. |
| `fingerprint.jq` | Reduces a lockfile to its registry-independent comparable form. |
| `normalize-lockfile.sh` | The normalizer. |
| `check-lockfile.sh` | The invariant check. |
| `test-helper.bash` | bats fixture builders. |
| `*.bats` | Behavioural tests, including the six injected-drift cases. |

Run the tests with `bats tools/scripts/lockfile/` and the linter with `shellcheck tools/scripts/lockfile/*.sh`. Both
also run in CI on every pull request.

**The proxy URL is a hard-coded constant in `lib.sh`, on purpose.** It *is* the invariant being asserted; if it were
caller-supplied, a typo'd prefix passed to both scripts would validate itself. It is not a secret — it is already
committed in plaintext in hundreds of lockfile entries — and it is **not** `JFROG_URL`, which is the *publish* target
(`…/artifactory/cplace-npm-local`), a different path entirely.

These files are intended to be **byte-identical across all seven long-lived branches**, so that a future upmerge sees a
conflict-free add/add. Change them on one branch and the change has to reach the others.

## Related

- `specs/2026-08-10_normalize-package-lock-resolved-urls/` — research, design and implementation plan
- PFM-ISSUE-34453 — the ticket
- PFM-ISSUE-34454 — `DOT_NPMRC` standardization and the JFrog anonymous-access shutdown
