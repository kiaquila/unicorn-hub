# Plan: OSV Scanner Action Update

## Summary

Mirror Dependabot's root workflow update into the source template and validate the full repository contract.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Inspect `.github/workflows/osv-scan.yml` for the v2.5.1 SHA. |
| AC-002 | Inspect `templates/.github/workflows/osv-scan.yml` for the same SHA. |
| AC-003 | Run `pnpm run preflight`. |

## Risks

- Risk: root and installed workflows drift.
  Mitigation: preserve byte-for-byte workflow parity and run the existing sync check through preflight.
