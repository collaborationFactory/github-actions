# SHA Pins — Node 24 Migration (PFM-TASK-7777)

Resolved on 2026-06-05 against the latest releases (re-verified same day; all match the design's expected versions exactly — no drift, no new majors).

Tag type `tag` = annotated tag (dereferenced to commit); `commit` = lightweight tag (SHA used directly).
Every SHA verified via `gh api repos/<owner>/<repo>/commits/<sha>`.

| Action | Version | Commit SHA | Tag type |
|---|---|---|---|
| `actions/checkout` | v6.0.3 | `df4cb1c069e1874edd31b4311f1884172cec0e10` | tag |
| `actions/cache` | v5.0.5 | `27d5ce7f107fe9357f9df03efb73ab90386fccae` | commit |
| `actions/setup-node` | v6.4.0 | `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` | commit |
| `actions/upload-artifact` | v7.0.1 | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | commit |
| `actions/download-artifact` | v8.0.1 | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` | commit |
| `actions/github-script` | v9.0.0 | `3a2844b7e9c422d3c10d287c895573f7108da1b3` | tag |
| `SonarSource/sonarqube-scan-action` | v8.1.0 | `7006c4492b2e0ee0f816d36501671557c97f5995` | commit |

Sanity check passed: `sonarqube-scan-action` SHA equals the pre-resolved value from research.md.
