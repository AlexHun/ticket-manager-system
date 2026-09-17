# Transcript fixture

Two Claude Code transcripts, in the JSONL shape `apps/web/dev/usage.ts` reads.
`tests/e2e/dev-usage.spec.ts` points `CLAUDE_TRANSCRIPT_DIR` here (via
`playwright.config.ts`) so the Usage page has figures an assertion can be
written against — a real machine's spend is not something a test can name.

What the two files add up to, and why each line is here:

| Issue  | Output tokens               | Turns | Sessions | Cache read                      |
| ------ | --------------------------- | ----- | -------- | ------------------------------- |
| `#101` | 12,000 + 8,000 = **20,000** | 2     | 1        | 300,000 + 100,000 = **400,000** |
| `#102` | **3,000**                   | 1     | 1        | **20,000**                      |

Three lines are in `session-a.jsonl` to be _excluded_, and each one is a rule
worth holding:

- a turn on `main` — belongs to no issue, and must not land in either row;
- a turn on `chore/no-issue-here` — a branch naming no issue is dropped, not
  bucketed into a zeroth row;
- a truncated final line — the ordinary shape of an append-only JSONL file that
  is still being written, and skipping it must not lose the lines above it.

Change a number here and `dev-usage.spec.ts` goes red, which is the point: the
spec states these totals as literals rather than recomputing them with the code
under test.
