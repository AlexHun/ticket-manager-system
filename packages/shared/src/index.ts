export * from "./changelog.ts";
export * from "./users.ts";
export * from "./tickets.ts";
export * from "./ticket-list.ts";
export * from "./automation.ts";
export * from "./events.ts";
export * from "./ai.ts";
export * from "./knowledge.ts";
export * from "./dashboard-stats.ts";
export * from "./outbox.ts";
export * from "./activity.ts";
export * from "./tutorials.ts";
export * from "./new-features.ts";
export * from "./dashboard-layout.ts";
export * from "./brand.ts";
export * from "./health.ts";
export * from "./mid-sentence.ts";
export * from "./auto-reply.ts";
export * from "./pipeline.ts";
export * from "./evals.ts";
export * from "./eval-runs.ts";
export * from "./eval-schedule.ts";

/**
 * The admin screens, by name. A key of its own rather than a route path or a
 * tutorial page key, because neither covers them all: paths live in the web
 * app, and the tutorial editor has no tutorial of its own.
 */
export const ADMIN_SCREEN = {
  users: "users",
  knowledge: "knowledge",
  outbox: "outbox",
  pipeline: "pipeline",
  evals: "evals",
  activity: "activity",
  tutorials: "tutorials",
} as const;

export type AdminScreen = (typeof ADMIN_SCREEN)[keyof typeof ADMIN_SCREEN];

/**
 * Whether a demo visitor sees each admin screen (#320, #368) — said once, here.
 *
 * A `Record` for `DECLINE_STAGE`'s reason: an eighth screen is a compile error
 * until somebody answers, and there is no default that opens one. The web
 * derives its gate (`AdminScreenRoute`), the navigation (`navItemsFor`) and the
 * tutorial editor's list (`routes/tutorials.ts`) from it, and
 * `demo-session.spec.ts` its showcase reads, through `showcaseReads` in
 * `tests/e2e/helpers/demo.ts` (#369). The API's guards are
 * **checked against** it rather than derived from it: a guard stays chosen
 * where the route is mounted, so an admin route added later is shut to a
 * stranger until somebody decides otherwise, and each router's test file names
 * its screen through `screenReads` in `src/test/boundary.ts`, which goes red if
 * the read guard and this table disagree.
 *
 * `true` opens the screen's reads to a demo through `requireAdminView`; every
 * write stays `requireAdmin` either way. Team lists real colleagues and the
 * outbox holds live single-use links, so both say `false`.
 */
export const DEMO_SEES_ADMIN_SCREEN: Record<AdminScreen, boolean> = {
  [ADMIN_SCREEN.users]: false,
  [ADMIN_SCREEN.knowledge]: true,
  [ADMIN_SCREEN.outbox]: false,
  [ADMIN_SCREEN.pipeline]: true,
  [ADMIN_SCREEN.evals]: true,
  [ADMIN_SCREEN.activity]: true,
  [ADMIN_SCREEN.tutorials]: true,
};

/**
 * `GET /api/demo`: whether this deployment offers a demo session (#319).
 *
 * Public, because the login page asks before anyone has signed in. A presence
 * boolean like `PipelineConfig`'s, never the env value behind it.
 */
export interface DemoStatusResponse {
  /** `DEMO_MODE_ENABLED` is the literal `"true"`. Drives the login button. */
  enabled: boolean;
}

/**
 * `GET /api/demo/usage`: this week's demo figures, for an admin only (#327,
 * PRD R14). A demo session is refused them, like the Team page they sit on.
 *
 * The week runs from 00:00 UTC on Monday, the same clock as the nightly reset.
 * A session counts toward the week it started in, so `sessionsOpenedTicket`
 * and `sessionsFollowedStep` are always a share of `sessionsStarted`.
 */
export interface DemoUsageResponse {
  /** ISO timestamp: 00:00 UTC on this week's Monday. */
  weekStartsAt: string;
  /** Demo sessions started since then. */
  sessionsStarted: number;
  /** How many of those opened at least one ticket. */
  sessionsOpenedTicket: number;
  /**
   * How many of those followed at least one of the welcome's suggested steps
   * (#464, demo-welcome PRD R11).
   */
  sessionsFollowedStep: number;
}

/**
 * The Team page's demo card: its accessible name and its three figures'
 * labels. Here so the E2E spec reads them rather than retyping them, like
 * `DEMO_READ_ONLY_NOTE`.
 */
export const DEMO_USAGE_LABEL = {
  title: "Demo sessions this week",
  sessionsStarted: "Started",
  sessionsOpenedTicket: "Opened a ticket",
  sessionsFollowedStep: "Followed a step",
} as const;

/**
 * Why a demo session's polish or summarise was answered without a model call:
 * every demo session together has spent the day's AI budget (#321, PRD R8).
 *
 * Tells this 429 apart from the per-user rate limit's, which carries no
 * `reason`. The two need different screens: the rate limit is an error worth
 * retrying in a minute, and this is a fact about the demo until 00:00 UTC.
 */
export const DEMO_AI_LIMIT_REASON = "demo-ai-limit";

/** What the panel shows in place of the result. One copy, for both apps. */
export const DEMO_AI_LIMIT_MESSAGE =
  "Demo AI limit reached — resets at 00:00 UTC.";

/** The body of `POST /api/ai/*`'s 429 once the demo budget is spent. */
export interface DemoAiLimitResponse {
  error: typeof DEMO_AI_LIMIT_MESSAGE;
  reason: typeof DEMO_AI_LIMIT_REASON;
}

/**
 * Why "Start demo session" started nothing: this address has started its
 * `DEMO_SESSIONS_PER_IP_PER_HOUR` already (#322, PRD R9). The API's 429 carries
 * it and the login page shows it. One copy, for both apps.
 */
export const DEMO_START_LIMIT_MESSAGE =
  "Couldn't start a demo session — too many have started from your network. Try again later.";

/**
 * Why "Start demo session" started nothing: demo mode is off, switched off
 * between the login page loading and the click (#319). The API's 403 carries
 * it and the login page shows it. One copy, for both apps.
 */
export const DEMO_MODE_OFF_MESSAGE =
  "Couldn't start a demo session — demo mode is off.";

/**
 * The note beside every save or run control a demo session sees disabled
 * (#326, PRD R5 and R15). Here rather than in the web app so the E2E spec
 * reads the same copy the page renders; the API's 403 is the control.
 */
export const DEMO_READ_ONLY_NOTE = "Read-only in the demo.";
