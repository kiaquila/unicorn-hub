# Section-specific findings history

## Goal

Retain typed findings across repeated requests while accepting only bounded observed native completion proof.

## Acceptance criteria

Trusted closed-schema current-head findings survive repeated requests. Each section requires its own strictly newer canonical clean completion to clear its history. Inactive security state, a code-only receipt, reactions, or a formal approval cannot clear security findings. Invalid own clocks fall back to observation time; own completion cannot predate comment creation or exceed the observed update bucket. Valid carried companion clocks retain their existing independent section semantics.

Completion-clock authority requires the entire native presentation: the exact summary envelope, heading and introduction, the contiguous native table, exactly the expected active rows with matching typed status/SHA/clock, and only the optional exact known Codex help footer. Blank lines inside the table, duplicate or hidden rows, extra protocol, unknown HTML, code examples and arbitrary prose do not provide clocks or clearing authority. Explicit typed negatives survive such unknown presentation at observation time. A fresh canonical same-section completion can recover; English wording and Markdown rendering are never used to decide that an unknown suffix is harmless enough to backdate a finding.

Static no-findings receipts require the exact verdict, one matching reviewed-commit binding and a closed catalog of observed native closings. One exact trailing service-owned View task link and the exact known help footer are supported. Uncatalogued or contradictory suffixes remain pending. The fixture corpus records 19 observed replies with synthetic provenance identifiers; original evidence is kept outside the portable blueprint.

A completed code lifecycle with both finding flags null is not approval. With security inactive, it may accompany an independent trusted strict current-request receipt only when that receipt is unedited and its original creation falls between lifecycle creation and its validated own completion. The three observed native lifecycle pairs and negative mutations are regression fixtures. Active security, mixed flags, stale/edited/out-of-window receipts, unknown presentation, deletions, withdrawal markers and unresolved threads retain their independent blocking semantics.
