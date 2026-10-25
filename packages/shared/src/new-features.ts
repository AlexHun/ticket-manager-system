/**
 * The "new" badge (issue #45): a small dot on a nav item that a developer
 * flags by hand when something is worth surfacing, and that disappears for a
 * user the first time they interact with it.
 *
 * Unlike `TUTORIAL_PAGE_KEY`, this set is not fixed — it grows and shrinks as
 * features age out of "new". Add a key here, give it a starting version in
 * `NEW_FEATURE_VERSIONS`, and wire it onto a `NavItem` in
 * `apps/web/src/components/layout/nav-items.ts` to flag something. Remove the
 * key once it's no longer worth calling "new"; any `NewFeatureSeen` rows left
 * behind for it are inert.
 */
export const NEW_FEATURE_KEY = {
  activityPage: "activityPage",
  howItWorks: "howItWorks",
} as const;

export type NewFeatureKey =
  (typeof NEW_FEATURE_KEY)[keyof typeof NEW_FEATURE_KEY];

export const NEW_FEATURE_KEYS = [
  NEW_FEATURE_KEY.activityPage,
  NEW_FEATURE_KEY.howItWorks,
] as const;

/**
 * Whether a "new" badge should (re-)appear, per key. Bumped by hand by a
 * developer — same trick as `TUTORIAL_PAGE_VERSIONS`: a `Record` over the
 * whole key set makes a new key a compile error here until somebody gives it
 * a starting version, and re-flagging something "new" later is a version
 * bump, not a new key.
 */
export const NEW_FEATURE_VERSIONS: Record<NewFeatureKey, number> = {
  [NEW_FEATURE_KEY.activityPage]: 1,
  [NEW_FEATURE_KEY.howItWorks]: 1,
};

/** `GET /api/new-features/status`: every key's badge state for the caller, in
 * one round trip — the sidebar needs all of them at once, unlike the
 * tutorial's one-page-at-a-time status check. */
export interface NewFeatureStatusResponse {
  statuses: Record<NewFeatureKey, boolean>;
}
