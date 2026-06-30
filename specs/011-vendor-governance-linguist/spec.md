# Spec: Vendor Governance Envelope For Linguist

## Goal

Stop the Unicorn Hub governance envelope from skewing the GitHub Linguist language statistics of consumer repositories by shipping a managed `.gitattributes` block that marks the installed scaffolding (`scripts/*.mjs`, `.unicorn-hub/**`, `.specify/**`) as `linguist-vendored`, installed idempotently and without clobbering a consumer's own `.gitattributes`.

## Scope

In scope:

- a source-of-truth `templates/.gitattributes` managed block that vendors the copied governance paths
- bootstrap logic that creates or appends the managed block idempotently and preserves existing consumer `.gitattributes` rules
- tests proving the block is installed, that `git check-attr` reports the envelope as vendored and product code as unspecified, and that a pre-existing `.gitattributes` is merged not overwritten
- documentation updates noting the envelope is vendored and excluded from the consumer language bar

Out of scope:

- editing, deleting, or rewriting the governance scripts themselves (they remain CI dependencies)
- marking product code, durable project docs, or consumer-authored files as vendored
- changing GitHub review backends, branch protection, or CI semantics

## User Stories

### US1: Honest Language Bar Downstream

As the owner of a Python service that adopted Unicorn Hub, I want the blueprint's Node `*.mjs` automation excluded from my repository's language statistics so that GitHub does not report a large fake JavaScript share.

### US2: Non-Destructive Install

As a consumer who already maintains a `.gitattributes`, I want bootstrap to append its governance rules without overwriting my existing entries so that my own attributes keep working.

### US3: Verifiable Exclusion

As a maintainer, I want to confirm with `git check-attr` that the scaffolding is vendored while product code is not so that I can trust the exclusion is correct.

## Acceptance Criteria

- AC-001: Bootstrap installs a `.gitattributes` containing a managed block that marks `scripts/*.mjs`, `.unicorn-hub/**`, and `.specify/**` as `linguist-vendored`.
- AC-002: For a bootstrapped target, `git check-attr linguist-vendored` reports `set` for the governance paths and `unspecified` for product code such as `src/*.py` and `app/*.ts`.
- AC-003: When the target already has a `.gitattributes`, bootstrap appends the managed block after the existing content and preserves the consumer's rules verbatim.
- AC-004: Re-running bootstrap is idempotent: the managed marker is detected and the block is neither duplicated nor rewritten.
- AC-005: Documentation states that the governance envelope is marked vendored and is excluded from the consumer's GitHub language statistics.

## Negative Scenarios

- NS-001: The change must not mark product code or consumer-authored project docs as vendored.
- NS-002: The change must not overwrite or discard a consumer's pre-existing `.gitattributes` entries.
- NS-003: The change must not edit, remove, or rewrite the governance scripts that CI depends on.
- NS-004: The change must not add private URLs, source-project residue, secrets, production IDs, or personal paths.

## Requirements

- FR-001: Add `templates/.gitattributes` as the managed-block source of truth with a stable begin/end marker.
- FR-002: Make `scripts/bootstrap-repo.mjs` merge `.gitattributes` idempotently (create when missing, append when the marker is absent, skip when present) instead of copying it through the skip-if-exists template path.
- FR-003: Add tests for installation, `git check-attr` outcomes, consumer-merge preservation, and idempotent re-run.
- FR-004: Update README, bootstrap flow, and portability docs to record the vendored governance envelope.

## Success Criteria

- SC-001: `pnpm run preflight` passes.
- SC-002: A synthetic bootstrapped target reports the governance envelope as `linguist-vendored: set` and product code as `unspecified`.
- SC-003: A pre-existing consumer `.gitattributes` is preserved and the managed block appears exactly once after re-running bootstrap.

## Assumptions

- GitHub Linguist honours `.gitattributes` in every clone, so distributing markings through bootstrap is sufficient.
- The governance scripts all land flat in `scripts/` as `*.mjs`, so `scripts/*.mjs` is a precise, product-safe glob.
- `.unicorn-hub/**` and `.specify/**` contain only governance scaffolding, never consumer product code.
