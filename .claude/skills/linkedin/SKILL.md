---
name: linkedin
description: LinkedIn personal-brand manager for this project — plans a post series from the repo's real history, grills a post idea, drafts storytelling posts with hooks, and scores every draft through four independent critic subagents (fact-checker, slop critic, target reader, former colleague) plus cross-series repetition checks. Use when the user mentions LinkedIn, a post or content plan, asks to check, score or validate a post or any text for slop or AI patterns, pastes a draft, or reports a published post's numbers.
---

# LinkedIn

Posts about this project, written as an engineer in first person: plain words,
concrete numbers, the trade-off made and what went wrong on the way. Every claim
is **evidence**-backed — it traces to a commit, PR, issue, doc or test in this
repo, or to `profile.md` — and every number is recounted before it ships.

Files live in `docs/linkedin/`, which is gitignored: the repo is public. The
folder is its own private git repository; after writing to it, commit and push
there (`git -C docs/linkedin add -A`, `commit -m "…"`, `push`, through
PowerShell). Nothing private is ever copied into `.claude/`.

- `BRAND.md` — reader, positioning, pillars, voice, humor and hard rules. **Read
  it before any mode.**
- `VOICE.md` — the author's real writing samples; `profile.md` — career facts.
- `plan.md` — the calendar: one row per post with status (`idea` → `grilled` →
  `drafted` → `reviewed` → `published`), score and 48 h metrics.
- `posts/NN-slug.md` — one post per file, format in [POSTS.md](POSTS.md).

Pick the mode from the request. A bare "help with LinkedIn" starts at the next
`idea` row in `plan.md`, or at **Plan** when it has none left.

## Plan

1. Read the metrics columns first: which pillars, hook types and closes earned
   comments and DMs. Weight the next posts toward what worked.
2. Mine for stories, richest first: `docs/standards/`, `docs/adr/`,
   `docs/prd/` + `docs/plans/`, merged PRs, `Flake:` issues, `git log`,
   `.claude/skills/`; `profile.md`'s unused stories for pillar 4. Hand the
   sweep to a `bulk-reader` agent with an exact output shape: candidate,
   tension, evidence refs. A candidate with no tension is dropped.
3. Order by `BRAND.md`'s pillar rules (cap, no repeats in a row, ~1 in 4 from
   pillar 4). Add rows to `plan.md` with a date; done when every row has one.

## Grill

One question at a time, until each has a sharp answer: who stops scrolling and
why; the single takeaway; the proof (commit, number, before/after); what went
wrong first (no mistake usually means no story); what a sceptical senior
engineer replies. Record `takeaway` and `reader` in the post's frontmatter and
set the row to `grilled`.

## Draft

1. Grill first if the row is still `idea`.
2. Read the evidence refs in full; run `scripts/recount.mjs` for repo counts.
3. Write three hooks of different types and the post per [POSTS.md](POSTS.md),
   in the voice of `VOICE.md`. Put the hooks under a `## Hooks` heading.
4. Run **Review** on it, apply every fix, write the prepared replies from the
   target reader's likely comments, and delete `## Hooks`.
5. Set status `reviewed` once it ships under [SCORE.md](SCORE.md)'s rule.
   Any claim that wants more than the evidence carries is reported to the
   author, never stretched.

## Review

For a post file or pasted text (save pasted text to `posts/` or the
scratchpad first):

1. Scripts: `node .claude/skills/linkedin/scripts/slop-scan.mjs <file>` and,
   for a post file, `scripts/series-scan.mjs docs/linkedin/posts --post NN`.
2. Critics: launch **all four in one message**, in parallel, each given only
   the file path — `linkedin-fact-checker`, `linkedin-slop-critic`,
   `linkedin-target-reader`, `linkedin-former-colleague`. Never pass them your
   reasoning or the evidence: their value is a fresh context.
3. Score per [SCORE.md](SCORE.md) from the critics' and scripts' outputs, and
   write the score card into the frontmatter and `plan.md`.
4. Report: the score card, then findings as a list — quote, source, fix — then
   the rewritten post. Keep the author's voice; change only what a finding
   names.

Done when every script flag, SLOP.md pattern and claim has a verdict.

## Record

When the author reports a published post's numbers, fill its row's metrics
(impressions, comments, profile views, DMs at 48 h) and set it `published`.
After every fourth published post, say in two lines what the numbers suggest.

## Guardrails

Posts carry only what is safe in public: no secrets, env values, customer
emails, internal URLs, or ticket contents from real users. The user publishes;
this skill never posts anything.
