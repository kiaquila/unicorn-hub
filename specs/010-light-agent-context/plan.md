# Plan: Light Agent Context

## Summary

Slim the installed agent launch files, split first setup into minimum and full documentation paths, add a context-budget gate, and update tests and docs so the lightweight contract stays enforceable.

## Technical Context

- runtime: Node.js ESM scripts
- dependencies: no new dependencies
- product paths: docs, templates, scripts, profiles, tests, specs
- data changes: none

## Scope Boundaries

- in scope: markdown templates, operator docs, bootstrap copy allowlist, package scripts, local checks, tests
- out of scope: workflow review semantics, branch protection defaults, provider-specific agent APIs

## Constitution Check

- Spec-first: this feature folder records the change before publish.
- Testable boundaries: Node tests cover bootstrap installation and context-budget failure modes.
- PR-only: changes are prepared on an isolated feature branch.
- Simplicity: the new gate uses existing config and Node core modules.
- Deployability: preflight remains a local command and target profiles keep their stack-native checks.

## Complexity Tracking

The only new script is a small validator. It avoids parsing full Markdown ASTs and checks only the sections that the blueprint relies on for safe implementation: `Goal`, `Acceptance Criteria`, and `Verification`.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Bootstrap test asserts compact installed launch files mention `docs-minimum.md` and avoid duplicated role/review contracts. |
| AC-002 | Bootstrap and documentation assertions confirm `CREATE-DOCS.md` defaults to minimum docs and keeps full discovery optional. |
| AC-003 | Baseline and package-script tests confirm `scripts/check-context-budget.mjs` is installed and preflight invokes it. |
| AC-004 | Context-budget tests create synthetic oversized and placeholder-only targets and assert failure. |
| AC-005 | Documentation tests and grep review confirm `docs_project/README.md` is described as a task-scoped index. |
| AC-006 | Multi-agent workflow docs include a decision matrix and a no-parallel-writers rule. |

Negative scenario evidence:

- `pnpm run preflight` covers sanitizer, baseline, feature-memory, context budget, workflow parity, syntax, and tests.
- The sanitizer checks that no private or source-project residue was added.

## Risks

- Risk: A strict line budget could reject useful downstream launch files.
  Mitigation: the script reads `contextBudget.maxAgentLines` from `.unicorn-hub/config.json` when teams need a deliberate exception.
- Risk: Section checks could miss nuanced bad specs.
  Mitigation: the gate checks minimum substance only; review agents and humans still judge correctness.
