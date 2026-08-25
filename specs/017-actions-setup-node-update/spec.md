# Spec: Setup Node Action Update

## Goal

Update the pinned Node setup action while keeping the installable CI workflow template identical to the root workflow.

## Scope

In scope:

- update `actions/setup-node` from v4.4.0 to v7.0.0
- preserve the exact commit pin in root and template CI workflows
- retain the existing Node 20 toolchain and pnpm cache settings
- verify the repository's complete preflight contract

Out of scope:

- changing the project's Node runtime version
- changing package-manager or dependency-install policy

## Acceptance Criteria

- AC-001: The root CI workflow uses the v7.0.0 commit pin.
- AC-002: The CI workflow template uses the same v7.0.0 commit pin.
- AC-003: Node 20 and pnpm cache configuration remain unchanged.
- AC-004: Root/template workflow parity and the complete preflight pass.

## Negative Scenarios

- NS-001: The update must not leave bootstrapped repositories on the previous setup action.
- NS-002: The action must not be referenced by a mutable tag.
