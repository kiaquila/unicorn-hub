# Supply-Chain Security

The blueprint includes conservative defaults for dependency and workflow safety.

## Package Manager

Use a pinned package manager:

```json
{
  "packageManager": "pnpm@10.33.0"
}
```

Use frozen lockfile installs in CI.

## Minimum Release Age

`pnpm-workspace.yaml` sets:

```yaml
minimumReleaseAge: 10080
```

That is seven days in minutes. It prevents freshly published packages from being installed immediately after release.

## Dependabot Cooldown

Dependabot should run weekly with cooldown:

- default: 7 days
- major: 14 days
- minor: 7 days
- patch: 3 days

## GitHub Actions

Third-party actions should be pinned by commit SHA with a trailing `# v<tag>` comment. Official `actions/*` may use pinned major versions or SHA pinning according to the target repository's policy.

## OSV

Run OSV Scanner on:

- pull requests
- pushes to the default branch
- a weekly schedule
- manual dispatch
