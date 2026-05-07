# Plan: Onboarding Activation Flow

## Summary

Close the gap between "install the blueprint" and "start building with it" by making the public quickstart self-contained, surfacing the documentation interview, and teaching bootstrap to print concrete next steps.

## Technical Context

- runtime: Node.js 20 for bootstrap and validation scripts.
- dependencies: no new runtime dependencies.
- product paths: `README.md`, `docs/`, `templates/`, `scripts/bootstrap-repo.mjs`, `tests/bootstrap.test.mjs`, and `specs/`.
- data changes: documentation and test-only assertions; no schema or workflow changes.

## Scope Boundaries

- in scope: onboarding copy, installed template guidance, bootstrap terminal output, and synthetic test coverage.
- out of scope: changes to PR guard behavior, AI review policy, branch protection settings, or spec template structure.

## Constitution Check

- Spec-first: this feature folder records goal, scope, acceptance criteria, negative scenarios, verification evidence, and process memory before product edits.
- Testable boundaries: bootstrap output and installed template guidance are covered by `tests/bootstrap.test.mjs`.
- PR-only: changes are prepared on a feature branch for pull request review.
- Simplicity: wording changes reuse existing files and the existing `CREATE-DOCS.md` protocol instead of adding a new onboarding system.
- Portability: all examples stay generic and avoid secrets, private paths, and source-project residue.

## Complexity Tracking

This change adds no new abstraction. The only behavior change is replacing the final bootstrap message with a short ordered next-step block. That keeps the runtime path simple while making the installed experience less ambiguous.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Root `README.md` quickstart names `https://github.com/kiaquila/unicorn-hub`, includes a `git clone` example, and clarifies that `--source` only accepts a local filesystem path. |
| AC-002 | Root `README.md` keeps explicit `--source /path/to/unicorn-hub` bootstrap usage. |
| AC-003 | `tests/bootstrap.test.mjs` parses the `Next:` block from bootstrap output and asserts the four numbered steps name `CREATE-DOCS.md`, `docs_project`, `specs/<feature-id>`, and `preflight`. A dry-run test confirms bootstrap announces a dry run instead, and an idempotent re-run test confirms the message switches to "no new files were written". |
| AC-004 | `tests/bootstrap.test.mjs` asserts installed `README.md`, `AGENTS.md`, `CLAUDE.md`, and `docs_project/README.md` include first-setup guidance, and `tests/sanitizer.test.mjs` asserts the canonical hub owner name does not appear in `templates/`. |
| AC-005 | `pnpm run preflight` passes locally before publication. |

Negative scenario evidence:

- README and installed docs phrase the docs step as create or refresh/review, so documented projects are not told to duplicate their docs.
- Local `--source` examples remain available when GitHub access is unavailable.

## Risks

- More README text could make the quickstart feel heavy. Mitigation: split by use case and keep each prompt short.
- Agents may still skip first-setup docs if users ask for immediate implementation. Mitigation: installed `AGENTS.md` and `CLAUDE.md` make placeholder docs a pre-code signal.
