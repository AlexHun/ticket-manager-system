#!/usr/bin/env node
// Appends one entry to packages/shared/src/changelog-entries.json — the data
// behind the "what's new" popover (issue #94) — when the commit that
// triggered this deploy is user-facing.
//
// Run by CI's `bump-version` job (.github/workflows/ci.yml) on every push to
// main, right after the version bump, so the entry carries the *new* version.
// Not every push gets an entry: a `chore`/`refactor`/`docs`/etc. commit still
// bumps the version (see `releaseName()` in apps/web/vite.config.ts) but adds
// nothing here, because not every deploy is something worth telling a user
// about — only `feat` and `fix` are.
//
// Inputs, both required, passed as env vars rather than argv so the caller
// doesn't have to worry about shell-quoting a commit subject that might
// contain spaces or quotes of its own:
//   COMMIT_SUBJECT  the merged commit's first line, conventional-commit style
//   NEXT_VERSION    the version apps/web/package.json was just bumped to
//
// Exits 0 and leaves the file untouched when the subject isn't feat/fix —
// this is the common case (most deploys are not) and not an error.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRIES_PATH = path.resolve(
  __dirname,
  "../../packages/shared/src/changelog-entries.json",
);

const commitSubject = process.env.COMMIT_SUBJECT;
const nextVersion = process.env.NEXT_VERSION;

if (!commitSubject || !nextVersion) {
  console.error("COMMIT_SUBJECT and NEXT_VERSION are both required.");
  process.exit(1);
}

// Conventional-commit prefix this repo's own commits already use — see any
// entry in `git log`, e.g. "feat(dashboard): let each user personalize...".
// Only feat/fix are user-facing; chore/refactor/docs/test/ci are not.
const match = /^(feat|fix)(\([a-z0-9,/_-]+\))?!?:\s*(.+)$/i.exec(
  commitSubject.trim(),
);

if (!match) {
  console.log(`Not a feat/fix commit, no changelog entry: "${commitSubject}"`);
  process.exit(0);
}

const rawTitle = match[3].trim();
const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
const date = new Date().toISOString().slice(0, 10);

const entries = JSON.parse(readFileSync(ENTRIES_PATH, "utf8"));
entries.push({ version: nextVersion, date, title });
writeFileSync(ENTRIES_PATH, JSON.stringify(entries, null, 2) + "\n");

console.log(`Recorded changelog entry for ${nextVersion}: "${title}"`);
