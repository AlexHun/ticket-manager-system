#!/usr/bin/env node
// Appends entries to packages/shared/src/changelog-entries.json — the data
// behind the "what's new" popover (issue #94) — for the user-facing commits in
// the deploy that triggered this run.
//
// Run by CI's `bump-version` job (.github/workflows/ci.yml) on every push to
// main, right after the version bump, so the entries carry the *new* version.
// Not every push gets one: a `chore`/`refactor`/`docs`/etc. commit still bumps
// the version (see `releaseName()` in apps/web/vite.config.ts) but adds nothing
// here, because not every deploy is something worth telling a user about —
// only `feat` and `fix` are.
//
// **Every commit on the merged branch is offered, not just its tip** (issue
// #113). A branch here normally ends on a review fix-up — a `refactor`, a
// comment correction — sitting on top of the `feat` that was its point, and
// reading one subject dropped the entry for the whole branch. A branch that
// carries two user-facing commits therefore gets two entries at the same
// version; the popover renders them as separate rows, in branch order.
//
// Inputs, both required, passed as env vars rather than argv so the caller
// doesn't have to worry about shell-quoting commit subjects that might contain
// spaces or quotes of their own:
//   COMMIT_SUBJECTS  the deploy's commit subjects, one per line, oldest first,
//                    conventional-commit style
//   NEXT_VERSION     the version apps/web/package.json was just bumped to
//
// Exits 0 and leaves the file untouched when no subject is feat/fix — this is
// the common case (most deploys are not) and not an error. Same for an empty
// COMMIT_SUBJECTS, which is a merge that added no commits.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRIES_PATH = path.resolve(
  __dirname,
  "../../packages/shared/src/changelog-entries.json",
);

const commitSubjects = process.env.COMMIT_SUBJECTS;
const nextVersion = process.env.NEXT_VERSION;

// Set-but-empty is a real, fine outcome (nothing to record); unset means the
// caller is wired up wrong, which is worth failing the job over.
if (commitSubjects === undefined || !nextVersion) {
  console.error("COMMIT_SUBJECTS and NEXT_VERSION are both required.");
  process.exit(1);
}

// Conventional-commit prefix this repo's own commits already use — see any
// entry in `git log`, e.g. "feat(dashboard): let each user personalize...".
// Only feat/fix are user-facing; chore/refactor/docs/test/ci are not.
const FEAT_OR_FIX = /^(feat|fix)(\([a-z0-9,/_-]+\))?!?:\s*(.+)$/i;

const date = new Date().toISOString().slice(0, 10);

const newEntries = commitSubjects
  .split("\n")
  .map((subject) => subject.trim())
  .filter(Boolean)
  .map((subject) => FEAT_OR_FIX.exec(subject))
  .filter((match) => match !== null)
  .map((match) => {
    const rawTitle = match[3].trim();
    return {
      version: nextVersion,
      date,
      title: rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1),
    };
  });

if (newEntries.length === 0) {
  console.log("No feat/fix commit in this deploy, no changelog entry.");
  process.exit(0);
}

const entries = JSON.parse(readFileSync(ENTRIES_PATH, "utf8"));
entries.push(...newEntries);
writeFileSync(ENTRIES_PATH, JSON.stringify(entries, null, 2) + "\n");

for (const entry of newEntries) {
  console.log(`Recorded changelog entry for ${nextVersion}: "${entry.title}"`);
}
