# Reduces a package-lock.json to a registry-independent, comparable form: every
# `resolved` URL is replaced by its bare tarball path. A legitimately rehosted
# entry therefore compares EQUAL, while a changed version, integrity, tarball
# filename or dependency edge does not.
#
# Requires: --arg tarball_re '<regex with a named group `t`>'  (see lib.sh)
#
# This transform is deliberately BLIND to which host an entry was rehosted onto
# - a typo'd proxy repo name and an entry left on npmjs both survive it. That
# blindness is exactly why check-lockfile.sh runs a second, independent prefix
# assertion; the two together are what design.md Dimension 2 requires.
#
# The whole entry is compared, not a version/integrity/tarball subset, because
# the subset misses dependency-edge drift (drift case t3).

.packages |= with_entries(
  if (.value | type) == "object" and (.value.resolved | type) == "string" then
    .value.resolved |= (capture($tarball_re) | .t)
  else
    .
  end
)
