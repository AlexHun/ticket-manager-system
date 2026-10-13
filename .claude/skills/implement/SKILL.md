---
name: implement
description: 'Implement one GitHub issue end-to-end in this repo — branch, test-first build, two-axis review, PR, green CI. Use when the user says implement, build, take or do issue/ticket #N, or "the next ticket", or when an orchestrator hands over a ticket.'
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
2. **Branch** `<type>/<n>-<slug>` from a freshly fetched `origin/develop`.
   `bun run tokens` joins transcripts to issues through that branch name, so
   the number in it makes the ticket measurable.
3. **Load the standards.** Call the Skill tool with `coding-standards` and read
   every row the ticket touches.
4. **Build test-first.** Call the Skill tool with `mattpocock-skills:tdd` and
   work at the seams the ticket or its plan names. Run typecheck and the single
   test file as you go; run `bun run typecheck` and both suites once at the end.
5. **Mark the PRD shipped if this is its last ticket.** When the ticket's
   `## Parent` names `docs/prd/<slug>.md` (`to-tickets` writes it) and
   `gh issue list --state open --search "\"docs/prd/<slug>.md\" in:body"`
   returns only this ticket, change that PRD's header to `**Status:** Shipped`
   in this branch. Search the full path, not the bare slug, which other issues
   mention in passing. A ticket with no `## Parent` names no PRD: skip this.
   Then remove every exemption naming the PRD from
   `apps/api/src/doc-citations.test.ts`: a shipped PRD is no longer read, and
   the check fails an exemption for a document it does not read. Skip it, and
   the PRD is citation-checked forever.
6. **Commit** after the self-check in CLAUDE.md.
7. **Review.** Call the Skill tool with `mattpocock-skills:code-review` against
   `origin/develop`. Fix every finding, or write down why one stands.
8. **Ship.** Push, open a PR into `develop` whose body says `Closes #<n>`, and take it to
   green in CI as CLAUDE.md's Workflow describes.

Done when the PR is open, closes the issue, and every CI job is green. Report
it and stop: the next ticket starts in a fresh session.
