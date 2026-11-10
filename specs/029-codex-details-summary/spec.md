# Spec: Native Codex Details Summary

## Goal

Accept the current native Codex structured-summary container without weakening the existing fail-closed review contract.

## Scope

Normalize the exact observed collapsed details wrapper into the existing canonical summary representation, preserve machine-state and visible-table validation, add regression coverage, and document the accepted presentation.

## Acceptance Criteria

- AC-001: A current-head, completed, finding-free structured summary inside the exact native details wrapper passes.
- AC-002: The original heading presentation continues to pass unchanged.
- AC-003: Wrapper/state mismatches, unknown wrapper attributes, extra closings, and hidden findings do not pass.
- AC-004: The complete repository preflight passes.

## Negative Scenarios

- NS-001: Collapsed HTML must not hide findings or supply a forged completion clock.
- NS-002: Unknown native presentation remains pending rather than becoming trusted evidence.
