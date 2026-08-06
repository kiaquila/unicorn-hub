# AI PR Workflow

The active required-check list is `.unicorn-hub/config.json` (`requiredChecks`); installed defaults reflect the active profile. Stack-specific profiles that preserve existing target CI ship only `guard` and `AI Review` and expect the team to add the repository's real CI job names before applying branch protection.

`node scripts/publish-branch.mjs` opens PRs ready for review by default. Pass
`--draft` only when the author explicitly wants a draft PR.

PRs are merge-ready only when all checks are green, blocking findings are resolved, docs/specs are updated, and no conflicts remain.

`AI Review` is a required check and is event-driven. It fails quickly when a
trusted current-head review request or review evidence is missing. A trusted
human review trigger records the current head SHA, then review-result events
rerun the check natively until acceptable current-head evidence appears.

Before merge, the author should also confirm the SENAR done gate:

- every acceptance criterion has evidence in the PR, plan, or linked checks
- the negative scenario is covered or explicitly waived
- process memory records dead ends, decisions, and known issues
- any remaining known issue is accepted by the human merge owner
