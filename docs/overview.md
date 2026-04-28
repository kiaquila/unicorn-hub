# Overview

Unicorn Hub is a portable blueprint for multi-agent development. It packages the reusable parts of a mature agent workflow into a neutral repository that can be installed into a target project by another agent.

The blueprint has four layers:

1. **Project memory**: durable product and architecture documentation.
2. **Feature memory**: spec-driven `spec.md`, `plan.md`, and `tasks.md` folders.
3. **Agent orchestration**: explicit roles for implementation agents, review agents, and humans.
4. **Gates**: local preflight, CI, PR guard, AI review, security scanning, and branch protection.

The result is a repository where agents can work independently without losing context, bypassing review, or turning local assumptions into production changes.

## Design Goals

- Portable across repositories and stacks.
- Safe by default for public and private projects.
- Explicit about what agents read, write, and verify.
- Fail-closed when automation cannot prove a required condition.
- Free of source-project secrets and source-project product details.

## Non-Goals

- Replacing project-specific architecture decisions.
- Providing a universal deployment platform.
- Hiding the need for human final merge authority.
- Auto-triggering AI systems that require human-authored GitHub comments.
