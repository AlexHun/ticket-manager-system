import changelogEntriesData from "./changelog-entries.json" with { type: "json" };

/**
 * The "what's new" changelog (issue #94): a popover off the header button
 * listing what shipped, generated rather than admin-authored. "An update" is
 * per deployed version, per the issue's own triage decision — not a calendar
 * release or a hand-authored batch.
 *
 * `changelog-entries.json` is written by CI's `bump-version` job (`.github/workflows/ci.yml`)
 * on every push to `develop`, one entry per `feat`/`fix` commit since the
 * previous bump — the same conventional-commit prefix this repo's own commits
 * already use, stripped for display. A `chore`/`refactor`/`docs`/etc. commit
 * still bumps the version (see `releaseName()` in `apps/web/vite.config.ts`)
 * but adds no entry here, because not every deploy is something a user should
 * be told about. Every commit since the previous bump is scanned rather than a
 * branch's tip, which is routinely a review fix-up on top of the `feat` that
 * was the branch's point (issue #113) — so a deploy can contribute several
 * entries, and they share a version. This file is the one thing standing between "empty" and "has
 * content" for a fresh environment — same as `KnowledgeArticle`/`TutorialContent`,
 * nothing needs seeding for the feature to work.
 *
 * **This is a sparse subsequence of deployed versions, not a second counter.**
 * Every `ChangelogEntry.version` is a real value `apps/web`'s package.json —
 * and therefore `VITE_SENTRY_RELEASE`, see `releaseName()` — took on at some
 * past deploy; a `chore`-only deploy simply never appears here at all. So
 * `CHANGELOG_LATEST_VERSION` (below) can trail the version actually running
 * in production, and that gap is not a bug to close: there is nothing to
 * show for the versions in between, so nothing should light up the badge for
 * them either. Don't "fix" this by reading `VITE_SENTRY_RELEASE` into the
 * seen-state comparison — that would make the badge light up on a deploy
 * with no new content.
 */
export interface ChangelogEntry {
  /** `apps/web`'s package.json version at the time this entry was recorded —
   * the same value `VITE_SENTRY_RELEASE` carried at that deploy (see
   * `releaseName()` in `apps/web/vite.config.ts`), not a value invented for
   * this feature. Not necessarily contiguous with neighbouring entries, since
   * a `chore`-only deploy bumps the version without adding an entry, and not
   * unique either, since a branch carrying two `feat`/`fix` commits records
   * two entries at the same version — see the type doc above. */
  version: string;
  /** ISO date (`YYYY-MM-DD`), the day CI recorded the entry. */
  date: string;
  title: string;
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = changelogEntriesData;

/**
 * Dotted-numeric version compare (`"0.1.9"` < `"0.1.10"`), because these are
 * `major.minor.patch` strings compared numerically per segment, not sorted as
 * plain text — `apps/web`'s version is patch-bumped on every push to `develop`
 * (see the `bump-version` CI job), so a lexical compare breaks the moment a
 * segment reaches double digits.
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The newest entry's version, or `null` when nothing has been recorded yet.
 * This — not `VITE_SENTRY_RELEASE` — is what a user's seen-state is compared
 * against, because it tracks the last entry actually worth showing, not the
 * raw deploy counter.
 */
export const CHANGELOG_LATEST_VERSION: string | null = CHANGELOG_ENTRIES.reduce<
  string | null
>(
  (latest, entry) =>
    latest === null || compareVersions(entry.version, latest) > 0
      ? entry.version
      : latest,
  null,
);

/** `GET /api/changelog/status`: whether the caller has unseen entries. */
export interface ChangelogStatusResponse {
  shouldShow: boolean;
}
