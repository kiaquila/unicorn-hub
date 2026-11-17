# Plan: pnpm Setup Action 6.1.1 Update

Mirror Dependabot's root workflow updates into both source templates, update the matching workflow-test expectation, and validate the repository contract.

## Verification

| Criterion | Evidence |
| --- | --- |
| AC-001, NS-002 | Inspect the root workflow diff for the immutable v6.1.1 pin and otherwise unchanged behavior. |
| AC-002, NS-001 | Run the root/template parity check. |
| AC-003 | Run `node --test tests/workflows.test.mjs`. |
| AC-004 | Run `pnpm run preflight`. |

## Risk

Generated workflows can drift from their installable templates. The existing byte-for-byte parity test rejects that regression.
