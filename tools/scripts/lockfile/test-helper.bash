#!/usr/bin/env bash
#
# Shared bats fixture builders. Fixtures are tiny hand-written lockfiles, not
# copies of the real 262 KB one: the tests assert behaviour, not byte counts.
#
# shellcheck disable=SC2034  # PROXY/NPMJS are consumed by the .bats files that load this

readonly PROXY='https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/'
readonly NPMJS='https://registry.npmjs.org/'

# A three-entry mixed lockfile: one npmjs entry (scoped, with a dependency edge),
# one already on the proxy, plus the root entry which carries no `resolved`.
write_mixed_lockfile() {
  cat >"$1" <<'JSON'
{
  "name": "fixture",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "fixture",
      "version": "1.0.0",
      "dependencies": {
        "@scope/alpha": "^1.0.0"
      }
    },
    "node_modules/@scope/alpha": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/@scope/alpha/-/alpha-1.0.0.tgz",
      "integrity": "sha512-AAAA==",
      "dependencies": {
        "beta": "^2.0.0"
      }
    },
    "node_modules/beta": {
      "version": "2.0.0",
      "resolved": "https://cplace.jfrog.io/artifactory/api/npm/cplace-npm/beta/-/beta-2.0.0.tgz",
      "integrity": "sha512-BBBB=="
    }
  }
}
JSON
}

# Applies a jq filter to a lockfile in place. Used to inject drift.
mutate() {
  local file="$1" filter="$2" tmp
  tmp="$(mktemp)"
  jq "${filter}" "${file}" >"${tmp}"
  mv "${tmp}" "${file}"
}

# A lockfile whose non-root entry carries no `resolved` at all.
write_unresolvable_lockfile() {
  write_mixed_lockfile "$1"
  mutate "$1" 'del(.packages["node_modules/beta"].resolved)'
}

# A lockfile whose non-root entry resolves over a protocol this tool does not
# handle. Must fail by NAME, not with a jq capture stack trace.
write_git_protocol_lockfile() {
  write_mixed_lockfile "$1"
  mutate "$1" '.packages["node_modules/beta"].resolved =
    "git+ssh://git@github.com/example/beta.git#0123456789abcdef"'
}
