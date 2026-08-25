# AI PR Workflow

The active required-check list is `.unicorn-hub/config.json` (`requiredChecks`); installed defaults reflect the active profile. Profiles that install OSV include `osv-scan`. Stack-specific profiles that preserve existing target CI ship `guard`, `osv-scan`, and `AI Review`, and expect the team to add the repository's real CI job names before applying branch protection.

`node scripts/publish-branch.mjs` opens PRs ready for review by default. Pass
`--draft` only when the author explicitly wants a draft PR.

PRs are merge-ready only when all checks are green, blocking findings are resolved, docs/specs are updated, and no conflicts remain.

The existing `guard` context also runs `scripts/check-dependency-policy.mjs`.
Changed direct dependencies must resolve through a current pnpm lock and verify
against the official registry; exotic sources, unreviewed similar/Unicode names,
and undeclared install scripts fail closed. Python-enabled profiles must use a
current `uv.lock` or a fully pinned hashed requirements lock. Narrow reviewed
exceptions belong in `.unicorn-hub/config.json` so their version and reason are
visible in the PR diff.

`AI Review` is a required check and is event-driven. It fails quickly when a
trusted current-head review request or review evidence is missing. A trusted
human review trigger records the current head SHA, then review-result events
rerun the check natively until acceptable current-head evidence appears.

Before merge, the author should also confirm the SENAR done gate:

- every acceptance criterion has evidence in the PR, plan, or linked checks
- the negative scenario is covered or explicitly waived
- process memory records dead ends, decisions, and known issues
- any remaining known issue is accepted by the human merge owner

## First Security Activation

Ordinary bootstrap and file copying do not change GitHub. After the installed
workflows are merged and have produced checks on the default branch, run from a
trusted checkout:

```bash
node scripts/apply-security-settings.mjs --dry-run
node scripts/apply-security-settings.mjs --apply
```

The apply command must finish mandatory security settings before it attempts
branch protection. Branch protection is refused if any context named in
`.unicorn-hub/config.json` has not appeared in recent repository runs after the
workflow definitions reached the default branch. PR-only checks are discovered
from their recent pull-request runs. Consumer-owned PR-only checks must also set
`requiredCheckEvidence.<context>` with the workflow path and `"mode":
"pull-request"`; unmapped consumer checks are proven on the default-branch head.

## Incident Response Checklist

Keep the first response short and ordered:

1. Stop the reinfection mechanism before restoring systems or credentials.
2. Revoke and reissue every secret available to the affected environment.
3. Check GitHub credentials, package/container registry credentials, SSH keys,
   and third-party integration tokens for exposure and unauthorized use.
4. Restore only from a backup whose integrity and pre-incident date were
   verified.
5. Maintain several backup generations and keep at least one immutable copy so
   the same compromise cannot rewrite every recovery point.
