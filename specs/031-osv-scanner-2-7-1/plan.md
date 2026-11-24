# Plan: OSV Scanner Actions 2.7.1 Update

Mirror Dependabot's root workflow updates into the source template, update the matching workflow-test expectations, and validate the repository contract.

## Verification

| Criterion | Evidence |
| --- | --- |
| AC-001, NS-002 | Inspect the root workflow diff for immutable v2.7.1 pins and otherwise unchanged behavior. |
| AC-002, NS-001 | Run the root/template parity check. |
| AC-003 | Run `node --test tests/workflows.test.mjs`. |
| AC-004 | Run `pnpm run preflight`. |

## Risk

The generated workflow can drift from its installable template. The existing byte-for-byte parity test rejects that regression.
