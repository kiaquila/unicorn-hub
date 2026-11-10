# Spec: setup-uv 10.3.3 Update

## Goal

Update the setup-uv action from v10.3.2 to v10.3.3 in both the generated PR Guard workflow and its installable template.

## Scope

Refresh the immutable action pin and matching workflow-test expectation. Workflow triggers, permissions, policy, and runtime versions remain outside this change.

## Acceptance Criteria

- AC-001: Root and template PR Guard workflows use the v10.3.3 immutable commit pin.
- AC-002: Workflow parity and the matching pin assertion pass.
- AC-003: The complete repository preflight passes.

## Negative Scenarios

- NS-001: Installable templates must not retain the previous setup-uv version.
- NS-002: No mutable action reference or unrelated workflow behavior change is introduced.
