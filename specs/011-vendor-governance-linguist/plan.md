# Plan: Vendor Governance Envelope For Linguist

## Summary

Ship a managed `.gitattributes` block as a template, teach bootstrap to merge it idempotently into target repositories without clobbering consumer rules, and add tests plus docs so the governance envelope stays out of consumer language statistics.

## Technical Context

- runtime: Node.js ESM scripts
- dependencies: no new dependencies (git used only by tests for `check-attr` evidence)
- product paths: templates, scripts, tests, docs, specs
- data changes: none

## Scope Boundaries

- in scope: `templates/.gitattributes`, bootstrap merge logic, bootstrap tests, README/bootstrap-flow/portability docs
- out of scope: governance script bodies, AI review workflow semantics, branch protection defaults, durable project-docs vendoring

## Constitution Check

- Spec-first: this feature folder records the change before publish.
- Testable boundaries: Node tests cover installation, `git check-attr` outcomes, consumer merge, and idempotent re-run.
- PR-only: changes are prepared on an isolated feature branch.
- Simplicity: the merge reuses existing fs helpers and a single marker guard; no Markdown/glob parser is added.
- Deployability: preflight remains a local command and target profiles keep their stack-native checks.

## Complexity Tracking

The only new mechanism is a marker-guarded append. The managed block lives in `templates/.gitattributes` and is skipped by the generic template walk (like `.unicorn-hub/config.json`) so it is handled exactly once by a dedicated merge step. The merge does not parse `.gitattributes`; it appends a block when a stable begin marker is absent and skips when present.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Bootstrap test asserts the installed `.gitattributes` contains the managed marker and the three `linguist-vendored` rules. |
| AC-002 | Bootstrap test runs `git init` in the target and asserts `git check-attr linguist-vendored` is `set` for `scripts/*.mjs`, `.unicorn-hub/**`, `.specify/**` and `unspecified` for `src/main.py` and `app/index.ts`; a manual `python-service` run is captured in Process Memory. |
| AC-003 | Merge test seeds a consumer `.gitattributes`, asserts the original rules survive verbatim and ahead of the appended block, and that bootstrap reports a `merge` action. |
| AC-004 | Merge test re-runs bootstrap, asserts a `skip` action, byte-identical output, and a single occurrence of the managed rules. |
| AC-005 | README, `docs/bootstrap-flow.md`, and `docs/portability-and-sanitization.md` state the envelope is vendored and excluded from the consumer language bar. |

Negative scenario evidence:

- The `git check-attr` assertions prove product code (`src`, `app`) stays `unspecified` (NS-001).
- The consumer-merge test proves existing entries are preserved (NS-002).
- The diff touches only `templates/.gitattributes`, bootstrap merge wiring, tests, and docs; no script body changes (NS-003).
- `pnpm run preflight` runs the sanitizer to confirm no private or source-project residue (NS-004).

## Risks

- Risk: A broad glob could vendor consumer files.
  Mitigation: `scripts/*.mjs` matches only the flat governance scripts; `.unicorn-hub/**` and `.specify/**` are governance-only directories.
- Risk: A naive copy would skip or overwrite an existing consumer `.gitattributes`.
  Mitigation: a dedicated marker-guarded merge appends instead of copying through the skip-if-exists template path.
- Risk: Re-running bootstrap could duplicate the block.
  Mitigation: a stable begin marker makes the merge idempotent; tests assert a single occurrence.
