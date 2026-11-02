# Native Codex corpus

## Goal
Verify compatibility with all observed native clean replies while preserving fail-closed review gates.

## Scope
Offline response fixtures, adversarial regression tests and durable review documentation. Application behavior and protection settings are unchanged.

## Acceptance Criteria
- All observed full native clean replies pass the existing parser.
- Forged authors, foreign SHA, duplicate proof and appended findings never pass.
- Regression coverage runs through existing CI tasks and native PR review verifies the current head.

## Negative Scenarios
An otherwise clean response gains an unresolved vulnerability or forged footer. It must remain blocked.
