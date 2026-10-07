# PRD: The docs cite code that exists

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-10-07

## Problem

The standards, ADRs, CLAUDE.md files, skills and agents in this repo name the
code they govern by exact path and symbol: `toAiUsage` in `ai/provider.ts`,
`registerWorker` in `jobs/boss.ts`. Agents act on those names. A citation left
behind by a rename sends a reader to code that is not there. A human notices
that. An agent may instead go and find something near enough.

Nothing checks this today. The only guard is the "search for each reference
the change leaves stale" step in the root `CLAUDE.md` self-check, and that
file records stale references as among the defects review agents most often
send back as a fix commit. The rule is followed well: `docs/standards/` and
`docs/adr/` hold 577 path citations, none stale. Two symbol citations are
stale today: `TABLE_FRAME` (now `TableFrame`) and `useTheme` (sonner now pins
its theme), both in `frontend.md`. The cost is not the backlog. It is that
each rename depends on someone remembering to search, and when nobody does,
the miss only surfaces at review.

The reverse question has no answer either: before editing a file, which
standards and ADRs speak about it? `/__dev/map` answers "what imports this"
in a browser. Nothing answers "what governs this", and nothing answers either
question in a terminal, which is where agents work.

## Users

The developer working in this repo, and the agents working for them:

- **Whoever renames or moves code** (person or `/implement`). They learn which
  docs they just made stale when they push, not when a reviewer sends it back.
- **Whoever is about to change a file.** Before the first edit, they list the
  standards bullets and ADRs that cite it, instead of guessing which standards
  file to read.

## Success metrics

Baseline measured with a throwaway script over backticked citations
(2026-10-07). "Unresolved" counts every backticked path or symbol that matches
nothing in the tree, real staleness and deliberate history alike.

| Metric                                                      | Today                                 | Target                                         |
| ----------------------------------------------------------- | ------------------------------------- | ---------------------------------------------- |
| **Stale citations on `develop` that no check reports**      | 2 known; nothing would report a third | 0, and a new one fails before push             |
| Unresolved citations in standards + ADRs, before exemptions | 26 (10 paths, 16 symbols)             | each one fixed or exempted with a reason       |
| Unresolved citations in the repo's own skills + agents      | 37                                    | each one fixed or exempted with a reason       |
| Ways to list the docs that cite a file                      | 0                                     | 1 terminal command                             |
| _Guardrail:_ time the check adds to pre-push                | —                                     | TBD — needs Aleksei, once the plan measures it |

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                                                                                                                                      | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| R1  | A test fails when an in-scope doc cites, in backticks, a repo file path that does not exist, and the failure names the doc, the line and the citation.                                                                                                                                           | Must     |
| R2  | A test fails when an in-scope doc cites, in backticks, a code symbol that occurs nowhere in the repo's source, tests and config, and the failure names the doc, the line and the symbol.                                                                                                         | Must     |
| R3  | A citation that is deliberately historical or external is exempted by an entry beside the check that names its doc and the reason, never by marking the doc's prose.                                                                                                                             | Must     |
| R4  | An exemption that no longer matches an unresolved citation fails the check, so the exemption list cannot rot into a list of things already fixed.                                                                                                                                                | Must     |
| R5  | The check reads every `CLAUDE.md`, `docs/standards/`, `docs/adr/`, and `.claude/skills/` and `.claude/agents/`, except three named library skills: `migrate-radix-to-base`, `shadcn`, `better-auth-best-practices`. A skill or agent added later is in scope until someone names it as excluded. | Must     |
| R6  | A PRD or plan under `docs/prd/` or `docs/plans/` is checked while its feature is open, and not after it ships.                                                                                                                                                                                   | Must     |
| R7  | The check runs on pre-push and in CI, needs no network and no database, and gives the same result on Windows and on the CI runner.                                                                                                                                                               | Must     |
| R8  | The check proves it caught something real: it is shown a stale path and a stale symbol it must catch, plus an exempted mention it must pass, and it fails if its walk finds no docs.                                                                                                             | Must     |
| R9  | When it merges, `develop` has no stale citations left unexempted, and the two known ones are fixed in `frontend.md`, not exempted.                                                                                                                                                               | Must     |
| R10 | When git history shows that a missing path or symbol was renamed, the failure names the new name and the commit.                                                                                                                                                                                 | Should   |
| R11 | One terminal command, given a repo file, lists every in-scope doc and line that cites it, together with the file's importers and imports.                                                                                                                                                        | Should   |
| R12 | The same command, given a doc, lists every path and symbol the doc cites and whether each one resolves.                                                                                                                                                                                          | Should   |
| R13 | The command can print a file's neighbourhood as a Mermaid diagram that GitHub renders when pasted into a PR or issue.                                                                                                                                                                            | Should   |

