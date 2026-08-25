# Plan: GitHub Security Activation

## Summary

Extend the existing Dependabot renderer and OSV workflow contract, add a small testable GitHub security activation CLI, harden branch-protection application with a required-check preflight, install both scripts through bootstrap, and document the ordered activation and incident-response procedures.

## Technical Context

- runtime: Node.js 20+ ESM and GitHub CLI
- dependencies: Node built-ins only; GitHub REST API through `gh api`
- product paths: templates, root workflows/config, bootstrap and activation scripts, profiles, tests, DevOps docs, feature memory
- remote changes: none during implementation; consumer activation remains an explicit post-merge command

## Scope Boundaries

- in scope: portable configuration, scripts, tests, documentation, and ready PR publication
- out of scope: mutating the live repository security settings or protection before the feature exists on `main`

## Constitution Check

- Spec-first: this feature memory precedes implementation edits.
- Testable boundaries: GitHub CLI calls use an injectable executable path so tests can use a synthetic `gh` fixture.
- PR-only: work remains on `codex/github-security-activation` and publishes a ready PR.
- Fail-closed: mandatory settings and missing required contexts stop activation with nonzero status.
- Explicit authority: local bootstrap never mutates GitHub; activation requires an affirmative flag.

## Implementation Design

1. Normalize profile defaults so installed workflows and required checks stay consistent, and add explicit relevant Dependabot ecosystems to every profile.
2. Preserve the accepted renderer behavior while expanding regression coverage across generic, Node, Flutter, and Python profiles.
3. Configure OSV's action input to fail on vulnerabilities and assert trigger/input parity for root and template workflows.
4. Implement `apply-security-settings.mjs` as a state-driven CLI:
   - discover repo/default branch
   - inspect current repository/vulnerability/security-update state
   - plan mutations in dry-run mode
   - apply mandatory and optional settings individually
   - verify final state and classify unsupported responses conservatively
   - invoke branch protection only after security success and required-check validation
5. Update `apply-branch-protection.mjs` to gather check runs and commit statuses from the default head and recent workflow-run SHAs, fail before PUT when contexts are missing, and support dry-run for tests/preview.
6. Add both scripts to bootstrap/baseline/Linguist managed-file contracts and update activation/incident docs.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001–AC-003 | Synthetic bootstrap matrix and rendered Dependabot assertions for grouping, major exclusion, cooldown, and ecosystem scope. |
| AC-004–AC-005 | Workflow/config parity tests and profile exclusion fixture. |
| AC-006–AC-007 | Synthetic `gh` tests for dry-run, first run, repeat run, unsupported options, postcondition verification, and API errors. |
| AC-008 | Bootstrap file and ordered `Next:` output assertions. |
| AC-009–AC-010 | Branch-protection tests proving checks are queried before PUT and missing contexts block mutation. |
| AC-011 | Documentation content assertions and manual review. |

Negative scenario evidence:

- Run focused security, bootstrap, and workflow tests for NS-001 through NS-007.
- Run `pnpm run preflight` for the complete repository contract.

## Risks

- Risk: GitHub returns similar status codes for unsupported plans and insufficient permissions.
  Mitigation: classify only documented/recognizable feature-unavailability responses as unsupported; treat ambiguous authorization and unexpected failures as errors.
- Risk: one repository PATCH with multiple security keys obscures the failing feature.
  Mitigation: update and verify each feature independently.
- Risk: required check discovery differs between Checks API and legacy commit statuses, and PR-only checks do not run on the default-branch head.
  Mitigation: inspect both APIs across the default head and recent workflow-run SHAs, then compare names exactly.
- Risk: profiles can exclude an installed workflow without updating `requiredChecks`.
  Mitigation: derive required checks from profile declarations plus template exclusions at bootstrap time and cover with a synthetic exclusion profile.
- Risk: activation could appear implicit after ordinary file copy.
  Mitigation: bootstrap prints commands but performs no `gh api` mutation; the activation script requires `--apply`.
