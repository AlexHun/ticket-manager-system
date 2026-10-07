# Score

Eight criteria, 0–2 each, out of 16. Each score comes from the source named,
never from the writer's own opinion of the draft.

| Criterion | 2 | 1 | 0 | Scored by |
|---|---|---|---|---|
| **Hook** | first ~200 chars make the target reader click | clear but not compelling | a summary, a context paragraph, or a cliché opener | target-reader |
| **Tension** | a real problem with stakes, and an obvious approach that failed | a problem, but no failed attempt or nothing at stake | a feature summary | target-reader |
| **Specificity** | named mechanisms, numbers with units, a concrete before/after | some concrete detail, some abstraction | abstraction all the way down | slop-critic |
| **Evidence** | every claim verified; former colleague passes | only minor claims unsupported | any claim wrong or stretched, or the former colleague says fix | fact-checker + former-colleague, lower wins |
| **Voice** | sounds like the author's samples; humor rules kept | mostly theirs, a few polished lines | reads as model-written | slop-critic |
| **Brand fit** | supports the positioning sentence, fits its pillar | on-topic but forgettable for the target reader | off-brand or on the avoid list | target-reader |
| **Freshness** | no `series-scan.mjs --post NN` finding | findings with a one-line justification each | repeats a recent post's shape, moral or pillar unjustified | series-scan |
| **Close** | a question only an experienced reader can answer, or a statement that lands; prepared replies written | generic but harmless | "Thoughts?", "Agree?", or a restated hook | target-reader |

## Ship rule

**Ship at 13/16 or more, with no zero**, and with no `wrong` or `stretched`
claim left from the fact-checker. Below that, fix what the low scores name and
re-run only the critics whose criteria changed. Two rounds without reaching 13
means the story is weak, not the wording: report it to the author and offer to
grill a different angle.

## Score card

Record the result in the post file's frontmatter:

```yaml
score: 14
scores: { hook: 2, tension: 2, specificity: 2, evidence: 2, voice: 1, brand: 2, freshness: 1, close: 2 }
```
