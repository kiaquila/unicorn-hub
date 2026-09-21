# Plan: GitHub Action Pin Refresh

## Summary

Mirror Dependabot's root workflow updates into the source templates, update the corresponding test expectations, and validate the full repository contract.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Inspect both OSV workflow copies for the v2.6.0 SHA. |
| AC-002 | Inspect both PR Guard workflow copies for the v10.1.0 SHA. |
| AC-003 | Run the workflow tests through the complete preflight. |
| AC-004 | Run `pnpm run preflight`. |

## Risks

- Risk: generated workflows and installable templates drift.
  Mitigation: update the templates and run the existing render-equivalence check through preflight.
- Risk: an action pin changes unrelated workflow behavior.
  Mitigation: limit the diff to immutable pins, matching test expectations, and feature memory.
