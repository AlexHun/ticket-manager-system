# Plan: The docs cite code that exists

**PRD:** [docs/prd/doc-citations.md](../prd/doc-citations.md) · **Status:** Draft · **Date:** 2026-10-07

## Layers crossed

```
docs   docs/standards · docs/adr · CLAUDE.md ×3 · .claude/skills · .claude/agents · docs/prd · docs/plans
  → new: citation index          backticked paths and symbols, each with its doc and line
    → new: resolver              a path against the tracked tree; a symbol against source, tests and config
      → new: exemption table     doc, citation and reason, beside the check
        → new: apps/api/src/doc-citations.test.ts   bun test → .husky/pre-push and CI's API job
  → new: scripts/graph.ts         `bun run graph <file|doc>`
      → apps/web/dev/scan.ts      scanProject(root): imports, importedBy (exists)
```

No database, no route, no page. The far side this plan has to reach is
**`.husky/pre-push`**: a citation check that only runs when someone remembers to
run it is the self-check rule again, written in code.

## The done bar, and why it changes here

The skill's done bar is a Playwright spec per slice. That conflicts with this
feature: it has no UI, and R7 puts it in the pre-push hook, which E2E runs
outside of. The bar used instead is the one `apps/api/src/standards-guard.test.ts`
already holds itself to. Each slice is done when:

- the guard is green on the real tree;
- it catches every planted violation it is shown and passes every planted
  exemption;
- it fails if its walk comes back empty;
- `git push` runs it.

The query (slices 5–6) keeps its logic in the citation module, where the API
suite tests it, and leaves the script a formatter. That is the split
`bun run tokens` uses with `gatherUsage`, and for the same reason: `scripts/`
has no test runner (`frontend.md`).

## Slice 1 — Paths in the standards fail the push

**Retires:** the skeleton's three unknowns:

- whether a short citation (`provider.ts`) and a full one (`apps/api/src/ai/provider.ts`) resolve by one rule;
- whether it gives the same answer on a CRLF Windows checkout and an LF CI one;
- whether it is fast enough to sit in pre-push.

**Covers:** R1, R3, R4, R7, R8 (the paths half)

`new:` the citation index, the path resolver, the exemption table and
`doc-citations.test.ts`, reading `docs/standards/` only.

- Rename a file a standards bullet cites, push, and the push fails, naming
  `docs/standards/<file>.md:<line>` and the missing path.

**Decided here, with the reason:** paths resolve against **tracked** files
(`git ls-files`), not the working directory. A developer's untracked files and
gitignored files (`.env.test`, `*.local.json` fixtures) would otherwise make a
citation green on their machine and red on CI, which R7 rules out. A gitignored
file that a doc cites on purpose gets an exemption that says so.

**Hardcoded for now:**

- `docs/standards/` only. Slice 2 adds ADRs and slice 3 the rest.
- Paths only. Symbols are slice 2.
- No rename hint (slice 4).
- The exemptions the baseline already found, each with a reason:
  - placeholders: `src/x.test.ts` in `testing-api.md`;
  - installed-package paths: `dist/utils/get-request-ip.mjs` in `backend.md`;
  - a file outside the repo: `MEMORY.md` in `conventions.md`;
  - one deliberate piece of history: "they had been one 42 KB `protocol.ts`" in `frontend.md`.

**Evidence:**

- The guard's planted cases: a stale path, an exempted path, an exemption
  that matches nothing, an empty walk.
- The guardrail metric, measured once warm on the Windows dev machine.
  `conventions.md` puts the hook at ~49s, which is the number to report against.

## Slice 2 — Symbols in the standards and ADRs

**Retires:** the PRD's two matching risks. Too loose, and a renamed `rowFor`
still "resolves" because the word survives somewhere unrelated. Too strict, and
library names cited on purpose fail.
**Covers:** R2, R9, and ADRs under R5
**Un-hardcodes:** paths only; `docs/standards/` only.

