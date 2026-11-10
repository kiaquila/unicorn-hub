# Plan: Native Codex Details Summary

Normalize only the exact outer container now emitted by Codex, then reuse the existing structured-state, canonical-table, completion-clock, help-footer, and finding-history checks.

## Verification

| Criterion | Evidence |
| --- | --- |
| AC-001, AC-002 | Focused native-review tests exercise both accepted containers. |
| AC-003, NS-001, NS-002 | Negative tests cover mismatched status, unknown attributes, extra closings, and hidden P1 prose. |
| AC-004 | Run `pnpm run preflight`, including sanitizer, baseline, workflow sync, syntax, and the full test suite. |

## Risk

HTML normalization can accidentally expand the authority boundary. The implementation recognizes one exact wrapper, removes it before existing semantic checks, and leaves every unknown variant pending.
