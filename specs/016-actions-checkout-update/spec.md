# Spec: Checkout Action Update

## Goal

Update the pinned checkout action while keeping every installable workflow template identical to its root workflow.

## Scope

In scope:

- update `actions/checkout` from v4.3.1 to v7.0.1 in all six workflows
- preserve the exact commit pin in root and template workflows
- correct the inline version annotation to v7.0.1
- verify the repository's complete preflight contract

Out of scope:

- changing checkout inputs, permissions, or fetch behavior
- changing any application dependency

## Acceptance Criteria

- AC-001: All root workflows use the v7.0.1 commit pin and accurate version annotation.
- AC-002: All matching workflow templates use the same pin and annotation.
- AC-003: Root/template workflow parity and the complete preflight pass.

## Negative Scenarios

- NS-001: The update must not leave bootstrapped repositories on the previous checkout action.
- NS-002: The action must not be referenced by a mutable tag.
