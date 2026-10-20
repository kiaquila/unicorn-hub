# Spec: Machine-authoritative receipt closings

## Goal

Avoid presentation-only native receipt endings blocking independently proven clean reviews. Keep legacy verdict recognition strict and require current-request complete typed machine proof for opaque receipt endings.

## Acceptance criteria

- AC-001: Observed and unseen single-line opaque endings alone cannot approve.
- AC-002: An unknown receipt remains pending until a strictly newer independent trusted complete current-request structured snapshot with explicit false findings flags supersedes it.
- AC-003: Stale SHA, author, request, malformed metadata, security findings, pending state and unresolved findings remain blocking.
- AC-004: Documentation and installed contract explain machine authority without a finite positive phrase expansion.

## Negative scenarios

Contrary findings, additional verdicts, hashes, lines, unknown markers, and null code findings flags cannot independently supply approval or conceal newer incomplete machine state.

Structured withdrawal recovery requires code completion in a strictly later whole-second bucket than the withdrawal; refreshing the summary alone cannot restore approval.

Unknown and negative receipt edits use their observed server update time; only static clean approval retains publication time. An unknown edit blocks older or equal-time code completion.
