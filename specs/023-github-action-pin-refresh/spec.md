# Spec: GitHub Action Pin Refresh

## Goal

Apply the grouped Dependabot action updates while keeping generated workflows, installable templates, and workflow tests synchronized.

## Scope

In scope:

- update `actions/setup-node` from v7.0.0 to v7.1.0
- update both OSV Scanner actions from v2.6.0 to v2.7.0
- update `astral-sh/setup-uv` from v10.2.0 to v10.3.0
- preserve immutable commit pins in root and template workflows
- update matching workflow-test expectations

Out of scope:

- changing workflow behavior, triggers, permissions, gates, or security policy
- changing package-manager or runtime versions

## Acceptance Criteria

- AC-001: Root and template CI workflows use the v7.1.0 `actions/setup-node` commit pin.
- AC-002: Root and template OSV workflows use the v2.7.0 commit pin for both scanner actions.
- AC-003: Root and template PR Guard workflows use the v10.3.0 `setup-uv` commit pin.
- AC-004: Workflow tests expect the updated immutable pins and root/template parity passes.
- AC-005: The complete repository preflight passes.

## Negative Scenarios

- NS-001: The update must not leave installable templates on the previous action versions.
- NS-002: No action may be referenced by a mutable tag.
- NS-003: Existing workflow behavior, triggers, permissions, gates, and policy arguments must remain unchanged.
