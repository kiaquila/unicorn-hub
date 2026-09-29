# Spec: setup-uv 10.2 Update

## Goal

Update the pinned setup-uv action to v10.2.0 while keeping the generated PR Guard workflow, its source template, and workflow tests synchronized.

## Scope

In scope:

- update `astral-sh/setup-uv` from v10.1.0 to v10.2.0
- preserve the immutable commit pin in the root and template PR Guard workflows
- update the workflow test expectation for the new pin
- verify the repository's complete preflight contract

Out of scope:

- changing Python lock policy, workflow triggers, or workflow behavior
- changing any other dependency or GitHub Action

## Acceptance Criteria

- AC-001: Root and template PR Guard workflows use the v10.2.0 setup-uv commit pin.
- AC-002: Workflow tests expect the v10.2.0 immutable pin.
- AC-003: Root/template parity and the complete preflight pass.

## Negative Scenarios

- NS-001: Bootstrapped repositories must not continue receiving the previous setup-uv pin.
- NS-002: The action must not be referenced by a mutable tag.
- NS-003: Existing workflow behavior, triggers, and policy arguments must remain unchanged.
