# Plan: Codex Summary Comment Timestamp Binding

## Summary

`isAcceptableCodexSummaryComment` previously required the no-findings comment body to literally contain the head SHA. The live `chatgpt-codex-connector[bot]` Codex Cloud format does not include a SHA, so that path was unsatisfiable and the gate fell through to its 20-minute timeout on every PR. Add a timestamp-binding fallback: accept a trusted `Codex Review: ... did not find any major issues` comment whose `created_at` is at or after the head commit's `committer.date`. Keep the SHA-in-body fast path so future Codex format changes that include the SHA continue to pass without consulting the commit endpoint.

## Technical Context

- Affected scripts: `scripts/ai-review-helpers.mjs`, `scripts/ai-review-gate.mjs`.
- New API call: `GET /repos/{owner}/{repo}/commits/{headSha}` to read `commit.committer.date`. Reused from the existing `request` helper, scoped to the Codex summary-comment fallback only.
- Doc updates: `templates/docs_project/project/devops/review-contract.md` (canonical contract for installed targets) and `docs/github-ci-and-branch-protection.md` (operator-facing fail-closed rules).
- Sanitizer hardening: `scripts/shared.mjs` `walkFiles` ignored set gains `.omc` so local OMC plugin metadata does not break the sanitizer subprocess invoked by `tests/sanitizer.test.mjs`. `.gitignore` mirrors that intent and adds `.codex/`.

## Constitution Check

- Spec-first: this folder lands together with the implementation in the same PR.
- Testable boundaries: `tests/helpers.test.mjs` covers acceptance at the head commit boundary and stale-comment rejection. `pnpm run preflight` is the gate.
- PR-only: all changes ship through the fix branch.
- Simplicity: one helper signature change, one new function in the gate, no new modules. Stale-comment defence is preserved via timestamp comparison rather than the unsatisfiable SHA-in-body requirement.
- Deployability: gate scripts continue to run from the trusted default branch per `ai-review.yml`. No workflow surface changes.

## Complexity Tracking

`headCommittedAt` is added as an explicit positional argument to `isAcceptableCodexSummaryComment`. Existing callers and tests that omit it remain on the SHA-in-body path through the default `null` value, so no other internal call sites need updating.

## Verification

- `pnpm run preflight`
- Re-trigger `AI Review` on the unblocking PR via `gh workflow run ai-review.yml -f pr_number=<PR> -f trigger_mode=skip` after the fix lands on the default branch.

## Risks

- Force-pushing a PR backwards to a commit whose `committer.date` predates an existing stale Codex summary comment would let that stale comment satisfy the new path. Mitigated by the trusted-bot login requirement and the `Codex Review: ... did not find any major issues` body pattern, plus the rarity of intentional backward force-pushes on protected branches. Documented as accepted residual risk in the contract docs.
