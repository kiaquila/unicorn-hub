# Tasks: Light Agent Context

## Setup

- [x] T001 Refresh GitHub state and branch from current `origin/main`.
- [x] T002 Create feature memory for the lightweight agent-context change.

## Implementation

- [x] T003 Rewrite target `AGENTS.md` and `CLAUDE.md` as compact launch files.
- [x] T004 Replace the mandatory full documentation interview with a minimum/full router.
- [x] T005 Update blueprint docs to describe lazy-loaded durable context.
- [x] T006 Add multi-agent decision guidance.
- [x] T007 Add `scripts/check-context-budget.mjs` and wire it into bootstrap, baseline, preflight, PR Guard, and profiles.

## Verification

- [x] T008 Add and update tests for compact docs and context-budget gates.
- [x] T009 Run `pnpm run preflight`.
- [x] T010 Update this task file with verification outcome.
- [x] T011 Include staged worktree specs in context-budget checks and fail committed-diff checks when refs are unavailable.
- [x] T012 Add regression coverage for staged specs, configured default base branches, and missing committed-diff refs.

## Process Memory

### Dead Ends

- None yet.

### Decisions

- Keep spec-first and docs-first, but make first setup minimum-by-default rather than full-interview-by-default.
- Validate context quality by checking a few required sections instead of rewarding long documentation.
- Keep multi-agent orchestration guidance in docs, not root launch files, so it is loaded only when relevant.
- Run PR Guard context-budget checks against committed diff refs, not only local worktree state.
- Run root preflight context-budget checks in both committed-diff and worktree modes so local verification matches target scripts and PR Guard.
- Treat unavailable committed-diff refs as a failed context-budget check, while still honoring `.unicorn-hub/config.json` `defaultBaseBranch`.

### Known Issues

- The context-budget gate checks section substance heuristically; it is a safety net, not a replacement for review.
- `pnpm run preflight` passed locally after the staged-spec and missing-ref follow-up fixes.
- Codex review found that committed placeholder specs could bypass local worktree mode; PR Guard now runs the context budget against `BASE_REF` and `HEAD_REF`.
- Codex review found that staged placeholder specs and missing committed-diff refs could bypass the local gate; the script now includes staged files and fails closed when diff refs are unavailable.
