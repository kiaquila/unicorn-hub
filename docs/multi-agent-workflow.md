# Multi-Agent Workflow

The blueprint assumes multiple agents may participate, but each PR has clear ownership.

## Roles

**Orchestrator**

- reads repository memory
- slices work into bounded tasks
- assigns one worktree per task
- keeps specs, docs, and PR state aligned
- does not declare completion until the PR is merge-ready

**Implementation Agent**

- writes product code
- works in an isolated worktree and branch
- updates `specs/<feature-id>/tasks.md`
- updates durable docs when behavior or architecture changes
- never merges directly to the default branch

**Review Agent**

- reviews the PR diff for correctness, regressions, contract violations, and missing tests
- does not write new feature code during review
- emits findings in the expected backend format

**Human**

- remains the final merge authority
- triggers review commands when native AI backends require a trusted human comment
- decides whether advisory findings can wait

## Agent Selection

Repository variables control defaults:

```text
AI_IMPLEMENTATION_AGENT=claude
AI_REVIEW_AGENT=codex
```

Supported review backends:

- `codex`: native GitHub PR review with `P0`-`P3` severity markers, or a no-findings `Codex Review:` summary comment bound to a trusted current-head review-request marker
- `claude`: top-level comment with `AI_REVIEW_OUTCOME: pass|advisory|block`
- `gemini`: native GitHub PR review from the configured app

Use `node scripts/set-implementation-agent.mjs --implementation <claude|codex> --review <codex|claude|gemini>` to update repository variables from a trusted local checkout.

## Trusted Actors

Only comments from these GitHub author associations should route AI commands:

- `OWNER`
- `MEMBER`
- `COLLABORATOR`

Untrusted comments must not move review boundaries or satisfy gates.

Trusted review comments create an `AI_REVIEW_REQUEST_ID` marker for the PR head
SHA that was current when the comment was posted. Review evidence for Codex must
be submitted at or after the trusted source trigger time recorded in the marker
and still match the latest GitHub PR head.

Bot-authored comments cannot start the policy workflow, so the administrative
trigger comment that `AI Review` posts in `trigger_mode=comment` does not
recurse. The bot guard lives in both the workflow `if:` and `scripts/ai-command-policy.mjs`.

Downstream repos that bootstrapped before this contract shipped must re-run
`node scripts/bootstrap-repo.mjs --force` (or copy `scripts/ai-command-policy.mjs`
into place) before the new `AI Command Policy` workflow runs successfully.

## Completion Contract

A task is complete only when the current PR head SHA has:

- green required checks
- no blocking review findings
- no unresolved merge conflicts
- updated specs and durable docs where required
- only final human approval or merge mechanics remaining
