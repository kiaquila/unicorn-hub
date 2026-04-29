# Plan: SENAR Process Layer

## Summary

Add SENAR as a documented verification and memory layer across Unicorn Hub docs, templates, and PR checklist without changing runtime gate behavior.

## Technical Context

- runtime: Node.js ESM scripts remain unchanged
- dependencies: none added
- product paths: `docs/`, `templates/`, `.github/`, `specs/`, `tests/`
- data changes: none

## Scope Boundaries

- in scope: docs, markdown templates, bootstrap test assertions
- out of scope: workflow logic, AI review parsing, branch protection defaults

## Constitution Check

- Spec-first: this folder defines the change before publishing the PR.
- Testable boundaries: bootstrap test checks that installed targets receive SENAR templates.
- PR-only: changes will land through a feature branch and PR.
- Simplicity: implementation is markdown/template-only plus focused test assertions.
- Deployability: no runtime or workflow behavior changes.

## Complexity Tracking

No new abstraction is introduced. The SENAR layer is represented as explicit fields in existing feature-memory and PR templates.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | `docs/senar-mapping.md` documents the mapping. |
| AC-002 | `.specify` templates include goal, scope, negative scenarios, verification evidence, and process memory. |
| AC-003 | `templates/AGENTS.md`, `templates/CLAUDE.md`, and devops docs include evidence and process-memory expectations. |
| AC-004 | `.github/pull_request_template.md` and `templates/.github/pull_request_template.md` include a SENAR Done Gate. |
| AC-005 | `pnpm run preflight` passes. |

Negative scenario evidence:

- No package or workflow files need dependency/runtime changes.
- GitHub Actions workflow files keep the same gate behavior.

## Risks

- Risk: The SENAR checklist could feel like process noise if too large.
  Mitigation: Keep it to a short done gate and reuse existing `spec.md`, `plan.md`, and `tasks.md`.
