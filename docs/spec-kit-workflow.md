# Spec-Kit Workflow

This blueprint follows a spec-first development cycle compatible with spec-kit style repositories.

## Canonical Cycle

```text
constitution -> specify -> clarify -> plan -> tasks -> analyze -> implement
```

## Constitution

`.specify/memory/constitution.md` is the highest-priority process document. It should define:

- spec-first requirements
- test policy
- PR-only workflow
- one worktree per task
- deployability contract
- simplicity and complexity tracking
- documentation sync rules
- review gate expectations

If another document conflicts with the constitution, update the lower-priority document.

## Feature Folder

Every product-code change must have:

- `spec.md`: goal, scope, user stories, acceptance scenarios, negative scenario, requirements, assumptions
- `plan.md`: implementation approach, risks, complexity tracking, verification evidence
- `tasks.md`: atomic tasks plus process memory for decisions, dead ends, and known issues

## SENAR Contract

Unicorn Hub treats SENAR as the supervised verification layer on top of the
spec-kit flow:

- goal and scope are written before product code changes
- every feature has at least one negative scenario or an explicit reason why none applies
- acceptance criteria are verified with evidence, not just an AI-written summary
- process memory records dead ends, decisions, and known issues before merge
- a human remains responsible for accepting unresolved risks and triggering native AI review when required

## Clarification Discipline

`[NEEDS CLARIFICATION]` is allowed during discovery and planning. It should not survive into implementation unless the risk is explicitly accepted in `plan.md`.

## Complexity Tracking

Any new abstraction, framework, service, or cross-cutting convention should explain:

- the current pain it solves
- why simpler code is insufficient today
- what will verify the decision

This prevents agents from adding architecture for hypothetical future consumers.
