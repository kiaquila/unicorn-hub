# Tasks: Light Agent Context

## Setup

- [x] T001 Refresh GitHub state and branch from current `origin/main`.
- [x] T002 Create feature memory for the lightweight agent-context change.

## Implementation

- [x] T003 Rewrite target `AGENTS.md` and `CLAUDE.md` as compact launch files.
- [x] T004 Replace the mandatory full documentation interview with a minimum/full router.
- [x] T005 Update blueprint docs to describe lazy-loaded durable context.
- [x] T006 Add multi-agent decision guidance.
- [x] T007 Add `scripts/check-context-budget.mjs` and wire it into bootstrap, baseline, preflight, and profiles.

## Verification

- [x] T008 Add and update tests for compact docs and context-budget gates.
- [x] T009 Run `pnpm run preflight`.
- [x] T010 Update this task file with verification outcome.

## Process Memory

### Dead Ends

- None yet.

### Decisions

- Keep spec-first and docs-first, but make first setup minimum-by-default rather than full-interview-by-default.
- Validate context quality by checking a few required sections instead of rewarding long documentation.
- Keep multi-agent orchestration guidance in docs, not root launch files, so it is loaded only when relevant.

### Known Issues

- The context-budget gate checks section substance heuristically; it is a safety net, not a replacement for review.
- `pnpm run preflight` passed locally after the context-budget gate was wired into preflight.
