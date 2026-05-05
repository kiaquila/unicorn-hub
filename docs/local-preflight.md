# Local Preflight

Local preflight prevents avoidable public CI iterations.

## Required Command

Every target repository should expose:

```bash
pnpm run preflight
```

It should run, at minimum:

- repository baseline validation
- feature-memory gate against `origin/main...HEAD`
- formatting check
- lint or static validation
- typecheck if applicable
- build if applicable
- tests
- sanitizer for blueprint/template repositories

Profiles may override the installed control-plane `preflight` script to call target-native checks after Unicorn gates. For example, a Flutter target can keep its existing `make check` and `make test` workflow while still running repository baseline and feature-memory validation first.

## Pre-Push Guard

Optionally install a local hook or agent pre-tool hook that blocks `git push` when product paths changed without a complete feature-memory folder.

The hook is intentionally local and gitignored. It reduces mistakes without becoming repository policy. Repository policy remains in `pr-guard.yml`.

## Emergency Bypass

Bypass local hooks only for true emergencies. The PR guard still enforces the required policy on GitHub.
