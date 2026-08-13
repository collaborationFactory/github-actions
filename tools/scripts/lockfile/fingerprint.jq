# Reduces a package-lock.json to a registry-independent, comparable form: every
# `resolved` URL is replaced by its bare tarball path. A legitimately rehosted
# entry therefore compares EQUAL, while a changed version, integrity, tarball
# filename or dependency edge does not.
#
# Requires: --arg tarball_re '<regex with a named group `t`>'  (see lib.sh)
#
# Requires also that the caller has already run `assert_resolvable`. A
# non-matching `capture` yields `empty`, and `|= empty` deletes the key, so an
# unvalidated entry would lose its `resolved` here rather than raising - on both
# sides of the comparison at once, which is precisely what this transform exists
# to detect.
#
# This transform is deliberately BLIND to which host an entry was rehosted onto
# - a typo'd proxy repo name and an entry left on npmjs both survive it. That
# blindness is exactly why check-lockfile.sh runs a second, independent prefix
# assertion; the two together are what design.md Dimension 2 requires.
#
# The whole entry is compared, not a version/integrity/tarball subset, because
# the subset misses dependency-edge drift (drift case t3).

# The three guards are the shared predicate's own terms (lib.sh's
# JQ_REGISTRY_ENTRIES): the root entry is keyed by the empty string and
# `assert_resolvable` deliberately skips it, and a `link:`/workspace value is not
# a registry reference. Reducing either of those would compare it to nothing.
.packages |= with_entries(
  if .key != ""
    and (.value | type) == "object"
    and (.value.resolved | type) == "string"
    and (.value.resolved | test("^https?://"; "i"))
  then
    .value.resolved |= (capture($tarball_re) | .t)
  else
    .
  end
)
