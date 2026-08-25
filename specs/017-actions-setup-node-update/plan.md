# Plan: Setup Node Action Update

## Summary

Mirror Dependabot's root CI update into the source template and validate that existing toolchain settings and repository gates remain intact.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Inspect `.github/workflows/ci.yml` for the v7.0.0 SHA. |
| AC-002 | Inspect `templates/.github/workflows/ci.yml` for the same SHA. |
| AC-003 | Confirm `node-version: "20"` and `cache: "pnpm"` remain unchanged. |
| AC-004 | Run `pnpm run preflight`. |

## Risks

- Risk: updating the action accidentally changes the project runtime contract.
  Mitigation: preserve the workflow inputs and verify them explicitly.
