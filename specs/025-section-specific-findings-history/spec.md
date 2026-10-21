# Section-specific findings history

## Goal

Trusted closed-schema findings for the current head survive repeated review requests. A completed clean snapshot clears a prior finding only when that same section has a canonical completion in a strictly later whole-second bucket. Security all-null is not proof that a previous security finding was resolved. Code-only static and formal approvals cannot retire machine findings.

Foreign-head, malformed and duplicate-key historical summaries do not create persistent findings; latest invalid state remains fail-closed.

## Acceptance Criteria

- Prior exact-head security findings block code-only approval and inactive security state.
- Fresh canonical clean security completion clears security history; stale, same-second and invalid timestamps do not.
- Invalid historical metadata cannot create a permanent veto.

A current-head section retains findings even if the other section references an earlier head. Independent historical canonical section resolution survives repeated requests and other-section progress.

Canonical historical completion requires exactly four table columns and the affected row’s exact head; resolved section findings do not inherit an unrelated foreign-head section edit clock.

Protocol uniqueness counts actual HTML markers, so ordinary marker-name prose cannot erase typed findings.

A resolved finding does not erase a later malformed companion observation: completed companion rows must agree with their own typed SHA and clock. A coherent foreign-head companion remains eligible for historical retirement.

Protocol markers indented by four spaces or a tab are Markdown examples without approval or history authority. Foreign-head finding companions require canonical row coherence before an observation can be retired.
