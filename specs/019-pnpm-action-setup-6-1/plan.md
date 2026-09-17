# Plan: pnpm Setup Action 6.1 Update

## Summary

Mirror Dependabot's root workflow updates into both source templates, update the corresponding test expectation, and validate the full repository contract.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Inspect root CI and PR Guard workflows for the v6.1.0 SHA. |
| AC-002 | Inspect both matching templates for the same SHA. |
| AC-003 | Run the workflow test through the complete preflight. |
| AC-004 | Run `pnpm run preflight`. |

## Risks

- Risk: only one generated workflow pair is synchronized.
  Mitigation: update both templates and run the existing byte-for-byte parity check through preflight.
- Risk: the pin changes but the configured pnpm runtime changes unintentionally.
  Mitigation: limit the diff to action pins, their test expectation, and feature memory.
