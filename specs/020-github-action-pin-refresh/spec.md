# Spec: GitHub Action Pin Refresh

## Goal

Update the pinned OSV Scanner and setup-uv actions while keeping generated workflows, source templates, and workflow tests synchronized.

## Scope

In scope:

- update both OSV Scanner actions from v2.5.1 to v2.6.0
- update `astral-sh/setup-uv` from v10.0.1 to v10.1.0
- preserve immutable commit pins in root and template workflows
- update the workflow test expectations for the new pins
- verify the repository's complete preflight contract

Out of scope:

- changing scan arguments, Python lock policy, or workflow triggers
- changing any action besides the three Dependabot updates

## Acceptance Criteria

- AC-001: Root and template OSV workflows use the v2.6.0 commit pin for both scanner actions.
- AC-002: Root and template PR Guard workflows use the v10.1.0 setup-uv commit pin.
- AC-003: Workflow tests expect the updated immutable pins.
- AC-004: Root/template parity and the complete preflight pass.

## Negative Scenarios

- NS-001: The update must not leave bootstrapped repositories on the previous action versions.
- NS-002: No action may be referenced by a mutable tag.
- NS-003: Existing workflow behavior, triggers, and policy arguments must remain unchanged.
