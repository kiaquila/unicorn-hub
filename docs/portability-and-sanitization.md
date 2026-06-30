# Portability And Sanitization

This repository must remain a distilled practice blueprint, not an archive of any source project.

## Portability Rules

- Use placeholders for project names, owners, repositories, domains, cloud resources, and deploy targets.
- Do not mention private source repositories as dependencies.
- Do not include real product specs from source projects.
- Keep examples synthetic.
- Keep scripts configurable through `.unicorn-hub/config.json`.

## Language Statistics In Consumer Repositories

Bootstrap installs a managed `.gitattributes` block that marks the governance envelope it copies in — the managed script files copied by bootstrap, `.unicorn-hub/**`, and `.specify/**` — as `linguist-vendored`. GitHub Linguist honours `.gitattributes` in every clone, so this scaffolding (notably the Node `*.mjs` automation) is excluded from the target repository's language bar and does not skew the language mix of, for example, a Python service.

The block is appended idempotently and never overwrites a consumer's existing `.gitattributes`; product code is never marked as vendored. Verify with `git check-attr linguist-vendored -- scripts/ai-review-gate.mjs` (expect `set`) and against a product file such as `scripts/build.mjs` (expect `unspecified`), or run `github-linguist` on the repository.

## Sanitizer Scope

`scripts/sanitize-blueprint.mjs` checks for:

- token-like values
- private key blocks
- cloud resource identifiers
- personal absolute paths
- source-project residue
- private repository URLs
- real deployment domains from source projects

## Final Release Gate

Before opening a PR from this blueprint repository, run:

```bash
pnpm run preflight
```

The PR is not ready if sanitizer findings remain.
