# Spec: pnpm Setup Action 6.1 Update

## Goal

Update the pinned pnpm setup action to v6.1.0 while keeping generated workflows, source templates, and workflow tests synchronized.

## Scope

In scope:

- update `pnpm/action-setup` from v6.0.10 to v6.1.0 in CI and PR Guard
- preserve the exact immutable commit pin in root and template workflows
- update the workflow test expectation for the new pin
- verify the repository's complete preflight contract

Out of scope:

- changing the pnpm package-manager version
- changing dependency installation policy or workflow behavior

## Acceptance Criteria

- AC-001: Root CI and PR Guard workflows use the v6.1.0 commit pin.
- AC-002: Both matching workflow templates use the same v6.1.0 commit pin.
- AC-003: The workflow test expects the v6.1.0 commit pin.
- AC-004: Root/template parity and the complete preflight pass.

## Negative Scenarios

- NS-001: The update must not leave bootstrapped repositories on v6.0.10.
- NS-002: The action must not be referenced by a mutable tag.
- NS-003: The configured pnpm runtime version must remain unchanged.
