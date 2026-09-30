---
name: linkedin
description: LinkedIn content manager for this project — plans a post series from the repo's real history, drafts STAR-story posts, grills a post idea, and reviews any text for AI slop and unsupported claims. Use when the user mentions LinkedIn, a post or content plan, asks to check text for slop or AI patterns, or pastes a draft to validate.
---

# LinkedIn

Posts about this project, written as an engineer in first person: plain words,
concrete numbers, the trade-off made and what went wrong on the way. Every claim
is **evidence**-backed — it traces to a commit, PR, issue, doc or test in this
repo, and every number is recounted from that source before it ships.

Files live in `docs/linkedin/`, which is gitignored: the repo is public, and
drafts and the CV stay on the author's machine.

- `profile.md` — the author's career facts, transcribed from the CV. Personal
  claims (dates, team size, past results) are checked against it, as project
  claims are checked against the repo.
- `plan.md` — the calendar: one row per post with `#`, working title, pillar,
  evidence refs, status (`idea` → `grilled` → `drafted` → `reviewed` →
  `published`), and target date.
- `posts/NN-slug.md` — one post: frontmatter (`status`, `pillar`, `evidence`
  list) then the post text exactly as it would be pasted.

Pick the mode from the request; a bare "help with LinkedIn" starts at **Plan**
when `plan.md` is missing, otherwise at the next `idea` row in it.

## Plan

1. Ask cadence (posts per week) and start date, unless given.
2. Mine the repo for stories. Sources, richest first: `docs/standards/` (rules
   that record a case where the obvious approach lost), `docs/adr/`,
   `docs/prd/` + `docs/plans/`, `gh pr list --state merged --limit 100`,
   `gh issue list --search "Flake:" --state all`, `git log --oneline`,
   `CLAUDE.md` and `.claude/skills/` (the AI-assisted workflow itself).
3. List candidate stories, each with its tension (what was hard or surprising)
   and its evidence refs. A candidate with no tension is dropped.
4. Group into 3–4 pillars (e.g. building with an AI agent, AI features in
   production, engineering process, lessons from bugs) and order the series so
   pillars alternate and the first post is the strongest story.
5. Write `plan.md`. Done when every row has evidence refs and a date.

## Grill

Interrogate one idea before it is drafted, one question at a time, until each
has a sharp answer — a vague answer earns a follow-up, not a pass:

- Who exactly is the reader, and why would they stop scrolling?
- What is the single takeaway, in one sentence?
- What is the proof — which commit, number or before/after?
- What did you get wrong first? (No mistake usually means no story.)
- What would a sceptical senior engineer reply in the comments?

Done when all five have answers; record them in the post file's frontmatter as
`takeaway` and `reader`, and set the row to `grilled`.

## Draft

1. Grill first if the row is still `idea`.
2. Read the evidence refs in full; pull exact numbers, names and quotes.
3. Write the post in STAR shape per [POSTS.md](POSTS.md).
4. Run **Review** on your own draft and apply every fix.
5. Save to `posts/NN-slug.md`, set status `reviewed`. Done when the scan is
   clean or each remaining flag is justified in one line to the user.

## Review

For text the user pastes, or a post file:

1. Save pasted text to the scratchpad, then run
   `node .claude/skills/linkedin/scripts/slop-scan.mjs <file>`.
2. Judgement pass: apply every pattern in [SLOP.md](SLOP.md) the script cannot
   see.
3. Fact pass: check each claim and number against the repo; mark it
   `verified`, `wrong` (with the right value) or `unsupported`.
4. Report findings as a list — quote, pattern, fix — then give the rewritten
   post. Keep the author's voice; change only what a finding names.

Done when every script flag, every SLOP.md pattern and every claim has a
verdict.

## Guardrails

Posts carry only what is safe in public: no secrets, env values, customer
emails, internal URLs, or ticket contents from real users. The user publishes;
this skill never posts anything.
