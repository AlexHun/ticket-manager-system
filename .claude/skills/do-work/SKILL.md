---
name: do-work
description: Execute a unit of work end-to-end: plan, implement, validate with typecheck and tests, then commit. Use when user wants to do work, build a feature, fix a bug, or implement a phase from a plan.
---

# Do Work

Execute a complete unit of work: plan it, build it, validate it, commit it.

## 1. Understand the task

Read any referenced plan or PRD. Explore the codebase to understand the relevant files, patterns, and conventions. If the task is ambiguous, ask the user to clarify scope before proceeding.

## 2. Plan the implementation (optional)

if the task has not already beed planned, create a plan for it.

## 3. Implement

**For backend code**: use red/green/refactor, one test at a time in a tracer-bullet style.

1. Write a single failing test for the smallest vertical slice of behavior
2. Run the test - confirm it fails (red)
3. Write the minimum code to make it pass (green)
4. Repeat from step 1 for the next slice of behavior
5. Refactor if needed while keeping tests green

Each test should target one thin vertical slice through the system. Do not write all tests upfront - write one, make it pass, then move to the next.

**For frontend code**: implement directly without TDD.

## 4. Validate

Run the feedback loops and fix any issues. Repeat until all are pass cleanly.

```bash
bun run typecheck                     # tsc --noEmit across all four workspaces
bun run --filter @ticket/api test     # bun test (in-process Postgres, not Vitest)
bun run --filter @ticket/web test     # vitest run
```


## 5. Commit

Only once typecheck and both suites are green, commit the work.
