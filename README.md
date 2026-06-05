# GitHub actions for collaboration Factory

## Node 24 Compatibility

All reusable FE workflows (`.github/workflows/fe-*.yml`) are Node 24 compatible (GitHub's default
JavaScript action runtime since June 2026).

- All external actions are pinned to commit SHAs (`uses: owner/repo@<sha> # vX.Y.Z`) and unified to
  the latest majors: checkout v6, cache v5, setup-node v6, upload-artifact v7, download-artifact v8,
  github-script v9, sonarqube-scan-action v8.
- Self-hosted runners must run GitHub Actions Runner **>= 2.327.1**.
- `.npmrc` provisioning uses the in-repo composite `.github/actions/use-npmrc` (input `dot-npmrc`),
  referenced per release branch like all internal composites.
- `.github/dependabot.yml` keeps the SHA pins current on `master`; release branches are backported
  manually.
