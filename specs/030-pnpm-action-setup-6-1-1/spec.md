# Spec: pnpm Setup Action 6.1.1 Update

## Goal

Update the pinned pnpm setup action from v6.1.0 to v6.1.1 while keeping generated workflows, installable templates, and workflow tests synchronized.

## Scope

In scope:

- update `pnpm/action-setup` in CI and PR Guard to the immutable v6.1.1 commit pin
- mirror the pin in both installable workflow templates
- update the workflow test expectation
- verify the complete repository preflight contract

Out of scope:

- changing the pnpm runtime version
- changing dependency-install policy, workflow triggers, or permissions

## Acceptance Criteria

- AC-001: Root CI and PR Guard workflows use the v6.1.1 immutable commit pin.
- AC-002: Both matching workflow templates use the same pin.
- AC-003: Workflow parity and the explicit pin assertion pass.
- AC-004: The complete repository preflight passes.

## Negative Scenarios

- NS-001: Bootstrapped repositories must not retain the v6.1.0 action pin.
- NS-002: No mutable action reference or unrelated workflow behavior change is introduced.
