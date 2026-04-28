# Tasks: FR-007 Shell Interpolation Cleanup

## Workflow Hardening

- [x] Add `EVENT_NAME` to the `env:` mapping of `Resolve selected review policy` in `templates/.github/workflows/ai-review.yml` and replace `${{ github.event_name }}` in the shell block with `${EVENT_NAME}`.
- [x] Add `EVENT_NAME`, `PR_BASE_SHA`, `PR_HEAD_SHA`, `INPUT_BASE_REF`, `INPUT_HEAD_REF` to the `env:` mapping of `Resolve diff refs` in `templates/.github/workflows/pr-guard.yml` and rewrite the shell block to read those env variables instead of inline `${{ }}` expressions.
- [x] Run `node scripts/sync-workflows.mjs` to regenerate the matching root workflows.

## Verification

- [x] Run `pnpm run preflight`.
