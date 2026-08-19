# Every AI feature runs on one provider

Polish, summary, classification and auto-reply all run on OpenAI through the
Vercel AI SDK, sharing one key, one provider handle and one failure taxonomy.
`tech-stack.md` names the Anthropic SDK and files classification under it; this
decision overrides that on purpose.

## Considered Options

Following the plan would have meant a second AI stack, a second account and a
second set of failure modes to classify, in exchange for matching a document
written before any of these features existed. One provider was judged worth
more.

## Consequences

Prompt caching still applies and is designed for — the static knowledge corpus
goes in the system prompt precisely so the prefix is identical across requests.
Nothing Anthropic-shaped is outstanding: adding a second provider now needs its
own argument, not this plan.
