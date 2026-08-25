# Plan: pnpm Setup Action Update

## Summary

Mirror Dependabot's root workflow updates into both source templates and validate the full repository contract.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Inspect root CI and PR Guard workflows for the v6.0.10 SHA. |
| AC-002 | Inspect both matching templates for the same SHA. |
| AC-003 | Run `pnpm run preflight`. |

## Risks

- Risk: only one of the two generated workflow pairs is synchronized.
  Mitigation: update both templates and run the existing byte-for-byte parity check through preflight.
