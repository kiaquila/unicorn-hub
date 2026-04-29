# SENAR Mapping

SENAR is the supervised verification layer for Unicorn Hub. The blueprint keeps
the existing spec-first, PR-only workflow and makes the human/AI contract more
explicit.

## Mapping

| SENAR practice | Unicorn Hub artifact |
| --- | --- |
| Task before code | `specs/<feature-id>/spec.md` and `plan.md` before implementation |
| Scope boundaries | one worktree, one branch, one PR, plus `spec.md` scope |
| Acceptance criteria | `spec.md` acceptance scenarios and success criteria |
| Negative scenario | `spec.md` negative scenarios |
| Evidence-based verification | `plan.md` verification matrix, PR checklist, preflight, CI, PR Guard, AI Review |
| Process memory | `tasks.md` dead ends, decisions, and known issues |
| Human supervision | final merge authority and trusted human-triggered native AI review |

## Completion Signal

A PR is merge-ready only when:

- every acceptance criterion has evidence in the PR, plan, or linked checks
- at least one negative scenario is covered or explicitly waived
- process memory is current
- local preflight and required GitHub checks are green
- blocking review findings and conversations are resolved
- a human accepts any remaining known issue before merge

## Team Mode

Solo-owner repositories may keep zero required human approvals when branch
protection still requires checks, AI review evidence, and conversation
resolution. Team repositories should apply branch protection with at least one
human approval, for example `--approvals 1`.
