/**
 * The nine main pages that carry a tutorial. Mirrors the `TutorialPageKey`
 * Postgres enum — keep the two in step, which means a new key is a migration
 * (`ALTER TYPE … ADD VALUE`) and not only a line here.
 */
export const TUTORIAL_PAGE_KEY = {
  dashboard: "dashboard",
  tickets: "tickets",
  ticketDetail: "ticketDetail",
  pipeline: "pipeline",
  knowledge: "knowledge",
  users: "users",
  activity: "activity",
  outbox: "outbox",
  evals: "evals",
} as const;

export type TutorialPageKey =
  (typeof TUTORIAL_PAGE_KEY)[keyof typeof TUTORIAL_PAGE_KEY];

export const TUTORIAL_PAGE_KEYS = [
  TUTORIAL_PAGE_KEY.dashboard,
  TUTORIAL_PAGE_KEY.tickets,
  TUTORIAL_PAGE_KEY.ticketDetail,
  TUTORIAL_PAGE_KEY.pipeline,
  TUTORIAL_PAGE_KEY.knowledge,
  TUTORIAL_PAGE_KEY.users,
  TUTORIAL_PAGE_KEY.activity,
  TUTORIAL_PAGE_KEY.outbox,
  TUTORIAL_PAGE_KEY.evals,
] as const;

/**
 * Whether a page's tutorial should be shown again, per page. Bumped by hand by
 * a developer when a page's UI or business logic changes materially enough
 * that someone who already knows the page should be told again — never by an
 * admin editing the tutorial's copy, and never automatically.
 *
 * A `Record` over the whole key set rather than a lookup with a fallback, same
 * trick as `DECLINE_STAGE` and `EVENT_AUDIENCE`: a tenth page is a compile
 * error here until somebody gives it a starting version.
 *
 * Read only by `GET /api/tutorials/:pageKey`, which compares this against the
 * caller's `TutorialProgress.seenVersion` for that page — see that route for
 * the comparison. Nothing about *content* lives here; `TutorialContent.steps`
 * is admin-edited in the database and editing it does not touch this file.
 */
export const TUTORIAL_PAGE_VERSIONS: Record<TutorialPageKey, number> = {
  [TUTORIAL_PAGE_KEY.dashboard]: 1,
  [TUTORIAL_PAGE_KEY.tickets]: 1,
  [TUTORIAL_PAGE_KEY.ticketDetail]: 1,
  [TUTORIAL_PAGE_KEY.pipeline]: 1,
  [TUTORIAL_PAGE_KEY.knowledge]: 1,
  [TUTORIAL_PAGE_KEY.users]: 1,
  [TUTORIAL_PAGE_KEY.activity]: 1,
  [TUTORIAL_PAGE_KEY.outbox]: 1,
  [TUTORIAL_PAGE_KEY.evals]: 1,
};

/** Longest accepted tutorial title, mirrored by the zod schema in `@ticket/core`. */
export const TUTORIAL_TITLE_MAX_LENGTH = 100;

/** Longest accepted title/body for one step, mirrored by the zod schema. */
export const TUTORIAL_STEP_TITLE_MAX_LENGTH = 100;
export const TUTORIAL_STEP_BODY_MAX_LENGTH = 1_000;

/** Most steps one tutorial may have, mirrored by the zod schema. */
export const TUTORIAL_MAX_STEPS = 10;

/** Longest accepted anchor id, mirrored by the zod schema. */
export const TUTORIAL_STEP_ANCHOR_MAX_LENGTH = 60;

export interface TutorialStep {
  title: string;
  body: string;
  /**
   * Which on-page element this step points to, if any — a key into that
   * page's entry in `apps/web/src/lib/tutorial-anchors.ts`, matched at
   * render time against a `data-tutorial-anchor` attribute somewhere on the
   * live page. Not a CSS selector: an admin can only pick from a fixed list
   * a developer maintains, so a typo here is a wrong dropdown choice, never
   * a broken query string reaching the DOM.
   *
   * Undefined, or an id nothing on the current page carries, both mean the
   * same thing to `<Tutorial>` — fall back to a screen-centered callout
   * rather than pointing at nothing. A page changing out from under a saved
   * anchor is expected (elements get renamed, moved, removed) and must never
   * be a rendering error.
   */
  anchor?: string;
}

/**
 * One page's tutorial, as the API serves it.
 *
 * `updatedAt`/`updatedByName` are both null when no admin has written this
 * page's content yet — the same "a missing row reads as its default" contract
 * `AutomationSettings` uses. `steps` is empty in that case too, which is what
 * keeps `TutorialStatus.shouldShow` false for a page nobody has authored: see
 * the route for why an empty tutorial is never shown regardless of version.
 */
export interface TutorialContent {
  pageKey: TutorialPageKey;
  title: string;
  steps: TutorialStep[];
  updatedAt: string | null;
  updatedByName: string | null;
}

/**
 * The answer to "should this page's tutorial pop up right now", for the
 * caller making the request. Bundled with the content itself so the frontend
 * component needs one request, not two, on every page mount.
 */
export interface TutorialStatus {
  content: TutorialContent;
  shouldShow: boolean;
}

export interface TutorialStatusResponse {
  tutorial: TutorialStatus;
}

export interface TutorialContentResponse {
  tutorial: TutorialContent;
}

/** `GET /api/tutorials`, admin-only: every page's content, for the editor. */
export interface TutorialContentsResponse {
  tutorials: TutorialContent[];
}
