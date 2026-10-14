---
name: implement
description: 'Implement one GitHub issue end-to-end in this repo — branch, test-first build, two-axis review, PR, green CI. Use when the user says implement, build, take or do issue/ticket #N, or "the next ticket", or when an orchestrator hands over a ticket.'
---

# Implement

One ticket, from issue to a PR that is green in CI. Adapted from
`mattpocock-skills:implement`, a local copy so the agent and other skills can
invoke it.

## Steps

1. **Read the ticket.** `gh issue view <n> --json number,title,body,labels,comments`,
   and state its title before going further; if the reference is ambiguous,
   ask. If the body is empty or a literal `@-`, the spec was written up before
   the issue was filed: grep
   `docs/adr/`, then `docs/plans/` and `docs/prd/`, for `#<n>`. Check its
   **Blocked by** list: an open blocker means stop and tell the user.
2. **Branch** `<type>/<n>-<slug>` from a freshly fetched `origin/develop`.
   `bun run tokens` joins transcripts to issues through that branch name, so
   the number in it makes the ticket measurable. When a branch for `#<n>`
   already exists, locally or on origin, or the issue carries `Progress:`
   comments, an earlier session stopped mid-ticket: check that branch out,
   carrying any uncommitted files it left in the working tree, and resume at
   the step its last `Progress:` comment names, or at step 3 when there is
   none. Read what is already there against the ticket before adding to it.
3. **Load the standards.** Call the Skill tool with `coding-standards` and read
   every row the ticket touches.
4. **Build test-first.** Call the Skill tool with `mattpocock-skills:tdd` and
   work at the seams the ticket or its plan names. Run typecheck and the single
   test file as you go; run `bun run typecheck` and both suites once at the end.
   Commit each slice once its test is green, after the self-check in
   CLAUDE.md, and push it: a feature branch runs no CI, and a pushed commit
   survives a session that stops on a usage limit, where staged work survives
   only on this machine. After the first push, comment
   `Progress: building, next is the next slice (step 4)`.
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
6. **Commit** after the self-check in CLAUDE.md, push, and leave the
   checkpoint on the issue:
   `gh issue comment <n> --body "Progress: built, next is review (step 7)"`.
7. **Review.** Call the Skill tool with `mattpocock-skills:code-review` against
   `origin/develop`. Its two axes run as background subagents whatever that
   skill asks, and a background report reaches a subagent only between its
   own tool calls: a worker that ends its turn to wait never hears back
   (#523). While the axes are out, run CLAUDE.md's self-check over the whole
   branch diff and write the PR body to the scratchpad. Then, when this
   session is itself a subagent, keep the turn open with foreground
   `Start-Sleep -Seconds 30` calls through PowerShell until both reports are
   in. Hold every finding until both axes have reported, and
   state a review's result only from its report. Run an axis still silent
   after 15 minutes inline instead. Fix every finding, or write down why one
   stands, and update the PR body with each finding and how it was settled.
   Push, and comment `Progress: reviewed, next is ship (step 8)`. Done when
   both axes' results are in hand, every finding is fixed or answered in the
   PR body, and the fixes are pushed.
8. **Ship.** Open a PR into `develop` from the body written in step 7, which
   says `Closes #<n>`, and take it to green in CI as CLAUDE.md's Workflow
   describes.

Done when the PR is open, closes the issue, and every CI job is green. Report
it and stop: the next ticket starts in a fresh session.
