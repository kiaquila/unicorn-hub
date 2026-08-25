# Plan: Checkout Action Update

## Summary

Mirror Dependabot's checkout update into all source templates, correct the version annotation, and validate the full repository contract.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Search all root workflows for the v7.0.1 SHA and annotation. |
| AC-002 | Search all templates for the same SHA and annotation. |
| AC-003 | Run `pnpm run preflight`. |

## Risks

- Risk: one of the seven checkout references remains stale.
  Mitigation: search both workflow trees and run the existing byte-for-byte parity check through preflight.