The matching rule is chosen from a measurement, not assumed (spike below). The
leading candidate is a whole word in **comment-stripped** tracked source, tests
and config. Of the variants considered, it is the only one under which a
symbol that now survives only in a comment counts as gone.
`apps/api/src/strip-comments.ts` already provides that text.

- Rename an exported function a standards bullet names, push, and the push
  fails, naming the doc, the line and the symbol.

**R9's two fixes are edits to `frontend.md`, not exemptions:**

- `sonner.tsx` no longer reads `useTheme`; it pins `theme="dark"`.
- **The `ChartCard` bullet is stale as a claim, not just a name.** It says
  `ChartCard` renders a bare `overflow-auto` div outside `TABLE_FRAME`, and
  `ChartCard.tsx` now renders `<TableFrame>`. The fix rewrites the bullet and
  checks whether #123 is closed. The check found this through a name, which is
  the most it can do; the PRD's non-goal on prose claims stands.

**Hardcoded for now:** the exemptions the baseline found, each with a reason.
They fall into two groups:

- **history:** `AutoReplyOutcome`, `renderWithQuery`, `emptyScan`, `stopRequestedAt`;
- **library or tool names:** `NO_TRUSTED_IP_KEY`, `requireEmailVerification`, `hashFiles`, `watchPatterns`, `WebFetch`, `cleanupPeriodDays`.

The ADRs also bring four path exemptions:

- `Prisma.sql`, a symbol that happens to look like a file;
- `src/x.test.ts`, a placeholder;
- `dist/plugins/anonymous/index.mjs`, an installed-package path;
- `classify.test.ts`, which ADR-0017 names as a file that does not exist.

The exact list is whatever the chosen rule leaves, re-measured in this slice.

**Evidence:** slice 1's planted cases plus a stale symbol, a symbol that
survives only in a comment, and an exempted library name.

## Slice 3 — CLAUDE.md files, skills and agents

**Retires:** nothing new. It widens the walk to the documents agents read
first.
**Covers:** R5
**Un-hardcodes:** standards and ADRs only.

The walk adds every `CLAUDE.md`, `.claude/skills/` and `.claude/agents/`. The
three library skills (`migrate-radix-to-base`, `shadcn`,
`better-auth-best-practices`) are excluded by name. Like `standards-guard`'s
`allowed`, an exclusion naming a directory that no longer exists fails.
`.agents/skills/` holds the vendored copies pinned in `skills-lock.json`, and is
not read.

- A skill that names a script or path that has moved fails the push.

**Hardcoded for now:** whatever the repo's own skills and agents need exempted.
The baseline counted 37 unresolved citations there, and each is fixed or exempted.

**Evidence:** slice 1's planted cases, run over a planted skill and a planted
excluded skill.

## Slice 4 — PRDs and plans while open

**Blocked on a decision:** the PRD's first open question.
**Covers:** R6

Two questions, the second found while writing this plan:

1. **What marks a document as shipped?** Every PRD says `Status: Draft`. The
   recommendation is a `Status: Shipped` line written when the last ticket
   closes, plus this slice backfilling the 12 PRDs and 12 plans. The tracker is
   ruled out by R7.
2. **An open plan cites files that do not exist yet, by design.** Every `new:`
   module in a plan is an unresolved path, this plan's included. Checked
   naively, R6 fails every plan the day it is written. The candidate answer is
   to check only citations that **resolved when the plan was written** and have
   stopped resolving since. That needs the plan's commit, and CI's API job
   checks out shallow (`actions/checkout` with no `fetch-depth`). The
   alternative is to check PRDs, which name what exists, and leave plans to the
   query.

Neither has an answer this plan can pick. The slice is cut as a ticket either
way, so the blocking edge is visible.

## Slice 5 — The failure names the rename

**Retires:** whether a git-history lookup is affordable on the failure path,
and what it does on a shallow clone.
**Covers:** R10

