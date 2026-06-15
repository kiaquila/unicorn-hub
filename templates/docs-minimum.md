# Docs Minimum: First Feature Context

Use this path to create the smallest durable context that can safely unblock the first feature.

## Ask

1. What is the project name and one-sentence purpose?
2. Who is the primary user?
3. What stack, package manager, and local commands should agents use?
4. Which paths contain product code?
5. What is the first feature or fix, and what result should prove it works?

## Write

- `docs_project/project-idea.md`: purpose, audience, core value, current unknowns
- one stack doc under `docs_project/project/` only if it is relevant now
- `docs_project/README.md`: concise index of existing durable docs
- `specs/<feature-id>/spec.md`: goal, scope, acceptance criteria, negative scenario
- `specs/<feature-id>/plan.md`: approach and verification evidence plan
- `specs/<feature-id>/tasks.md`: implementation tasks and process memory

## Stop

After the minimum path, stop and hand off to implementation. Defer market research, full screen maps, broad feature inventories, and deep architecture docs until a task needs them or the user asks for full discovery.
