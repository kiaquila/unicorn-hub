# Spec: pnpm Setup Action Update

## Goal

Update the pinned pnpm setup action while keeping every installable workflow template identical to its root workflow.

## Scope

In scope:

- update `pnpm/action-setup` from v4 to v6.0.10 in CI and PR Guard
- preserve the exact commit pin in root and template workflows
- verify the repository's complete preflight contract

Out of scope:

- changing the pnpm package-manager version
- changing dependency installation policy or workflow behavior

## Acceptance Criteria

- AC-001: Root CI and PR Guard workflows use the v6.0.10 commit pin.
- AC-002: Both matching workflow templates use the same v6.0.10 commit pin.
- AC-003: Root/template workflow parity and the complete preflight pass.

## Negative Scenarios

- NS-001: The update must not leave bootstrapped repositories on the previous setup action.
- NS-002: The action must not be referenced by a mutable tag.
