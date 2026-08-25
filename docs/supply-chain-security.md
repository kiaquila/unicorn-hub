# Supply-Chain Security

The blueprint includes conservative defaults for dependency and workflow safety.

## Package Manager

Use a pinned package manager:

```json
{
  "packageManager": "pnpm@10.34.5"
}
```

Use frozen lockfile installs in CI.

## Minimum Release Age

`pnpm-workspace.yaml` sets:

```yaml
minimumReleaseAge: 10080
```

That is seven days in minutes. It prevents freshly published packages from being installed immediately after release.

## pnpm Install Policy

Both the blueprint and installed workspace template use pnpm 10.34.5 or newer,
which includes the upstream
[request-routing fixes](https://github.com/pnpm/pnpm/security/advisories/GHSA-vx52-2968-3vc6), and
set the following dependency-build policy:

```yaml
minimumReleaseAge: 10080
blockExoticSubdeps: true
trustPolicy: no-downgrade
strictDepBuilds: true
allowBuilds: {}
```

`blockExoticSubdeps` rejects exotic transitive sources, `trustPolicy` prevents a
provenance downgrade, and `strictDepBuilds` makes an unreviewed dependency build
script fail the install. Do not enable `dangerouslyAllowAllBuilds` or fall back
to a global lifecycle-script allowance. Add only exact package versions that
genuinely require installation scripts:

```yaml
allowBuilds:
  "synthetic-native-addon@1.2.3": true
```

The exact-version entry is deliberately visible in review. pnpm documents these
controls in its official [settings reference](https://pnpm.io/settings).

## Frozen Node Installs

`pnpm-lock.yaml` is mandatory. CI runs only:

```bash
pnpm install --frozen-lockfile
```

There is no `--no-frozen-lockfile` fallback. A missing lockfile or a manifest
that no longer matches it fails both CI and the dependency-policy guard.

## Direct Dependency Policy

`scripts/check-dependency-policy.mjs` runs inside the existing `guard` job. It
examines only direct dependency declarations added or changed between the PR
base and head, then:

- accepts registry ranges only when the committed pnpm lock resolves one exact version
- rejects Git, URL, tarball, archive, alias, and local dependency sources
- rejects npm registry overrides other than the official npm registry
- verifies the exact package name, version, and publication time with the official registry
- fails closed with a “not verified” diagnostic when registry evidence is unavailable
- detects non-ASCII/Unicode substitutions and one-edit or adjacent-transposition similarities against a deliberately small protected-name set
- requires exact-version `allowBuilds` approval when registry metadata declares an install lifecycle script

The checker has no popularity database and does not attempt to score package
reputation. Extra names can be protected through
`.unicorn-hub/config.json` (`dependencyPolicy.node.protectedPackageNames`). A
suspicious name can proceed only through a version-scoped exception with a
non-empty reason in the same reviewed configuration:

```json
{
  "dependencyPolicy": {
    "node": {
      "typosquatExceptions": [
        {
          "package": "synthetic-reviewed-name",
          "version": "1.2.3",
          "reason": "Reviewed against the upstream publisher and release record."
        }
      ]
    }
  }
}
```

Before invoking pnpm, the guard also rejects request-routing overrides,
non-official lockfile artifact sources, pnpm policy escape hatches, and YAML
indirection that its deliberately small parser cannot interpret safely. It also
rejects repository `.pnpmfile.cjs`/`.pnpmfile.mjs` hooks and custom `pnpmfile`
or `global-pnpmfile` settings, because those hooks can rewrite manifests during
the real frozen install. pnpm graph-rewrite settings (`overrides`,
`packageExtensions`, and `patchedDependencies`) are likewise rejected in both
`pnpm-workspace.yaml` and package-manifest `pnpm` objects; otherwise a lock-only
change could inject dependencies outside direct-declaration verification.
Package-manifest `pnpm` objects also cannot override the enforced build,
release-age, provenance, or hook policy. These are repository-wide
installation-boundary checks; remote metadata requests remain limited to new
or changed direct dependencies and newly granted `allowBuilds` entries.

## Locked Python Installs

Python rules are enabled by the `python-service` and `telegram-bot` profiles, or
explicitly with `dependencyPolicy.python.enabled`. Other profiles are not
forced to carry Python lock artifacts.

The preferred contract follows the official [uv lock and sync behavior](https://docs.astral.sh/uv/concepts/projects/sync/):

```bash
uv lock --check
uv sync --locked
```

The trusted PR Guard validates the lock with `uv lock --check --no-build`, then
installs only locked dependencies with
`uv sync --locked --no-install-project --no-build`. It does not build or install
the PR-controlled project, so a local PEP 517 backend cannot execute inside the
guard. Before either command, every locked registry must match the official
PyPI index and every locked wheel or source artifact URL must use the exact
`https://files.pythonhosted.org/packages/` distribution host. The profile's
ordinary development install remains `uv sync --locked` so the project itself
is available outside that trusted verification boundary.

If `uv.lock` is not used, the compatible contract is a fully pinned
`requirements.lock` where every direct and transitive requirement has a
`sha256` hash, installed with pip's official [hash-checking mode](https://pip.pypa.io/en/stable/topics/secure-installs/#hash-checking-mode) and binary-only policy:

```bash
python -m pip --isolated install --index-url https://pypi.org/simple --require-hashes --only-binary :all: -r requirements.lock
```

An unpinned `requirements.txt`, a missing hash, a source distribution, a VCS or
local requirement, or an unknown package index is not a safe installation mode.
The PR Guard validates the selected lock contract before performing the locked
sync in the same `guard` job.

## Dependabot Cooldown and Grouping

Dependabot should run weekly. Every configured ecosystem groups `minor` and `patch`
updates in the `minor-and-patch` group.

Semver-aware ecosystems use these cooldowns:

- default: 7 days
- major: 14 days
- minor: 7 days
- patch: 3 days

`github-actions` is the exception: it uses only the seven-day default cooldown and
must not include `semver-*-days` fields. Profiles should include only ecosystems that
match the target repository. JavaScript-oriented profiles use `npm`; Flutter profiles
use `pub`; all profiles can keep `github-actions` for workflow updates.

## GitHub Actions

Third-party actions should be pinned by commit SHA with a trailing `# v<tag>` comment. Official `actions/*` may use pinned major versions or SHA pinning according to the target repository's policy.

## OSV

Run OSV Scanner on:

- pull requests
- pushes to the default branch
- a weekly schedule
- manual dispatch
