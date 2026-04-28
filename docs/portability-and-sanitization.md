# Portability And Sanitization

This repository must remain a distilled practice blueprint, not an archive of any source project.

## Portability Rules

- Use placeholders for project names, owners, repositories, domains, cloud resources, and deploy targets.
- Do not mention private source repositories as dependencies.
- Do not include real product specs from source projects.
- Keep examples synthetic.
- Keep scripts configurable through `.unicorn-hub/config.json`.

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
