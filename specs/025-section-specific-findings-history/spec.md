# Section-specific findings history

## Goal

Trusted closed-schema findings for the current head survive repeated review requests. A completed clean snapshot clears a prior finding only when that same section has a canonical completion in a strictly later whole-second bucket. Security all-null is not proof that a previous security finding was resolved. Code-only static and formal approvals cannot retire machine findings.

Foreign-head, malformed and duplicate-key historical summaries do not create persistent findings; latest invalid state remains fail-closed.

## Acceptance Criteria

- Prior exact-head security findings block code-only approval and inactive security state.
- Fresh canonical clean security completion clears security history; stale, same-second and invalid timestamps do not.
- Invalid historical metadata cannot create a permanent veto.

A current-head section retains findings even if the other section references an earlier head. Independent historical canonical section resolution survives repeated requests and other-section progress.
