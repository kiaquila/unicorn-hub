# Plan: Machine-authoritative receipt closings

## Implementation

Keep the strict legacy parser. Classify narrow exact-clean opaque receipts as pending presentation and supersede them only when a strictly newer independently valid current-request structured snapshot explicitly establishes whole-review success. Preserve whole-review security, withdrawal, findings and timeline rules.

## Verification

Run native parser/evaluator regressions and `pnpm run preflight`; cover strict chronological supersession and equal-time pending precedence, unseen wording, stale request/head/author, malformed receipts and negative machine state. Final results are recorded in tasks.