### Non-goals

- **A second module graph or parser.** `scanProject` in `apps/web/dev/scan.ts`
  already builds the import graph, endpoints, routes and Prisma models. R11
  reads that graph rather than rebuilding it.
- **A new visual map.** `/__dev/map` draws the module graph already. An
  interactive view of citations is made on request as a one-off artifact, not
  maintained in the repo.
- **Checking what prose claims.** "Measured: 8-185ms", "four features ship
  today". Only names are checked. Whether a sentence is still true needs a
  reader, and the fact-checking agents exist for that.
- **Unformatted mentions.** Only backticked citations are read. A bare word in
  prose is too ambiguous to fail a build on.
- **Graphify's other features:** community clustering, an MCP server, hooks
  that route the agent's searches through the graph, and LLM-extracted edges.
- **Ticket and PR edges** (`#211` → `docs/adr/0018`). They need `gh`, and
  R7 rules out the network.

## Constraints

- **The module graph is regex over comment-stripped source, not an AST**, by
  decision (`scan.ts`'s header; the dev-server-test-seams PRD's non-goals). The
  repo is on TypeScript 7, whose native compiler does not expose the JS API
  that `ts-morph` and similar tools depend on, so an AST would also mean a
  second compiler.
- **The API suite runs on pre-push and the web suite only in CI**
  (`apps/api/src/standards-guard.test.ts`'s header), and the API guard cannot
  import from `apps/web/dev/` (`strip-comments.ts` is a copy for that reason).
  R7 asks for pre-push, and R11 asks to reuse a graph built in `apps/web`.
- **Standards guards follow a set pattern:** each rule names its standards
  file and shows the check a violation it must catch and a mention it must
  ignore. R3, R4 and R8 ask for the same shape.

## Risks

| Risk                                                                                                               | Impact                                            | Mitigation                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exemptions become the default fix: a rename lands with one more entry rather than a corrected doc                  | The check passes and the doc still points nowhere | R3 requires a reason per entry, R4 removes dead ones, and review reads the list like any diff                                                                |
| Symbol matching is too loose: a renamed `rowFor` still "resolves" because the word appears in an unrelated test    | Real drift passes silently                        | The plan measures how many of today's citations resolve only by coincidence before it settles the matching rule                                              |
| Symbol matching is too strict, and library names cited for a reason fail (`reuseExistingServer`, `trustedProxies`) | Noise that people learn to exempt by reflex       | Resolve against config, `tests/` and the Caddyfile as well as `apps/`; the baseline's 16 unresolved symbols in standards + ADRs is what the plan starts from |
| The check slows pre-push enough that people push around it                                                         | The gate stops being a gate                       | Guardrail metric; `block-no-verify.mjs` already refuses the bypass                                                                                           |
| Library-skill exclusions hide a skill the repo actually wrote                                                      | Its citations go unchecked                        | Exclusions are by name and listed with the check, so an addition is a visible diff                                                                           |

## Open questions

- [ ] **What marks a PRD or plan as shipped?** All 12 PRDs say `Status: Draft`,
      including ones whose features are live. Options: update the status when
      the last ticket closes, or exclude any document older than its plan's
      last merged ticket. Querying the tracker is ruled out by R7. — _blocks
      R6_, needs Aleksei
- [ ] **An open plan cites files that do not exist yet, by design.** Every
      `new:` module a plan proposes is an unresolved path, so R6 as written
      fails every plan the day it is written. Found while planning; options
      are in [the plan's slice 4](../plans/doc-citations.md). — _blocks R6_,
      needs Aleksei
- [ ] **Where does the check live, given R7 and R11 pull different ways?**
      Pre-push points at the API suite, while the graph and the comment
      stripper live in `apps/web/dev/`. — _affects R7 and R11_, decide in the
      plan
- [ ] **Assumed:** relative Markdown links (`[x](backend.md)`) are not part
      of this pass. They are paths too, and adding them is a cheap follow-up.
      Confirm with Aleksei.
- [ ] **Assumed:** a symbol "exists" if it appears as a whole word anywhere in
      tracked source, tests or config. This is weaker than "is declared", and
      the second risk above is the cost. Confirm in the plan.
- [ ] **Assumed:** the baseline counts (26 / 37 / 41) come from a throwaway
      script and are approximate. The plan re-measures before R9 is
      sized.
