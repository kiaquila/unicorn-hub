# AI PR Workflow

Required checks:

- `baseline-checks`
- `guard`
- `AI Review`

PRs are merge-ready only when all checks are green, blocking findings are resolved, docs/specs are updated, and no conflicts remain.

Before merge, the author should also confirm the SENAR done gate:

- every acceptance criterion has evidence in the PR, plan, or linked checks
- the negative scenario is covered or explicitly waived
- process memory records dead ends, decisions, and known issues
- any remaining known issue is accepted by the human merge owner
