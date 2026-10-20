# Plan: GitHub Action Pin Refresh

## Summary

Mirror Dependabot's root workflow updates into their source templates, update the corresponding test expectations, and validate the repository contract.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Inspect both CI workflow copies for the v7.1.0 immutable pin. |
| AC-002 | Inspect both OSV workflow copies for the v2.7.0 immutable pin. |
| AC-003 | Inspect both PR Guard workflow copies for the v10.3.0 immutable pin. |
| AC-004 | Run `pnpm run check:workflows` and `node --test tests/workflows.test.mjs`. |
| AC-005 | Run `pnpm run preflight`. |

## Risks

- Risk: generated workflows and installable templates drift.
  Mitigation: update the templates and run the render-equivalence check.
- Risk: an action update changes unrelated workflow behavior.
  Mitigation: limit the diff to immutable pins, matching test expectations, and required feature memory.
