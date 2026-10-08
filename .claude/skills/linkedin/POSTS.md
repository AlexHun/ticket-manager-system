# Post craft

## STAR shape

A post is a short story, not a summary. STAR sets the order; the labels never
appear in the text.

- **Hook (Situation, compressed)** — the first 1–2 lines, under ~200
  characters, because that is all that shows before "…see more". Open on the
  concrete moment or the surprising number: "The auto-reply sent a confident
  answer to a ticket the knowledge base knew nothing about."
- **Task** — what had to be true, and why it was hard. One or two sentences.
- **Action** — what you did, including the first attempt that lost. Name the
  real mechanism (a queue, a prompt, a test) at the level a peer engineer
  would recognise.
- **Result** — the measured outcome: a number, a before/after, a test that now
  stays green. Then the one takeaway, stated once.
- **Close** — a specific question only someone with experience can answer
  ("How do you decide when an AI reply should go to a human instead?"), or
  nothing.

## Hooks

Write three openings of different types, then let the target reader pick one.
Types: **confession** ("I told the model not to… In 7 of 9 runs it did"),
**number**, **the customer's own words** (a quoted email), **a decision readers
would argue with** ("…and I deliberately didn't connect it to CI"),
**before/after**. Rotate types across posts; two posts in a row with the same
type is a freshness finding.

## Closes

The close varies as much as the hook. Options: a specific question, a plain
statement of what changed, the honest limit of the result, or nothing. A
one-line moral ("X is advice, Y is a guarantee") is allowed in at most one
post in three. `series-scan.mjs` counts them.

## Prepared replies

Every post ships with 2–3 replies to the comments the target reader predicts,
including the sceptical one. Each reply: two or three sentences, adds one fact
the post left out, never argues. The author posts them only if they want to.

## Format

- 120–250 words is the working range; hard limit 3,000 characters.
- Short paragraphs (1–3 sentences) separated by blank lines; vary their length.
- Plain text. Lists only when the content is a real sequence or set.
- 0–3 hashtags, at the end, specific (`#ClaudeCode`, `#TypeScript`) over
  generic ones.
- Links go in the first comment; say "link in the comments" in the post.
- One idea per post. A second idea is the next post.

## Voice

First person, past tense for the story, present tense for the lesson. Write the
way you would explain it to a colleague at a whiteboard: specific nouns, active
verbs, numbers with units, the honest limit of the result ("on our 40-ticket
eval set", not "dramatically"). Credit the tools plainly — "Claude Code wrote
the first draft of the test; I rewrote the assertion" — and keep the claim
proportionate to what the evidence shows.

## Worked example

Weak (summary, no tension, slop):

> Excited to share that I built an AI-powered ticket system! 🚀 It leverages
> cutting-edge AI to streamline support workflows. Key learnings: testing
> matters, AI is powerful, and iteration is key. Thoughts?

Strong (STAR, evidenced):

> Our AI auto-reply had one job it kept getting wrong: knowing when to stay
> quiet.
>
> Tickets come in by email, get classified, and if the knowledge base covers
> the question, a reply is drafted. When it didn't cover it, the model still
> wrote something plausible.
>
> My first fix was a stricter prompt. It helped on the easy cases and missed the
> ones that mattered. What worked was moving the decision out of the model: the
> API decides whether the reply may go out, from the retrieval result, and the
> model only writes the text.
>
> [Result with the real number from the PR or test.]
>
> Lesson: let the model write and let the code decide.
>
> Where do you draw that line in your AI features?

The strong version's details are illustrative; a real post takes its facts from
the evidence refs, never from this example.

## Post file

`docs/linkedin/posts/NN-slug.md`. The scripts read the post text between the
frontmatter and the first `## ` heading, so everything else goes below one.

```markdown
---
status: reviewed
date: Tue 3 Nov
pillar: 2
visual: screenshot of one eval run
evidence:
  - docs/adr/0021-a-planned-run-is-not-a-run.md
takeaway: <one sentence>
reader: <who stops scrolling, and why>
score: 14
scores: { hook: 2, tension: 2, specificity: 2, evidence: 2, voice: 1, brand: 2, freshness: 1, close: 2 }
---

<the post, exactly as pasted into LinkedIn>

## Replies

> <likely comment>

<prepared reply>
```
