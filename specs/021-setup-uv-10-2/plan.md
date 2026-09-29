# Plan: setup-uv 10.2 Update

## Summary

Mirror Dependabot's root PR Guard update into the source template, update the matching test expectation, and validate the full repository contract.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Inspect both PR Guard workflow copies for the v10.2.0 SHA. |
| AC-002 | Run the workflow tests through the complete preflight. |
| AC-003 | Run `pnpm run preflight`. |

## Risks

- Risk: the generated workflow and installable template drift.
  Mitigation: update the template and run the existing render-equivalence check through preflight.
- Risk: the action pin changes unrelated workflow behavior.
  Mitigation: limit the diff to the immutable pin, matching test expectation, and feature memory.
