# Spec: OSV Scanner Action Update

## Goal

Update the pinned OSV Scanner action while keeping the installable workflow template identical to the root workflow.

## Scope

In scope:

- update `google/osv-scanner-action/osv-scanner-action` from v2.3.5 to v2.5.1
- preserve the exact commit pin in both root and template workflows
- verify the repository's complete preflight contract

Out of scope:

- changing OSV scan arguments or scheduling
- changing any application dependency

## Acceptance Criteria

- AC-001: The root OSV workflow uses the v2.5.1 commit pin.
- AC-002: The OSV workflow template uses the same v2.5.1 commit pin.
- AC-003: Root/template workflow parity and the complete preflight pass.

## Negative Scenarios

- NS-001: The update must not leave bootstrapped repositories on the previous scanner version.
- NS-002: The action must not be referenced by a mutable tag.