When a missing path or symbol was renamed, the failure line names the new name
and the commit that renamed it, for example `TABLE_FRAME → TableFrame (<sha>)`. The lookup
runs only for citations that already failed, so a green push pays nothing.

- On a full clone (every developer's pre-push) the hint appears. On CI's
  shallow checkout it is silently absent, and the failure still names the doc
  and the line. Deepening CI's checkout for a hint is not worth the cost.

**Evidence:** a planted rename in a temporary git repo the test creates, plus a
planted shallow clone in which the hint is absent and the failure still fires.

## Slice 6 — `bun run graph`: who cites this, what does this cite

**Retires:** the join across workspaces. The script reaches the citation index
in `apps/api/src` and `scanProject` in `apps/web/dev`, as `bun run tokens`
reaches `apps/web/dev/usage.ts`.
**Covers:** R11, R12, R13

- `bun run graph apps/api/src/ai/provider.ts` prints:
  - every doc and line that cites the file;
  - the file's importers and imports.
- `bun run graph docs/standards/ai-features.md` prints every citation in the
  doc and whether each one resolves.
- `--mermaid` prints the file's neighbourhood as a fenced `mermaid` block.

**Hardcoded for now:** the neighbourhood is one hop. A wider radius is a
flag nobody has asked for.

**Evidence:**

- `citersOf` and `citationsIn` are tested in the API suite over a fixture doc
  tree.
- The script is run by hand against the real tree.
- The Mermaid output is pasted into this PR's description, so GitHub shows
  whether it renders.

## Requirement coverage

| Req | Slice | Note                                                                         |
| --- | ----- | ---------------------------------------------------------------------------- |
| R1  | 1     |                                                                              |
| R2  | 2     |                                                                              |
| R3  | 1     | The table starts with slice 1's four path exemptions and grows each slice    |
| R4  | 1     | Also applies to slice 3's exclusion list                                     |
| R5  | 2, 3  | ADRs in 2; CLAUDE.md, skills and agents in 3                                 |
| R6  | 4     | **Blocked** on the two questions in slice 4                                  |
| R7  | 1     | Tracked files, not the working directory, is what makes Windows and CI agree |
| R8  | 1–3   | Each slice adds its own planted cases                                        |
| R9  | 2     | `useTheme`, and the `ChartCard` bullet rewritten rather than renamed         |
| R10 | 5     | `Should`                                                                     |
| R11 | 6     | `Should`                                                                     |
| R12 | 6     | `Should`                                                                     |
| R13 | 6     | `Should`                                                                     |

Every `Must` has a slice; R6's is blocked rather than missing. No slice exists
without a requirement.

## Spikes

- **Where does the citation module live?** It has to reach the API suite, so
  pre-push runs it, and `apps/api/tsconfig.json` includes only `src`. The script
  imports it by relative path. The recommendation is
  `apps/api/src/doc-citations.ts` beside `standards-guard.test.ts`, which
  lives there for the same pre-push reason. Timebox 1h, blocks slice 1.
- **Which symbol-matching rule?** Run each candidate over today's ~530 distinct
  cited symbols: raw source, comment-stripped source, and declared names only.
  For each, count how many resolve only through a comment or an unrelated
  file. Pick the rule whose misses are all real. Timebox 2h, blocks slice 2.

## Deferred

- **Relative Markdown links** (`[x](backend.md)`). PRD open question. A
  cheap follow-up on slice 1's resolver.
- **`.agents/skills/`.** Vendored and hash-pinned; fixing a citation there
  would break the pin.
- **Ticket and PR edges.** PRD non-goal; they need the network.
- **A test runner for `scripts/`.** `frontend.md` records it as a bigger
  decision. Slice 6 sidesteps it by keeping the logic in the API suite.
- **A "cited by" panel on `/__dev/map`.** It would give the query a UI and an
  E2E, but no requirement asks for it, and the PRD rules out new visual
  surfaces.
