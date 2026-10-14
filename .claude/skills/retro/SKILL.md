---
name: retro
description: 'Run a retrospective on a session or a finished chain, proposing fixes to the agent environment — checks, standards, CLAUDE.md, skills, tooling. Use when the user asks for a retro or retrospective, a post-mortem of a session, or "what should we change" after a chain, a ticket or a stopped run.'
---

# Retro

Find what in the **environment** made a session slower or more error-prone than
it had to be, and propose the fix. The code the session wrote is out of scope;
the files, checks and tools that shaped how it was written are the subject.
Adapted from `mattpocock-skills:retro`, a local copy so the agent and other
skills can invoke it.

## Steps

1. **Load the style guide.** Invoke `mattpocock-skills:writing-for-agents`:
   every fix this skill proposes is a document an agent reads.
2. **Gather the evidence.** The session the user names, else this one. Its
   sources:
   - the conversation in context — for a `/chain`, every worker's `RESULT`
     line, score and CI rounds already sit there;
   - transcripts under `~/.claude/projects/C--Users-GAP-Documents-claude-code-course-project/`:
     `<session-id>.jsonl` per session, and each subagent's under
     `<session-id>/subagents/agent-<id>.jsonl`. A session can leave only
     `agent-<id>.meta.json` files and no `.jsonl` at all, its own included
     (session `6732eb5d`, #522); then the transcript is gone, not stored
     elsewhere, so read the ticket's `Usage:` comment (`chain` step 3 posts
     one per merged ticket) and its `Progress:` comments
     (`gh issue view <n> --comments`), with the in-context record, in its
     place;
   - `bun run tokens`, for what each ticket cost against its forecast;
   - PR review threads and fix commits (`gh pr view <n> --comments`), and
     `~/.claude/stop-failures.jsonl` for stops.

   Transcripts run to megabytes: hand each sweep to a `bulk-reader` subagent
   with an exact output shape (tool calls that failed or repeated, files read
   more than once, review findings and their fix commits), and keep only its
   digest. Done when every worker of the session, and every fix round, has a
   digest, a `Usage:` comment or an in-context record.
3. **Find the candidates**, one category at a time:
   - **Navigation**: time spent finding a file or fact. Is a dependency hidden,
     would a pointer in a standards file, skill or `CLAUDE.md` have saved it?
   - **Automated checks**: a mistake a check could have caught. Read the
     check surface first — the root and workspace `package.json` scripts,
     `.github/workflows/ci.yml`, `.husky/`, `.claude/hooks/` and the hooks in
     `.claude/settings.json` — so a check that exists but sits unwired or silently broken is the
     finding, not a reinvention.
   - **Coding standards**: a mistake the review missed, or a rule that misled.
     Classify it first. A **mechanical** violation (a fixed syntactic pattern,
     a banned API, an import shape, a file location) gets a deterministic
     check — a lint rule, a hook or a CI job, whichever is cheapest here.
     A **judgement call** gets a rule in the narrowest `docs/standards/` file
     the `coding-standards` table routes to, written the way those files are:
     the measured case, then the rule.
   - **CLAUDE.md**: steering that belongs in a standards file, a skill or a
     check, since every line of `CLAUDE.md` loads into every session and every
     worker.
   - **Skills**: a step in `implement`, `chain`, `to-tickets` or another local
     skill that a worker misread, skipped or finished too early — its
     completion criterion is the usual fix.
   - **Tool economy**: expensive calls that could be cheaper — whole-file reads
     where a grep would do, polled commands, work a `bulk-reader` or
     `boilerplate-scribe` subagent could have carried.
   - **No-ops**: a steering line that changed nothing the session did.
   - **Information access**: a fact the agent needed and could not reach —
     dev-server logs, CI logs, a third-party dashboard.

   Done when every category has been checked against the evidence, and every
   candidate names the file it would change and the transcript moment or
   commit that shows the cost.
4. **Present the candidates** by severity: what each one cost, the fix in a
   sentence, and the file it lands in. Each fix is a change to this repo, so
   it ships on its own branch and PR into `develop` like any other — offer to
   make the ones the user picks.

## Reference

**Review carries the standards, implementation carries the context.** The
implementing agent explores, writes and debugs, so it has the least room; the
standards axis of `mattpocock-skills:code-review` receives a diff and has the
most. A rule a worker broke is first a question of why review let it through.
