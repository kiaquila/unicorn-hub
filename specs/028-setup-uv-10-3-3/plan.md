# Plan: setup-uv 10.3.3 Update

Synchronize Dependabot's root workflow update into its template and workflow test, then validate the existing contracts.

## Verification

| Criterion | Evidence |
| --- | --- |
| AC-001, NS-001, NS-002 | Inspect the root/template diff for the same immutable v10.3.3 pin and unchanged workflow behavior. |
| AC-002 | Run `node --test tests/workflows.test.mjs`, including workflow parity and the explicit action-pin assertion. |
| AC-003 | Run `pnpm run preflight`, including sanitizer, baseline, and full test suite. |

## Risk

Generated workflows can drift from installable templates. The existing render-equivalence test rejects this regression.
