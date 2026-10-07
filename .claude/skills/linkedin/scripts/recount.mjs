#!/usr/bin/env node
// Recounts the repo numbers posts quote, from the repo root, on the day of use.
// Usage: node .claude/skills/linkedin/scripts/recount.mjs
// Needs git, gh and bun on PATH (run it through PowerShell on Windows).
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const run = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'n/a';
  }
};

run('git fetch -q origin develop');
const first = run('git log --reverse --format=%ad --date=short origin/develop').split('\n')[0];
const months = first === 'n/a' ? 'n/a' : ((Date.now() - Date.parse(first)) / (30.44 * 864e5)).toFixed(1);

// The cases module is TypeScript, so bun reads it.
const cases = run(
  `bun -e "import { AUTO_REPLY_CASES as c } from './packages/core/src/cases/auto-reply-cases.ts'; ` +
    `console.log([c.length, c.filter(x => x.adversarial).length, c.filter(x => x.expected.outcome === 'declined').length].join(' '))"`,
).split(' ');

const rows = [
  ['first commit', first],
  ['months since first commit', months],
  ['commits on origin/develop', run('git rev-list --count origin/develop')],
  ['merged PRs', run('gh pr list --state merged --limit 2000 --json number --jq length')],
  ['ADRs (docs/adr)', readdirSync('docs/adr').filter((f) => /^\d{4}-.*\.md$/.test(f)).length],
  ['eval cases', cases[0] ?? 'n/a'],
  ['  adversarial', cases[1] ?? 'n/a'],
  ['  expected to decline', cases[2] ?? 'n/a'],
];
for (const [k, v] of rows) console.log(`${k.padEnd(28)}${v}`);
