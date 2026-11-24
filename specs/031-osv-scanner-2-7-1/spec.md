# Spec: OSV Scanner Actions 2.7.1 Update

## Goal

Update the pinned OSV scanner and reporter actions from v2.7.0 to v2.7.1 while keeping the generated workflow, installable template, and workflow tests synchronized.

## Scope

In scope:

- retain Dependabot's immutable v2.7.1 pins in the root OSV workflow
- mirror both pins in the installable OSV workflow template
- update the workflow test expectations
- verify the complete repository preflight contract

Out of scope:

- changing OSV scan arguments, workflow triggers, permissions, or failure behavior
- changing unrelated GitHub Actions dependencies

## Acceptance Criteria

- AC-001: The root OSV workflow uses immutable v2.7.1 pins for the scanner and reporter actions.
- AC-002: The installable OSV workflow template uses the same pins.
- AC-003: Workflow parity and the explicit pin assertions pass.
- AC-004: The complete repository preflight passes.

## Negative Scenarios

- NS-001: Bootstrapped repositories must not retain either v2.7.0 OSV action pin.
- NS-002: No mutable action reference or unrelated workflow behavior change is introduced.
