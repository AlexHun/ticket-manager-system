---
name: implement
description: Implement one GitHub issue end-to-end in this repo — branch, test-first build, two-axis review, PR, green CI. Use when the user says implement, build, take or do issue/ticket #N, or "the next ticket", or when an orchestrator hands over a ticket.
---

# Implement

One ticket, from issue to a PR that is green in CI. Adapted from
`mattpocock-skills:implement`, a local copy so the agent and other skills can
invoke it.

## Steps

1. **Read the ticket.** `gh issue view <n> --comments`. If the body is empty or
   a literal `@-`, the spec was written up before the issue was filed: grep
   `docs/adr/`, then `docs/plans/` and `docs/prd/`, for `#<n>`. Check its
   **Blocked by** list: an open blocker means stop and tell the user.
2. **Branch** `<type>/<n>-<slug>` from a freshly fetched `origin/main`.
   `bun run tokens` joins transcripts to issues through that branch name, so
   the number in it makes the ticket measurable.
3. **Load the standards.** Call the Skill tool with `coding-standards` and read
   every row the ticket touches.
4. **Build test-first.** Call the Skill tool with `mattpocock-skills:tdd` and
   work at the seams the ticket or its plan names. Run typecheck and the single
   test file as you go; run `bun run typecheck` and both suites once at the end.
5. **Commit** after the self-check in CLAUDE.md.
6. **Review.** Call the Skill tool with `mattpocock-skills:code-review` against
   `origin/main`. Fix every finding, or write down why one stands.
7. **Ship.** Push, open a PR whose body says `Closes #<n>`, and take it to
   green in CI as CLAUDE.md's Workflow describes.

Done when the PR is open, closes the issue, and every CI job is green. Report
it and stop: the next ticket starts in a fresh session.
