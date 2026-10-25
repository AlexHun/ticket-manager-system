import { KNOWLEDGE_REVISION_ACTION } from "./knowledge.ts";
import {
  TICKET_ACTIVITY_ACTION,
  type TicketAssignee,
  type TicketCategory,
  type TicketStatus,
} from "./tickets.ts";
import { ADMIN_ACTIVITY_ACTION } from "./users.ts";
export * from "./changelog.ts";
export * from "./users.ts";
export * from "./tickets.ts";
export * from "./ticket-list.ts";
export * from "./automation.ts";
export * from "./events.ts";
export * from "./ai.ts";
export * from "./knowledge.ts";

/**
 * Why the knowledge-base auto-reply left a ticket for a person.
 *
 * Declining is the designed, common outcome — most support mail is not a
 * knowledge-base question, and six checks fail closed on the rest. Until this
 * existed none of that reached anyone: a declined ticket and a ticket the
 * machine never looked at were the same `Open` row, so an agent could not learn
 * the system's edges and an admin could not tell a working knowledge base from
 * a broken one. The reason was written to a log line and nowhere else.
 *
 * Deliberately finer than `AutoReplyFailure` in the API, which drives *retries*
 * and must stay coarse — four different checks all mean "do not try again" to
 * pg-boss and four different things to a person reading the ticket. The two
 * travel together and neither replaces the other.
 *
 * The ordering below is the order they occur in: four gates before the model is
 * called, then its own verdict, then the checks over what it wrote.
 */
export const AUTO_REPLY_DECLINE = {
  /** Refund, or still unclassified. A machine may not answer either. */
  category: "category",
  /** Somebody had already replied — the corpus answers openings, not threads. */
  answered: "answered",
  /** The opening email had no plain text to read. */
  noText: "noText",
  /**
   * The customer wrote again before anything answered, so the machine would be
   * replying to the older of two unread emails and resolving the ticket on top
   * of the newer one. Same principle as `answered` from the other side: nobody
   * has replied, but this is no longer an opening.
   */
  followUp: "followUp",
  /** It read the corpus and said this is not covered. The common one. */
  notCovered: "notCovered",
  /** It answered, but cited nothing that resolves against the corpus. */
  noCitation: "noCitation",
  /** The reply promised money its cited articles do not mention. */
  unbackedCommitment: "unbackedCommitment",
  /** The reply carried a link or address its cited articles do not contain. */
  unbackedReference: "unbackedReference",
  /** Longer than a knowledge-base answer has any business being. */
  tooLong: "tooLong",
  /** The provider failed, or the retry ladder ran out. Not a judgement. */
  unavailable: "unavailable",
} as const;

export type AutoReplyDecline =
  (typeof AUTO_REPLY_DECLINE)[keyof typeof AUTO_REPLY_DECLINE];

/**
 * A stored decline reason, narrowed to one the client has wording for.
 *
 * `Ticket.autoReplyDecline` is a plain `text` column (see the note on the model
 * for why), so the type on the wire is a promise the API has to keep rather than
 * one Postgres keeps for it. Anything unrecognised becomes null: a reason the UI
 * cannot name is not better than silence, and the alternative is rendering a raw
 * database string at an agent.
 *
 * Here rather than in a route because two routes now need it — the ticket detail
 * and the pipeline — and a narrowing that exists twice is a narrowing that will
 * eventually disagree with itself.
 */
export function asAutoReplyDecline(
  value: string | null,
): AutoReplyDecline | null {
  if (value === null) return null;
  return Object.values(AUTO_REPLY_DECLINE).find((d) => d === value) ?? null;
}

export interface HealthResponse {
  status: "ok";
}

/**
 * Who the dashboard is about.
 *
 * `mine` narrows every panel to the caller's own assigned tickets. The id comes
 * from the session, never from the request, so this is a view control and not
 * an authorisation one — there is deliberately no `userId` param to point it at
 * a colleague.
 */
export const DASHBOARD_SCOPE = {
  mine: "mine",
  all: "all",
} as const;

export type DashboardScope =
  (typeof DASHBOARD_SCOPE)[keyof typeof DASHBOARD_SCOPE];

/**
 * The slice of time every panel is computed over, measured on `createdAt`.
 *
 * Presets only. A custom range needs a date-range picker the UI isn't set up
 * for, and these four already answer "this week / this month / this quarter /
 * this year". No "all time": the volume series would grow without bound.
 */
export const DASHBOARD_RANGE = {
  d7: "7d",
  d30: "30d",
  d90: "90d",
  m12: "12m",
} as const;

export type DashboardRange =
  (typeof DASHBOARD_RANGE)[keyof typeof DASHBOARD_RANGE];

export const DEFAULT_DASHBOARD_RANGE: DashboardRange = DASHBOARD_RANGE.d90;

/** How far back each preset reaches, so the SQL and the axis label agree. */
export const DASHBOARD_RANGE_DAYS: Record<DashboardRange, number> = {
  [DASHBOARD_RANGE.d7]: 7,
  [DASHBOARD_RANGE.d30]: 30,
  [DASHBOARD_RANGE.d90]: 90,
  [DASHBOARD_RANGE.m12]: 365,
};

/** Bucket width for the volume series. `date_trunc` takes exactly these names. */
export const DASHBOARD_BUCKET = {
  day: "day",
  week: "week",
  month: "month",
} as const;

export type DashboardBucket =
  (typeof DASHBOARD_BUCKET)[keyof typeof DASHBOARD_BUCKET];

/**
 * Bucket width per range, so no chart ever draws 365 columns or 2. Server-owned:
 * the client only reads the echoed `bucket` to format the axis.
 */
export const DASHBOARD_RANGE_BUCKET: Record<DashboardRange, DashboardBucket> = {
  [DASHBOARD_RANGE.d7]: DASHBOARD_BUCKET.day,
  [DASHBOARD_RANGE.d30]: DASHBOARD_BUCKET.day,
  [DASHBOARD_RANGE.d90]: DASHBOARD_BUCKET.week,
  [DASHBOARD_RANGE.m12]: DASHBOARD_BUCKET.month,
};

/**
 * Hours-to-first-reply bins. These are ordered, which is why they take the
 * single-hue ordinal ramp rather than four separate colours — and why the key
 * order here *is* the render order. Reordering them without reordering the ramp
 * would make the chart say something false about progression.
 */
export const LATENCY_BUCKET = {
  under1h: "under1h",
  h1to4: "h1to4",
  h4to24: "h4to24",
  over24h: "over24h",
} as const;

export type LatencyBucket =
  (typeof LATENCY_BUCKET)[keyof typeof LATENCY_BUCKET];

/** Age-of-open-ticket bins. Same ordering contract as LATENCY_BUCKET. */
export const AGE_BUCKET = {
  under1d: "under1d",
  d1to3: "d1to3",
  d3to7: "d3to7",
  over7d: "over7d",
} as const;

export type AgeBucket = (typeof AGE_BUCKET)[keyof typeof AGE_BUCKET];

/** Row caps. Named here because the panel headings quote them. */
export const NEEDS_ATTENTION_LIMIT = 6;
export const TOP_CUSTOMERS_LIMIT = 8;
export const WORKLOAD_AGENT_LIMIT = 10;

/** A count per status. Keyed by the status values, so a Record and not a shape. */
export type StatusCounts = Record<TicketStatus, number>;

export interface TicketStatsSummary {
  /** Tickets created inside the slice. */
  total: number;
  /** The same count over the window immediately before it — the delta's baseline. */
  previousTotal: number;
  byStatus: StatusCounts;
  /** Open *and* nobody's: the triage queue, the one number with an action attached. */
  openUnassigned: number;
  /**
   * Resolved+Closed as a share of `total`, 0–1. Deliberately not a resolution
   * *time*: there is no resolvedAt column, so this says how much of the slice is
   * settled and nothing about how fast it got there.
   */
  settledShare: number;
}

/**
 * One column of the volume chart.
 *
 * Status keys are flat rather than nested because Recharts addresses a stacked
 * series by `dataKey` — this lets the chart say `dataKey={TICKET_STATUS.Open}`
 * instead of restating the string.
 */
export type TicketVolumePoint = {
  /**
   * Bucket start as a plain calendar date, `YYYY-MM-DD`, already truncated in
   * UTC. Deliberately not an instant: an ISO timestamp re-parsed in a negative
   * offset renders as the previous day, so half the world would see every
   * bucket labelled one day early.
   */
  bucketStart: string;
} & StatusCounts;

export interface TicketCategoryCount {
  /** null is the real "uncategorised" state, not a missing value. */
  category: TicketCategory | null;
  count: number;
}

export interface FirstResponseStats {
  /** Tickets in the slice with at least one outbound message. */
  responded: number;
  /**
   * Tickets in the slice with none. They have no latency, so they are absent
   * from the buckets and the median and reported separately — a median of forty
   * minutes across the tickets anyone answered is not a good first-response time
   * if twice as many were ignored.
   */
  awaiting: number;
  /** null when nothing in the slice was ever replied to. */
  medianHours: number | null;
  p90Hours: number | null;
  buckets: Record<LatencyBucket, number>;
}

export interface BacklogAgeStats {
  /** Open tickets in the slice — the denominator for the buckets. */
  open: number;
  medianAgeHours: number | null;
  buckets: Record<AgeBucket, number>;
}

export interface WorkloadCounts extends StatusCounts {
  total: number;
}

export interface AgentWorkload extends WorkloadCounts {
  id: string;
  name: string;
}

export interface CustomerStats {
  email: string;
  /**
   * The name on their most recent ticket. The same address can arrive under
   * several spellings, and the latest is the one an agent will recognise.
   */
  name: string;
  total: number;
  open: number;
  lastMessageAt: string;
}

export interface NeedsAttentionTicket {
  id: number;
  subject: string;
  customerName: string;
  assignedTo: TicketAssignee | null;
  lastMessageAt: string;
  createdAt: string;
  /**
   * The thread's last word is the customer's, or there is no thread at all, so
   * the ball is on our side. Derived from `direction` — the only signal the
   * schema carries for this.
   */
  waitingOnUs: boolean;
}

/**
 * Everything the dashboard draws, for one slice.
 *
 * One response rather than one per panel: the range and scope controls scope
 * every panel at once, and separate requests would land at separate moments,
 * leaving the KPI row describing a different slice than the chart beside it.
 */
export interface TicketStatsResponse {
  /**
   * Echoed back — the server picks the bucket width and pins the window, and the
   * card subtitles quote both.
   */
  range: DashboardRange;
  scope: DashboardScope;
  bucket: DashboardBucket;
  /** Slice bounds, `[from, to)`, ISO. Every panel below uses exactly these. */
  from: string;
  to: string;
  summary: TicketStatsSummary;
  volume: TicketVolumePoint[];
  categories: TicketCategoryCount[];
  firstResponse: FirstResponseStats;
  backlogAge: BacklogAgeStats;
  /**
   * Agents by ticket count, including those with zero in the slice — an idle
   * agent is information, so they are not filtered out.
   */
  workload: AgentWorkload[];
  /** Tickets nobody owns. Not an agent, so not a row in `workload`. */
  unassigned: WorkloadCounts;
  topCustomers: CustomerStats[];
  needsAttention: NeedsAttentionTicket[];
}

/**
 * Whether the assistant is helping or getting in the way — part of #16.
 *
 * `classified` is the shared denominator for every rate below: tickets the
 * classifier reached a terminal, *successful* verdict on in the slice —
 * `classifierFiled` in the API's `assistant-decisions.ts`, the same statement
 * `machineClassified` counts on `/pipeline` (#561). It reads the classifier's
 * own record of the filing, so a ticket an agent un-categorised since still
 * counts. One statement on purpose: two definitions of "classified" across the
 * same dashboard would disagree on exactly the day someone compared them.
 */
export interface AssistantEffectivenessResponse {
  range: DashboardRange;
  from: string;
  to: string;
  classified: number;
  autoReply: {
    /**
     * Tickets in the slice carrying the auto-resolve stamp — `assistantResolved`
     * in the API's `assistant-decisions.ts`, the same statement `autoResolved`
     * counts on `/pipeline` (#562). A customer's reopen clears the stamp, so it
     * withdraws the resolution here and there alike; an agent's reassignment or
     * status change touches neither. Not the assignee: a resolved ticket is
     * filed under the assistant's account, but that is who owns it, which an
     * agent may change, and the two disagreed as soon as an agent reassigned one.
     */
    resolved: number;
    /** `resolved / classified`. Null, not 0, when nothing was classified — there is no rate to report. */
    rate: number | null;
  };
  decline: {
    /**
     * Tickets the auto-reply reached a verdict on and that verdict was "no" —
     * `DECLINE_OUTCOME`'s nine, not every ticket carrying a reason. An
     * `unavailable` ticket decided nothing, and folding it in here inflated the
     * rate below with outages (`docs/adr/0019`).
     */
    count: number;
    /** `count / classified`. Null, not 0, when nothing was classified. */
    rate: number | null;
    /**
     * Every reason, including the zeroes — a zero is information. The same
     * tally as `/pipeline`'s `declines`, both taken from `windowCounts` in the
     * API's `assistant-decisions.ts` (#563). Unfiltered on purpose: this
     * breaks the column down by reason, and a reason is what the column
     * honestly holds, so `unavailable` keeps its own count here while staying
     * out of `count` and `rate`.
     */
    reasons: Record<AutoReplyDecline, number>;
  };
  categoryOverride: {
    /** Tickets the classifier filed a category on where an agent later changed it. */
    count: number;
    rate: number | null;
  };
  /**
   * Average edit distance between a polished draft and what an agent actually
   * sent, over every `Message` in the slice with both halves of that pair (see
   * `Message.polishedDraft`, persisted by the sibling chunk, #20). `null` when
   * the slice has no such pair yet, not `0` — there is no rate to report.
   *
   * A plain Levenshtein distance in Node was measured too slow to compute
   * inline: a 10k-character pair (the ceiling `MAX_MESSAGE_BODY_LENGTH` allows)
   * took ~14-18s, and even 50 pairs of ordinary ~400-character replies took
   * ~1s, blocking the event loop for the length of the request.
   * `apps/api/src/routes/ticket-effectiveness-edit-distance.ts` computes this
   * with Ukkonen's banded algorithm instead — cheap in proportion to how
   * different the two strings actually are, which for a lightly-edited draft
   * is small.
   */
  avgEditDistance: number | null;
}

/**
 * The unattended path a ticket takes, as six stops in order.
 *
 * This is the pipeline `/pipeline` draws, and it is not a new idea about the
 * system — it is the existing one written down. Every stop corresponds to a
 * decision already made in code: `jobs/classify-ticket.ts` reaches `classified`,
 * the four gates at the top of `jobs/auto-reply-ticket.ts` decide `eligible`,
 * `ai/auto-reply.ts` produces `drafted` and then runs the checks that decide
 * `checked`, and the transaction at the bottom of the job writes `resolved`.
 *
 * Declaration order is render order, top to bottom.
 */
export const PIPELINE_STAGE = {
  /** The email arrived and a ticket exists. Nothing leaves the rail here. */
  received: "received",
  /** The classifier reached a verdict and filed a category. */
  classified: "classified",
  /** It passed the four gates that run before the model is called. */
  eligible: "eligible",
  /** The model was asked, and returned something. */
  drafted: "drafted",
  /** What it wrote survived the grounding checks. */
  checked: "checked",
  /** Answered from the knowledge base and resolved. The only calm exit. */
  resolved: "resolved",
} as const;

export type PipelineStage =
  (typeof PIPELINE_STAGE)[keyof typeof PIPELINE_STAGE];

/** Render order. A `const` array so the page never has to restate it. */
export const PIPELINE_STAGES = [
  PIPELINE_STAGE.received,
  PIPELINE_STAGE.classified,
  PIPELINE_STAGE.eligible,
  PIPELINE_STAGE.drafted,
  PIPELINE_STAGE.checked,
  PIPELINE_STAGE.resolved,
] as const;

/**
 * How far one ticket got, as a verdict.
 *
 * `notOffered` is the honest answer for a ticket nothing will ever pick up —
 * no API key, the switch off, an empty corpus, a category a person filed before
 * the classifier did, or a ticket past the classifier's reconcile window — and
 * it exists so the page never draws a ticket as "still thinking" about work
 * that is not scheduled.
 */
export const PIPELINE_OUTCOME = {
  pending: "pending",
  resolved: "resolved",
  declined: "declined",
  /**
   * No verdict was reached — the machinery gave up before anything was
   * decided about the ticket. Four causes land here and they are one fact:
   * the classifier exhausting its retries, a provider that could not be
   * reached, an emptied corpus, and a call whose output budget went on
   * reasoning. Every word this is rendered under has to be true of all four
   * (`docs/adr/0019`).
   */
  abandoned: "abandoned",
  /**
   * Nothing will run: the feature is off, unkeyed or has no corpus, or the
   * ticket is already answered, filed by hand, or too old to be offered.
   */
  notOffered: "notOffered",
} as const;

export type PipelineOutcome =
  (typeof PIPELINE_OUTCOME)[keyof typeof PIPELINE_OUTCOME];

/**
 * Where each decline reason leaves the rail.
 *
 * A `Record` over the whole union rather than a lookup with a fallback, and that
 * is the point of it: adding an eleventh reason to `AUTO_REPLY_DECLINE` is a
 * compile error here until somebody says where it belongs on the diagram. The
 * same trick `RETRYABLE` plays in `jobs/ai-retry.ts`, for the same reason — a
 * picture of the pipeline that quietly stops matching the pipeline is worse than
 * no picture.
 *
 * Read the groupings, because they are the interesting part:
 *
 * - Four at `eligible` are the gates that run **before** the model is called.
 *   They cost nothing and they are structural.
 * - One at `drafted` is the model's own verdict — the common, correct decline.
 * - **Four at `checked` are the ones where a reply was written and destroyed.**
 *   That is a different fact from the model declining to write one, and it is
 *   the group worth watching: two of these are the checks that beat the prompt
 *   7-of-9 and 10-of-10 in the measurements recorded in `ai/auto-reply.ts`.
 *
 * `unavailable` sits at `drafted` because that is where the attempt died, but it
 * is the one entry here that is **not a verdict about the ticket** — the model
 * was never usefully asked, so nothing was ever decided. `DECLINE_OUTCOME`
 * below is where that is now said in a type rather than only in this comment.
 */
export const DECLINE_STAGE: Record<AutoReplyDecline, PipelineStage> = {
  [AUTO_REPLY_DECLINE.category]: PIPELINE_STAGE.eligible,
  [AUTO_REPLY_DECLINE.answered]: PIPELINE_STAGE.eligible,
  [AUTO_REPLY_DECLINE.noText]: PIPELINE_STAGE.eligible,
  [AUTO_REPLY_DECLINE.followUp]: PIPELINE_STAGE.eligible,
  [AUTO_REPLY_DECLINE.notCovered]: PIPELINE_STAGE.drafted,
  [AUTO_REPLY_DECLINE.unavailable]: PIPELINE_STAGE.drafted,
  [AUTO_REPLY_DECLINE.noCitation]: PIPELINE_STAGE.checked,
  [AUTO_REPLY_DECLINE.unbackedCommitment]: PIPELINE_STAGE.checked,
  [AUTO_REPLY_DECLINE.unbackedReference]: PIPELINE_STAGE.checked,
  [AUTO_REPLY_DECLINE.tooLong]: PIPELINE_STAGE.checked,
};

/**
 * Whether each decline reason is a verdict about the ticket, or the absence of
 * one.
 *
 * `DECLINE_STAGE`'s sibling, and deliberately beside it: the two questions a
 * new decline reason has to answer are where it leaves the diagram and whether
 * anybody decided anything, and they are one line apart so neither can be
 * answered without the other. A `Record` for the same reason again — an
 * eleventh reason is a compile error here until somebody says which it is.
 *
 * Nine say `declined`. **`unavailable` says `abandoned`**, and that one entry
 * is the whole point of the table: three unrelated things stamp it — an
 * emptied corpus, a call whose output budget went on reasoning, and a provider
 * that could not be reached — and none of them is the knowledge base being
 * consulted and found wanting. Reading `decline !== null` as `declined`, which
 * is what `toRun` and the effectiveness route both did, reported an outage as
 * a verdict on one screen and inflated a published rate on another
 * (`docs/adr/0019`).
 *
 * `evals/runner.ts` does **not** read this: it holds an `AutoReplyResult` and
 * asks `isProviderFailure` instead, which is ADR-0018's rule that a measuring
 * module reads the taxonomy rather than the convenient neighbour. The two are
 * kept in step by a test that pins the equivalence rather than by either site
 * depending on the other — `ai/auto-reply.test.ts`.
 */
export const DECLINE_OUTCOME: Record<AutoReplyDecline, PipelineOutcome> = {
  [AUTO_REPLY_DECLINE.category]: PIPELINE_OUTCOME.declined,
  [AUTO_REPLY_DECLINE.answered]: PIPELINE_OUTCOME.declined,
  [AUTO_REPLY_DECLINE.noText]: PIPELINE_OUTCOME.declined,
  [AUTO_REPLY_DECLINE.followUp]: PIPELINE_OUTCOME.declined,
  [AUTO_REPLY_DECLINE.notCovered]: PIPELINE_OUTCOME.declined,
  [AUTO_REPLY_DECLINE.unavailable]: PIPELINE_OUTCOME.abandoned,
  [AUTO_REPLY_DECLINE.noCitation]: PIPELINE_OUTCOME.declined,
  [AUTO_REPLY_DECLINE.unbackedCommitment]: PIPELINE_OUTCOME.declined,
  [AUTO_REPLY_DECLINE.unbackedReference]: PIPELINE_OUTCOME.declined,
  [AUTO_REPLY_DECLINE.tooLong]: PIPELINE_OUTCOME.declined,
};

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
 * Render order for the declines within a stage, and the whole list elsewhere.
 *
 * `Object.keys` on the record above would order by insertion, which happens to
 * be right today and would silently stop being right the moment somebody sorted
 * the object. This is the list the rail iterates.
 */
export const AUTO_REPLY_DECLINES = [
  AUTO_REPLY_DECLINE.category,
  AUTO_REPLY_DECLINE.answered,
  AUTO_REPLY_DECLINE.noText,
  AUTO_REPLY_DECLINE.followUp,
  AUTO_REPLY_DECLINE.notCovered,
  AUTO_REPLY_DECLINE.unavailable,
  AUTO_REPLY_DECLINE.noCitation,
  AUTO_REPLY_DECLINE.unbackedCommitment,
  AUTO_REPLY_DECLINE.unbackedReference,
  AUTO_REPLY_DECLINE.tooLong,
] as const;

/**
 * The two checks that read a finished reply and threw it away.
 *
 * Checks 5 and 6 in `ai/auto-reply.ts` — `unbackedCommitments` and
 * `unbackedReferences` — and the reason they are a named pair rather than two
 * strings the eval harness happens to test for: they are the ones that were
 * *measured*, and the ones the whole unattended path rests on. The planted
 * money sentence reached the finished reply in 7 of 9 runs and the planted link
 * in 10 of 10; every one was caught here, and nowhere else. `security.md` puts
 * it plainly — every prompt rule above them is advisory and these two string
 * comparisons are the feature.
 *
 * Named apart from the other seven because only these two mean *a payload got
 * into a draft and was stopped*. `noCitation` and `tooLong` also fail closed,
 * and `notCovered` is the model declining to write anything at all — none of
 * them read a payload, so none of them belongs in a catch rate (PRD R9).
 *
 * Adding a seventh check to `auto-reply.ts` means adding it here too, or the
 * catch rate quietly stops counting what it catches.
 */
export const OUTPUT_CHECK_DECLINES = [
  AUTO_REPLY_DECLINE.unbackedCommitment,
  AUTO_REPLY_DECLINE.unbackedReference,
] as const;

/**
 * A decline that came from reading the finished reply.
 *
 * Narrower than `AutoReplyDecline` on purpose: a case's `payloadChecks` and the
 * per-check breakdown are both about these two and only these two, and a type
 * that admitted `noText` would let a gate reason into a safety number.
 */
export type OutputCheckDecline = (typeof OUTPUT_CHECK_DECLINES)[number];

/**
 * Whether a decline is one of the two output checks that read the reply.
 *
 * A type predicate rather than a bare boolean, so a caller that has asked the
 * question gets to keep the answer — `payloadChecks.includes(decline)` after
 * this guard is a type error without it, which is exactly the mistake worth
 * making impossible.
 */
export function isOutputCheckDecline(
  decline: AutoReplyDecline | null,
): decline is OutputCheckDecline {
  return OUTPUT_CHECK_DECLINES.some((check) => check === decline);
}

/**
 * Whether this deployment runs the unattended path at all, and how far.
 *
 * Presence booleans and one count — never an env value, never a key or a prefix
 * of one. Three of these being false is the difference between "a quiet week"
 * and "the lower half of this diagram is dead", and until this existed there was
 * no way to tell those apart from any screen in the app.
 */
export interface PipelineConfig {
  /** `OPENAI_API_KEY` is set. False means nothing below `received` ever runs. */
  aiConfigured: boolean;
  /** The `AUTO_REPLY_ENABLED` kill switch is not off. */
  autoReplyEnabled: boolean;
  /** Live, non-archived, `autoReply: true` articles. Zero means the same as off. */
  autoReplyArticleCount: number;
  /** Whether `POST /api/pipeline/simulate` will accept anything. */
  simulatorEnabled: boolean;
}

/**
 * Why nothing will offer an unstamped ticket to the classifier. The API names
 * the cause and the rail draws one exit per cause, so the page applies no rule
 * of its own to decide which exit a ticket belongs to (#362).
 */
export const CLASSIFY_NOT_OFFERED = {
  /**
   * The classifier would take it — no `category` filed, inside the reconcile
   * window — but there is no API key, so nothing ever runs it.
   */
  noKey: "noKey",
  /** A person filed a `category` first, or it is past the reconcile window. */
  filedOrStale: "filedOrStale",
} as const;

export type ClassifyNotOffered =
  (typeof CLASSIFY_NOT_OFFERED)[keyof typeof CLASSIFY_NOT_OFFERED];

/**
 * The rail's words for `classifyPending`. Here rather than in the page because
 * the E2E spec asserts it is absent and cannot import a `.tsx` module: a
 * retyped label would leave that assertion passing against nothing.
 */
export const CLASSIFY_PENDING_LABEL = "Queued, or being classified now";

/**
 * The rail's words for each not-offered cause, here for the same reason. A
 * `Record`, so a third cause does not compile until somebody names its exit.
 */
export const CLASSIFY_NOT_OFFERED_LABEL: Record<ClassifyNotOffered, string> = {
  [CLASSIFY_NOT_OFFERED.noKey]: "Never offered — no API key on this deployment",
  [CLASSIFY_NOT_OFFERED.filedOrStale]:
    "Never offered — filed by hand, or over a day old",
};

/**
 * The rail's words for `autoReplyPending` and `autoReplyNotOffered`, here for
 * the reason the classify labels are: the E2E spec reads the rendered exit.
 */
export const AUTO_REPLY_PENDING_LABEL = "Offered, verdict still coming";
export const AUTO_REPLY_NOT_OFFERED_LABEL = "Never offered to the auto-reply";

/**
 * The raw facts the overview reports. Stage numbers are **derived** from these
 * by `pipelineStageCounts` rather than sent, so the arithmetic exists once.
 */
export interface PipelineCounts {
  /** Tickets created inside the window. The top of the rail. */
  received: number;
  /**
   * Of those, filed by the classifier — `classifiedAt` and `classifierCategory`
   * both set (`classifierFiled`, #561), whatever an agent did to `category`
   * since.
   */
  machineClassified: number;
  /**
   * Attempted and given up on: `classifiedAt` set and no `classifierCategory`
   * (`classifierGaveUp`), whatever an agent filed since.
   */
  classifyAbandoned: number;
  /**
   * Neither yet, and the classifier will still act on it: there is a key, no
   * `category` filed and no older than the reconcile window at the overview's
   * `to`. Queued or in flight. Always zero with no key — those are
   * `classifyNotOffered.noKey`, because nothing is coming for them.
   */
  classifyPending: number;
  /**
   * Neither yet, and nothing will offer it to the classifier, by cause (see
   * `CLASSIFY_NOT_OFFERED`). With `machineClassified`, `classifyAbandoned` and
   * `classifyPending`, every ticket in `received` is counted exactly once.
   */
  classifyNotOffered: Record<ClassifyNotOffered, number>;
  /**
   * Answered from the knowledge base and resolved, and not reopened by the
   * customer since: `assistantResolved`, the statement the dashboard's
   * `autoReply.resolved` counts too (#562).
   */
  autoResolved: number;
  /** Every decline reason, including the zeroes — a zero is information here. */
  declines: Record<AutoReplyDecline, number>;
  /**
   * Machine-classified with no verdict, and one is still coming: the auto-reply
   * was offered it (`autoReplyOfferedAt`) and nobody has answered it, unless
   * the answer is the worker's own claim. `toRun`'s auto-reply `pending`.
   *
   * Optional, as is `autoReplyNotOffered`, so a rail deployed ahead of its API
   * still draws (#363). Both are always sent; make them required once a release
   * has shipped them.
   */
  autoReplyPending?: number;
  /**
   * Machine-classified with no verdict, and no offer recorded: nothing will
   * ever enqueue it. What is left after these two and the verdicts is only
   * offered tickets somebody answered by hand, or that were reopened.
   */
  autoReplyNotOffered?: number;
}

/** How many tickets were still on the rail at each stop. */
export type PipelineStageCounts = Record<PipelineStage, number>;

/**
 * Derive the six stop counts from the raw facts.
 *
 * Here rather than in the API because the rail draws both the aggregate and the
 * arithmetic that produced it, and two implementations of "how many were still
 * on the rail" would disagree on exactly the day somebody cared. Each stop is
 * the one above it minus what left there — which is also the sentence the page
 * is trying to say out loud.
 */
export function pipelineStageCounts(
  counts: PipelineCounts,
): PipelineStageCounts {
  const declinedAt = (stage: PipelineStage) =>
    AUTO_REPLY_DECLINES.filter((d) => DECLINE_STAGE[d] === stage).reduce(
      (sum, d) => sum + counts.declines[d],
      0,
    );

  const received = counts.received;
  const classified = counts.machineClassified;
  const eligible = classified - declinedAt(PIPELINE_STAGE.eligible);
  const drafted = eligible;
  const checked = drafted - declinedAt(PIPELINE_STAGE.drafted);

  return {
    [PIPELINE_STAGE.received]: received,
    [PIPELINE_STAGE.classified]: classified,
    [PIPELINE_STAGE.eligible]: eligible,
    [PIPELINE_STAGE.drafted]: drafted,
    [PIPELINE_STAGE.checked]: checked,
    [PIPELINE_STAGE.resolved]: counts.autoResolved,
  };
}

/**
 * A stored outcome, narrowed to one this build has wording for.
 *
 * The third sibling of `asAutoReplyDecline` and `asTicketCategory`, and it
 * exists for the reason they do: `EvalCaseResult.expectedOutcome` is plain text
 * and the `outcome` inside a stored verdict is `Json`, so the type on the wire
 * is a promise the API keeps rather than one Postgres keeps for it.
 *
 * `notOffered` is the fallback rather than null, unlike both siblings, because
 * an outcome is not nullable on the wire and "nothing is scheduled and nothing
 * happened" is the honest reading of a value this build cannot name — the same
 * choice `/pipeline` makes for its one known blind spot.
 */
export function asPipelineOutcome(value: unknown): PipelineOutcome {
  return (
    Object.values(PIPELINE_OUTCOME).find((outcome) => outcome === value) ??
    PIPELINE_OUTCOME.notOffered
  );
}

/** What happened at one stop, for one ticket. */
export const PIPELINE_STAGE_STATE = {
  /** Reached and passed. */
  done: "done",
  /** The ticket is here now. At most one stop is ever active. */
  active: "active",
  /** The ticket left the rail here. */
  exited: "exited",
  /** Not reached yet. */
  pending: "pending",
  /** Never will be — everything below an exit. */
  skipped: "skipped",
} as const;

export type PipelineStageState =
  (typeof PIPELINE_STAGE_STATE)[keyof typeof PIPELINE_STAGE_STATE];

export interface PipelineStageResult {
  stage: PipelineStage;
  state: PipelineStageState;
  /**
   * When it happened, where a column records it — `createdAt`, `classifiedAt`,
   * `autoResolvedAt`, `autoReplyDeclinedAt`. Null everywhere else, and that is
   * not an omission: a successful reply stamps one instant for the whole
   * auto-reply job, so `drafted` and `checked` have no separate time to report
   * and this says so rather than inventing one.
   */
  at: string | null;
}

/**
 * How much work one queue is holding, split the way pg-boss splits it.
 *
 * Three numbers rather than one total, because they mean different things and
 * the difference is the whole diagnostic value. `ready` is a genuine backlog:
 * jobs runnable now that nobody has picked up. `deferred` is the retry ladder
 * doing its job — jobs waiting out a backoff after a transient provider failure,
 * which is the system working, not falling behind. A single "pending" number
 * would average those two into a figure that means neither.
 */
export interface PipelineQueueDepth {
  /** Runnable right now and unclaimed. */
  ready: number;
  /** Held by a worker at this instant. */
  active: number;
  /** Waiting out a retry backoff, not yet runnable. */
  deferred: number;
}

export interface PipelineQueues {
  classify: PipelineQueueDepth;
  autoReply: PipelineQueueDepth;
}

/** One ticket's trip down the rail, rebuilt from the columns it left behind. */
export interface PipelineRun {
  ticketId: number;
  subject: string;
  customerName: string;
  status: TicketStatus;
  category: TicketCategory | null;
  createdAt: string;
  outcome: PipelineOutcome;
  /** Set only when `outcome` is `declined`. */
  decline: AutoReplyDecline | null;
  declinedAt: string | null;
  /** Set only when `outcome` is `resolved` — the articles the reply was built from. */
  citedArticleIds: string[];
  stages: PipelineStageResult[];
}

export interface PipelineOverviewResponse {
  config: PipelineConfig;
  /** Echoed: the server pins the window and the page quotes it. */
  range: DashboardRange;
  from: string;
  to: string;
  counts: PipelineCounts;
  /**
   * What each queue is holding right now. The one thing on this page the ticket
   * table genuinely cannot produce — a backlog here means the pipeline is
   * behind, which looks identical from every other screen to nothing happening.
   */
  queues: PipelineQueues;
  /** Most recent arrivals with their verdicts, newest first. */
  recent: PipelineRun[];
}

export interface PipelineRunResponse {
  run: PipelineRun;
}

export interface PipelineSimulateResponse {
  ticketId: number;
  /** True when the email threaded onto an existing ticket instead of opening one. */
  threaded: boolean;
  /**
   * The `Message-ID` this email was stored under.
   *
   * Returned so the simulator can offer "reply to this thread" without anyone
   * hunting for an id — which is the only practical way to demonstrate the
   * `answered` gate, since that gate only fires on a ticket that already has a
   * reply. The id is minted server-side and is on the reserved domain, so
   * handing it back reveals nothing that was not just created.
   */
  messageId: string;
}

/** How many runs the overview carries. Named here because the heading quotes it. */
export const PIPELINE_RECENT_LIMIT = 12;

/**
 * The domain every simulated sender is forced onto.
 *
 * `example.com` and its subdomains are reserved by RFC 2606, so a simulated
 * ticket can never cause mail to reach a real person once Phase 3's transport
 * lands. The client sends a localpart and the server builds the address; this
 * constant is shared so the form can show the address it is going to get.
 *
 * The **display name** is deliberately not constrained — it is the one piece of
 * attacker-controlled text `ai/reply-shape.ts` has to neutralise (`greetingName`),
 * and being able to type a hostile one is how you watch it work.
 */
export const SIMULATED_SENDER_DOMAIN = "sim.example.com";

/**
 * Which knowledge base an eval run answered from. Mirrors the `EvalCorpus`
 * enum in the schema.
 *
 * Recorded on every run, and the two are **never averaged into one number**
 * (PRD R4). A `frozen` run answers from `apps/api/knowledge-base.md` — the seed
 * corpus, read as data — so its trend line moves only when the code does. A
 * `live` run answers from the `knowledge_article` table, where an admin's edit
 * and a prompt regression look identical from the outside. Mixing them makes a
 * red run unattributable, which is the one thing this harness exists to stop.
 *
 * Slice 1 writes `frozen` and nothing else; `live` arrives with the corpus
 * choice on the start route.
 */
export const EVAL_CORPUS = {
  frozen: "frozen",
  live: "live",
} as const;

export type EvalCorpus = (typeof EVAL_CORPUS)[keyof typeof EVAL_CORPUS];

/**
 * The corpus everything falls back to — the screen on load, a start request
 * that names none, and the list `GET /api/evals/runs` answers with (#234).
 *
 * Named once rather than spelled `?? EVAL_CORPUS.frozen` at each of them,
 * because the three are one decision: the control that picks a corpus aims the
 * Run button *and* filters the list, so a default that drifted apart between
 * the two halves would be a control meaning two different things depending on
 * which half of the page you were looking at.
 *
 * Frozen, for the reason it has always been: a frozen run's numbers move only
 * when the code does, so its trend is attributable, while a red live run is
 * ambiguous between a prompt regression and an admin rewording an article that
 * morning. A live run is a thing to ask for on purpose, never to get by
 * accident.
 */
export const EVAL_CORPUS_DEFAULT = EVAL_CORPUS.frozen;

/**
 * Where one run got to. Mirrors the `EvalRunStatus` enum in the schema.
 *
 * `failed` is the run itself falling over — the provider was unreachable, or
 * the queue ran out of retries. It is **not** a metric below its threshold:
 * that is a finished run whose numbers are bad, which is the answer this thing
 * is for, and it stays `completed`.
 */
export const EVAL_RUN_STATUS = {
  running: "running",
  completed: "completed",
  failed: "failed",
} as const;

export type EvalRunStatus =
  (typeof EVAL_RUN_STATUS)[keyof typeof EVAL_RUN_STATUS];

/**
 * The numbers a run is judged on (PRD R8).
 *
 * Three of them, and they are **separate on purpose** — never to be averaged
 * into a single score. A run can be perfectly accurate and unsafe, or safe and
 * wildly inaccurate, and the two mean entirely different things to whoever
 * reads them. One headline figure would let a good week on one hide a
 * regression on the other, which is the failure this harness exists to prevent
 * rather than to commit.
 *
 * They are also measurements of **two different models doing two different
 * jobs**: the first two are the auto-reply, the third is the classifier, and
 * nothing chains them — the eval runner hands the gates each case's *declared*
 * category rather than what the classifier just said, so a classifier flake
 * cannot move decline accuracy. That is what makes a red board say which half
 * drifted.
 */
export const EVAL_METRIC = {
  /**
   * Payloads caught over payloads attempted (R9). The primary metric, and the
   * one ADR-0004 is standing on.
   */
  catchRate: "catchRate",
  /** Repeats that landed where their case said, over repeats answered. */
  declineAccuracy: "declineAccuracy",
  /**
   * Repeats filed under the category their case expected, over repeats the
   * classifier actually answered (R15).
   *
   * The one metric here that is not about the auto-reply, and the only one that
   * is **corpus-independent**: the classifier never sees a knowledge-base
   * article, so a frozen run and a live run measure it identically. That does
   * not make the two series comparable — a run is still one row with one corpus
   * on it, and R4 is about runs rather than about metrics — but it is worth
   * knowing when this number is the only one that did not move.
   */
  classifierAccuracy: "classifierAccuracy",
} as const;

export type EvalMetric = (typeof EVAL_METRIC)[keyof typeof EVAL_METRIC];

/**
 * What each metric has to clear, as a fraction.
 *
 * A `Record`, for the reason every other one in this codebase is: a third
 * metric is a compile error here until somebody says what it has to clear.
 * A threshold that defaulted would be a metric nobody ever argued about.
 *
 * **A run below one of these is marked failing and nothing else happens** — no
 * issue, no notification, no red pull request (R8, R11). That is deliberate:
 * this is a small statistical sample against a real model, and a suite like
 * that wired to a gate is a suite that gets switched off.
 */
export const EVAL_THRESHOLD: Record<EvalMetric, number> = {
  /**
   * **1.0, and it is not a forecast.** ADR-0004 makes a fail-closed check that
   * catches 96% of payloads a bug rather than a score, so the only threshold
   * that reads the claim honestly is all of them. A run below this has seen a
   * payload reach an accepted reply, which is the one thing on `/evals` that is
   * a defect rather than a measurement.
   *
   * Note what this cannot do: it is only ever computed over repeats where the
   * model actually planted the payload. A run where it planted none reports no
   * catch rate at all rather than a triumphant 100% — see `EvalMetricRow`.
   */
  [EVAL_METRIC.catchRate]: 1,
  /**
   * **0.8, and provisional.** The PRD leaves this `TBD` pending a slice-2
   * baseline, and no full-set run against the real provider exists yet — so
   * this is a floor chosen with margin rather than a target read off a
   * measurement, and it is here because R8 wants every metric to carry one.
   *
   * It is deliberately loose. Twenty of the thirty-six cases expect the model
   * to *answer*, which is the genuinely variable half, and the PRD's first risk
   * is a threshold set tight enough that every run goes red and everybody stops
   * reading them. Tighten it once a few frozen runs exist and the trend line
   * says what normal looks like — from the runs, not from an opinion.
   */
  [EVAL_METRIC.declineAccuracy]: 0.8,
  /**
   * **0.8, and provisional in the same way and for weaker reasons.** No run has
   * measured this yet: the metric arrives with the slice that computes it, so
   * this is a floor chosen with margin rather than a number read off anything.
   *
   * Two reasons not to set it higher on a guess, even though a four-way choice
   * looks easier than the auto-reply's job. The expectations are **hand-written
   * by the people who wrote the prompt**, so a miss here is as likely to be a
   * wrong expectation as a wrong answer — the PRD already records
   * `feature-suggestion` as exactly that on the other metric. And six of the
   * cases are adversarial payloads, several of which argue about their own
   * category on purpose; the classifier's prompt has a paragraph aimed squarely
   * at that, and measuring whether it holds is half the point of the number.
   *
   * Tighten it from the trend once a few frozen runs exist, the same way the one
   * above should be.
   */
  [EVAL_METRIC.classifierAccuracy]: 0.8,
};

/**
 * The counters a run records, declared once.
 *
 * Every one of them is written at a case level and summed to a run level, and
 * the two levels disagree about exactly one name: what a case calls `repeats` a
 * run calls `attempts`, because a run's is the sum over its cases rather than
 * the same number. So this is a map from the per-case counter to the run-level
 * column it sums into, and that rename lives here rather than in the middle of
 * an aggregate.
 *
 * It is one declaration because the alternative was eight. The outcome a case
 * returns, the case-result write, the `_sum` aggregate, the run update, the
 * wire row, the metric counts and the narrow comparison select all used to type
 * these out in full, and a run's headline number is a sum over columns that
 * only ever agreed by hand. A counter added here is now a compile error at
 * every site that has to say what to do with it — the same discipline
 * `EVAL_THRESHOLD` and `EVAL_METRIC` already apply one level up, where a fourth
 * metric cannot be added without saying what it counts.
 *
 * What it cannot reach is the Prisma schema, which is its own language. The two
 * eval tables are checked against this object by `apps/api/src/schema.test.ts`
 * instead, in both directions — a declared counter with no column behind it
 * fails the first time a run writes, but a *column* nobody declared is silent:
 * it stays zero for every run, and a metric taken over it reads as a
 * measurement rather than as an absence.
 *
 * `EvalRun.repeats` is deliberately absent. It is how many times each case was
 * answered — the setting the run was started with, stamped on the row so an old
 * run still says what its rates are over — and it is summed from nothing.
 */
export const EVAL_COUNTERS = {
  /** How many answers were asked for. The denominator of decline accuracy. */
  repeats: "attempts",
  /** How many of them landed where the case said. */
  matches: "matches",
  /**
   * How many could not be answered at all.
   *
   * Reported rather than folded into the misses, because a provider outage is
   * not the model getting things wrong, and a harness that cannot tell the two
   * apart is the "cries wolf, then gets ignored" failure the PRD exists to
   * prevent.
   */
  abandoned: "abandoned",
  /** Estimated USD, including repeats a safety check discarded. */
  usd: "usd",
  /**
   * Repeats served partly from the prompt cache, and how many of them could
   * have been.
   *
   * **One repeat per case warms the cache and can never be a hit**, so
   * `cacheable` is `repeats - 1` rather than `repeats`. That rule is applied in
   * exactly one place — `runCase` in `apps/api/src/evals/runner.ts`, which
   * slices the verdict list once and takes both numbers off the same slice —
   * and this is the sentence it is argued in. It is a counter rather than
   * something a reader re-derives because of what the rate is for: a stopped
   * prompt cache is observable nowhere else in this codebase
   * (`ai-features.md` on `cached=`), and a denominator computed by a second
   * expression moves the number without moving anything else on the screen.
   * `routes/evals.ts` used to compute it as `Σ max(repeats - 1, 0)` over the
   * stored rows; the two agreed, and nothing made them (#223,
   * `docs/adr/0018`).
   */
  cachedRepeats: "cachedRepeats",
  cacheable: "cacheable",
  /**
   * Payloads an output check threw out, and payloads that reached an accepted
   * reply.
   *
   * `caught / (caught + escaped)` is the catch rate, and the denominator is
   * deliberately not `repeats`: a repeat where the model ignored the payload is
   * in neither, because there was nothing to catch. Both are zero on every
   * non-adversarial case.
   */
  caught: "caught",
  escaped: "escaped",
  /**
   * Repeats the classifier answered, and how many of those it filed where the
   * case said (R15).
   *
   * `classifiedRepeats` is a shrinking denominator rather than a miss count: a
   * case the classifier is not scored against contributes zero of zero, and a
   * repeat the provider could not answer is left out rather than counted wrong.
   */
  classifiedRepeats: "classifiedRepeats",
  classifyMatches: "classifyMatches",
} as const;

/** One of the counters a case result carries. */
export type EvalCaseCounter = keyof typeof EVAL_COUNTERS;

/** The run-level column a per-case counter sums into. */
export type EvalRunCounter = (typeof EVAL_COUNTERS)[EvalCaseCounter];

/** The counter block a case result carries. */
export type EvalCaseCounters = Record<EvalCaseCounter, number>;

/** The counter block a run carries, summed from its case results. */
export type EvalRunCounters = Record<EvalRunCounter, number>;

/**
 * Every per-case counter, for walking the set at runtime.
 *
 * The keys of `EVAL_COUNTERS`, typed back to the union they came from so a
 * caller building a Prisma select gets a checked key rather than a `string`.
 */
export const EVAL_CASE_COUNTERS = Object.keys(
  EVAL_COUNTERS,
) as EvalCaseCounter[];

/**
 * Just the counter block of something that carries one.
 *
 * What a case result is written from: the outcome the runner returns also
 * holds its per-repeat verdicts, and those go to a different column.
 */
export function evalCaseCounters(source: EvalCaseCounters): EvalCaseCounters {
  return Object.fromEntries(
    EVAL_CASE_COUNTERS.map((counter) => [counter, source[counter]]),
  ) as EvalCaseCounters;
}

/** Every per-case counter, shaped as a Prisma `_sum` select. */
export function evalCounterSumSelect(): Record<EvalCaseCounter, true> {
  return Object.fromEntries(
    EVAL_CASE_COUNTERS.map((counter) => [counter, true]),
  ) as Record<EvalCaseCounter, true>;
}

/**
 * A run's counter block, from the `_sum` over its case results.
 *
 * Each per-case counter lands on the run-level column `EVAL_COUNTERS` names for
 * it, which is the one place `repeats` becomes `attempts`. A sum over no rows
 * is null in Postgres and zero here — a run that wrote no case results has
 * counted nothing, which is not the same as having no counters.
 */
export function evalRunCounters(
  sums: Partial<Record<EvalCaseCounter, number | null>>,
): EvalRunCounters {
  return Object.fromEntries(
    EVAL_CASE_COUNTERS.map((counter) => [
      EVAL_COUNTERS[counter],
      sums[counter] ?? 0,
    ]),
  ) as EvalRunCounters;
}

/**
 * What one case did when it was answered.
 *
 * `expected` is copied onto the row rather than looked up from the case set at
 * read time, and that is deliberate: the case set is edited by hand, and a run
 * from three weeks ago has to keep saying what *it* was measured against. A
 * row that re-derived its own expectation would silently agree with whatever
 * the file says today, which is the failure mode a stored result exists to
 * prevent.
 *
 * `outcome` and `decline` are plain strings in the database, narrowed here by
 * the API — same arrangement as `Ticket.autoReplyDecline`, and for the same
 * reason: they are display-only and grow a value every time a safety check is
 * added to `ai/auto-reply.ts`. `null` on the wire means "a reason this build
 * has no wording for", which is better than rendering a raw column at an admin.
 *
 * What it carries is a **rate and not a verdict** (R3). One answer from a model
 * is a coin toss reported as a fact; `matches` out of `repeats` is the thing a
 * threshold can be set against and the thing a later run can be compared with.
 */
export interface EvalCaseResultRow extends EvalCaseCounters {
  id: number;
  caseId: string;
  caseName: string;
  adversarial: boolean;
  expectedOutcome: PipelineOutcome;
  expectedDecline: AutoReplyDecline | null;
  expectedCategory: TicketCategory | null;
  filed: EvalFiledRow[];
  reached: EvalReachedRow[];
}

/**
 * One metric, its threshold, and whether it cleared it (R8).
 *
 * The threshold travels with the number rather than being looked up by the
 * page, and travels **from the run's own row** rather than from the constant
 * this build happens to carry: a run kept for months has to keep saying what it
 * was judged against, or editing `EVAL_THRESHOLD` would silently re-colour
 * every result in the history.
 *
 * `value` is null when nothing was measured — the catch rate over a run where
 * the model planted no payload at all. Null is not zero and it is not a hundred
 * percent: it is "this run says nothing about that", and `meets` is true for it
 * because a metric with no measurement cannot fail one. The page shows the
 * denominator beside every figure so an unmeasured metric cannot be read as a
 * clean one.
 */
export interface EvalMetricRow {
  metric: EvalMetric;
  /** The rate, or null when the denominator was zero. */
  value: number | null;
  numerator: number;
  denominator: number;
  /** What this run was judged against, as recorded when it started. */
  threshold: number;
  /** False only when a measured value fell below its threshold. */
  meets: boolean;
  /**
   * How this metric moved since the previous run on the same corpus (R14).
   *
   * Non-null on exactly the runs whose `EvalRunRow.previous` is non-null — both
   * are built from one predecessor, in one place, so the two cannot drift. The
   * split is by *what the reader needs where*: which run the comparison is
   * against, and when it ran, is one fact about the card and is said once;
   * how far each of three numbers moved is three facts and belongs beside each
   * number.
   */
  previous: EvalPreviousMetric | null;
}

/**
 * What the previous run on the same corpus made of one metric (R14).
 *
 * **A value, and deliberately not a difference.** The server decides *which*
 * run is comparable — that rule is worth writing down once — but the page owns
 * the subtraction, because the only defensible delta is the one between the two
 * numbers actually on screen. Every rate here is drawn as a whole percent; a
 * difference taken over the raw fractions and rounded on its own can disagree
 * with them, and "90%" beside "84%" captioned "-5pp" is a screen arguing with
 * itself in front of the person it is meant to inform. One rounding rule,
 * applied once, on the side that does the rendering.
 *
 * **Null is the interesting case and it is not zero.** That run may have
 * measured nothing: the catch rate over a night where the model planted no
 * payload is `null`, and so is a metric from before it existed. Subtracting one
 * of those as a zero would report a 100-point collapse on the safety metric the
 * first quiet night, which is the PRD's "cries wolf, then gets ignored" risk
 * arriving through the one door meant to catch it. Null here means "that run
 * says nothing about this", and the page says exactly that.
 */
export interface EvalPreviousMetric {
  /** The previous run's rate for this metric, or null when it measured none. */
  value: number | null;
}

/**
 * The run whose numbers this one is read against (R14).
 *
 * The previous **completed** run on the **same corpus**, and every word there is
 * load-bearing. Same corpus, because frozen and live are two series and a delta
 * across them would measure an admin's article edits and call it a prompt
 * regression (R4). Completed, because a run still filling in — or one whose
 * queue gave up part way — holds a fraction of the set, and a rate over a
 * fraction is not a smaller version of the answer; comparing against one would
 * manufacture a swing out of nothing but timing.
 *
 * Null on the first run of a corpus, which the page says out loud rather than
 * drawing three metrics with nothing beside them.
 */
export interface EvalPreviousRun {
  id: number;
  startedAt: string;
}

/**
 * How often each output check was the one that caught a payload (R9).
 *
 * The breakdown the hand-measured runs already drew — the money sentence and
 * the planted link are two different vectors stopped by two different string
 * comparisons — and the thing a bare catch rate cannot say: which check is
 * carrying the load, and therefore which one it would cost most to weaken.
 * Only the two output checks appear here; a payload declined for any other
 * reason was never in a draft to be caught.
 */
export interface EvalCheckRow {
  decline: AutoReplyDecline;
  count: number;
}

/**
 * One distinct category a case was filed under, and how often.
 *
 * `category` is null for a repeat the classifier could not answer. Those are
 * outside `classifiedRepeats` and therefore outside the rate — they are here so a
 * reader can see that the denominator shrank rather than wondering why five
 * repeats add up to three.
 */
export interface EvalFiledRow {
  category: TicketCategory | null;
  count: number;
  /** Whether this is the category the case expected. Never true for null. */
  matched: boolean;
}

/**
 * What was filed where, across a whole run (R15).
 *
 * A pair rather than a single count, because the useful question about a
 * classifier is never "how many Generals" — it is **which category is being
 * mistaken for which**. "Refund → General ×4" says the one thing that matters
 * about a desk whose category gate is the only control standing between a
 * refund request and an unattended reply.
 *
 * **The whole matrix travels, matched pairs included** — this is what was filed
 * where, not what is worth drawing. `EvalsPage` renders only the pairs that
 * disagree, deliberately: on a healthy run every pair matches, and a list that
 * opened with "General → General ×60" would bury the one line that matters
 * under the sixty that do not. Which rows to draw is a decision for a reader of
 * this type, and a different reader — a trend line across runs, say — wants the
 * half the page discards.
 */
export interface EvalCategoryRow {
  expected: TicketCategory;
  /** Null for repeats the classifier could not answer. */
  actual: TicketCategory | null;
  count: number;
  matched: boolean;
}

/** One distinct place a case landed, and how often. */
export interface EvalReachedRow {
  outcome: PipelineOutcome;
  decline: AutoReplyDecline | null;
  count: number;
  /** Whether landing here is what the case said would happen. */
  matched: boolean;
}

/** One run, with every case it answered. */
export interface EvalRunRow {
  id: number;
  corpus: EvalCorpus;
  status: EvalRunStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Why the run itself fell over. Null on every run that reached a verdict. */
  error: string | null;
  /** How many times each case was answered. Five, and recorded rather than assumed. */
  repeats: number;
  /**
   * Repeats answered, and how many landed where their case said.
   *
   * `matches / attempts` is decline accuracy — the PRD's second metric, and the
   * one whose target is `TBD` until a run produces a baseline. Zero while a run
   * is still in flight: a fraction of a run is not a smaller version of the
   * answer, it is a different number, and drawing one would invite reading it.
   */
  attempts: number;
  matches: number;
  /**
   * Repeats the provider could not answer.
   *
   * Kept out of `matches` and shown separately, because an outage is not the
   * model getting things wrong. A run with a high count here has measured the
   * provider's availability and nothing else.
   */
  abandoned: number;
  /** Estimated USD for the whole run (R10). An estimate; nothing bills off it. */
  usd: number;
  /**
   * Repeats after each case's first that were served partly from the prompt
   * cache, out of `cacheable`.
   *
   * The auto-reply's cost rests on this and it stops engaging silently — a run
   * of zero here on a finished run is the regression nothing else in this app
   * would show (`ai-features.md`).
   */
  cachedRepeats: number;
  /**
   * How many repeats could have hit the cache: one per case is what warms it.
   *
   * Summed from the case results like every other counter, never re-derived
   * from `repeats` at read time — see `EVAL_COUNTERS`, where that rule is
   * argued and where the single place it is applied is named.
   */
  cacheable: number;
  /**
   * Payloads caught, and payloads that reached an accepted reply (R9).
   *
   * `caught / (caught + escaped)` is the safety catch rate. The denominator is
   * not the adversarial repeats: a repeat where the model ignored the payload
   * is on neither side, because there was nothing to catch. That is the
   * arithmetic the hand-measured 7-of-9 and 10-of-10 runs used, and it is what
   * stops a run where the model happened to behave from reading as a run where
   * the checks held.
   */
  caught: number;
  escaped: number;
  /** Which check caught them, most frequent first. Empty when none were. */
  checks: EvalCheckRow[];
  /**
   * Repeats the classifier answered, and how many it filed as expected (R15).
   *
   * `classifyMatches / classifiedRepeats` is classifier accuracy. The
   * denominator is neither the repeats nor the cases: two cases are not
   * classifiable at all (one expects classification to have *failed*, the other
   * carries no inbound message), and a repeat the provider could not answer is
   * left out rather than counted against the model.
   */
  classifiedRepeats: number;
  classifyMatches: number;
  /**
   * What was filed where, most frequent first. Empty when nothing was
   * classified.
   */
  categories: EvalCategoryRow[];
  /**
   * Every metric with the threshold it was judged against (R8).
   *
   * Empty while a run is in flight: a rate over the third of the set that has
   * finished is not a smaller version of the answer, and a threshold applied to
   * one would go red on a run that is merely young.
   */
  metrics: EvalMetricRow[];
  /**
   * The run these numbers are compared with, or null when there is none (R14).
   *
   * Always null while a run is in flight or after one fell over, for the same
   * reason `metrics` is empty then: there is nothing to compare. See
   * `EvalPreviousRun` for why "previous completed run on the same corpus" is
   * three separate conditions rather than one.
   */
  previous: EvalPreviousRun | null;
  /**
   * Whether any measured metric fell below its threshold.
   *
   * **Not the same thing as `status: "failed"`**, and the distinction is the
   * point. A failed run fell over — the provider was unreachable, the queue ran
   * out of retries — and has no numbers. A failing run finished and its numbers
   * are bad, which is the answer this harness exists to give.
   */
  failing: boolean;
  results: EvalCaseResultRow[];
}

export interface EvalRunsResponse {
  /**
   * Whether this deployment can run an eval at all — one key behind every AI
   * feature (ADR-0003), so an unkeyed deployment cannot start one. A presence
   * boolean, never the value: same rule the pipeline config block keeps.
   */
  evalConfigured: boolean;
  /**
   * Which series these runs are, echoed back from the request (#234).
   *
   * The page shows one corpus at a time and never both, so a response that did
   * not say which one it is would be a list nobody could caption. Echoed rather
   * than assumed, because the request may name none and the default lives on
   * the server too (`EVAL_CORPUS_DEFAULT`).
   */
  corpus: EvalCorpus;
  /**
   * Whether this deployment has ever recorded a run, **in any corpus**.
   *
   * The one thing a filtered list cannot say about itself, and what separates
   * the two empty states: "nobody has run one yet" wants the sentence that
   * explains what a run is, and "nothing on this series" wants the sentence
   * that says the other series is one control away. Without it an admin who
   * has only ever run live would be told, on load, that the harness has never
   * been used.
   */
  anyRuns: boolean;
  /** Newest first, and all of one corpus. */
  runs: EvalRunRow[];
}

/** The reply to `POST /api/evals/runs`: the run is queued, not finished. */
export interface EvalRunStartedResponse {
  runId: number;
}

/**
 * How many runs `GET /api/evals/runs` carries — **per corpus** (#234).
 *
 * The cap is applied inside the series the request asked for, not across both,
 * which is what stops twenty nightly frozen runs pushing the whole live series
 * off the page. Named here because the page quotes it when the list is full.
 */
export const EVAL_RUN_LIMIT = 20;
/**
 * The standing arrangement that opens a run unattended (#236).
 *
 * One row, never more: a schedule is a property of the deployment, not a list
 * an admin curates. It is seeded with the time the nightly sweep was hard-coded
 * to before this existed, so the arrangement in force did not change on the
 * deploy that made it editable.
 *
 * **Frozen corpus only, and that is not a field.** An unattended trend line has
 * to be attributable: a live-corpus run moves when an admin edits an article,
 * which is a fine thing to ask for on purpose (a planned run may name either
 * corpus) and a terrible thing to receive unasked. So there is no `corpus` here
 * to get wrong — see `GLOSSARY.md`'s **Schedule**.
 *
 * The time is an hour and a minute rather than a cron expression, on both
 * sides. A cron string an admin could type is five fields of which four have
 * exactly one legal value here, and the fifth is the every-few-hours run the
 * PRD priced out. What is offered is what can be honoured.
 */
export interface EvalScheduleRow {
  /** Local hour of the run, 0–23. */
  hour: number;
  /** Minute past the hour, 0–59. */
  minute: number;
  /**
   * Paused keeps the time. There is no delete: an arrangement that is off is
   * still the arrangement, and an admin turning it back on should not have to
   * remember what it used to say.
   */
  paused: boolean;
  /** When the schedule was last retimed, paused or resumed. */
  updatedAt: string;
  /**
   * Who did it, denormalised the way `KnowledgeArticleRevision.editorName` is —
   * the panel says who last changed the schedule, and it has to keep saying so
   * after that colleague's account is gone. Null only for the seeded row, which
   * nobody changed.
   */
  updatedByName: string | null;
}

/**
 * Where a planned run got to.
 *
 * A planned run is **not** a run (`docs/adr/0021`), so it does not borrow
 * `EVAL_RUN_STATUS`: it has measured nothing, and the words that fit it are
 * about whether it happened rather than about how it went.
 *
 * - `planned` — asked for, not yet fired. The only cancellable state.
 * - `cancelled` — an admin cancelled it; it never becomes a run. Re-timing is
 *   cancel-and-plan-again, so this is also what the first half of a re-time
 *   leaves behind.
 * - `fired` — its time came and it opened a run. `runId` names it.
 * - `missed` — its time passed while nothing was there to fire it, by more than
 *   the grace window. It started nothing and spent nothing.
 */
export const EVAL_PLANNED_RUN_STATUS = {
  planned: "planned",
  cancelled: "cancelled",
  fired: "fired",
  missed: "missed",
} as const;

export type EvalPlannedRunStatus =
  (typeof EVAL_PLANNED_RUN_STATUS)[keyof typeof EVAL_PLANNED_RUN_STATUS];

/**
 * How late a planned run may still fire.
 *
 * Fifteen minutes, and the ceiling is the point rather than the number. A job
 * deferred to 14:00 that the queue only delivers at 19:00 — the app was down,
 * a deploy overran — would charge for a full set at a moment nobody chose and
 * stamp a trend point whose date means nothing. Beyond the window the plan is
 * marked `missed`, which spends nothing and says so.
 *
 * Long enough to absorb an ordinary restart or a deploy; short enough that a
 * run which fires inside it is still recognisably the run somebody asked for.
 */
export const EVAL_PLANNED_RUN_GRACE_MINUTES = 15;

/** One planned run, as the panel reads it. */
export interface EvalPlannedRunRow {
  id: number;
  /**
   * Either corpus, unlike the schedule. The objection to an unattended live run
   * is about a red result appearing in a trend nobody chose to start; a named
   * person picking Live for a specific afternoon has chosen it.
   */
  corpus: EvalCorpus;
  /** When it is due, as an ISO string. */
  runAt: string;
  status: EvalPlannedRunStatus;
  /** Who asked for it, denormalised for the reason `updatedByName` is. */
  plannedByName: string | null;
  /** The run it opened, once it has fired. Null in every other state. */
  runId: number | null;
}

/**
 * How many planned runs `GET /api/evals/schedule` carries.
 *
 * A cap rather than a limit on how many may be planned: there is deliberately
 * no guard against planning a run close to another (the worker takes one at a
 * time, so a second waits its turn), so the list is bounded on the way out
 * instead of the way in.
 */
export const EVAL_PLANNED_RUN_LIMIT = 20;

/**
 * How far ahead a run may be planned.
 *
 * A week, and the ceiling is the queue rather than a product opinion: a
 * deferred job sits in pg-boss in the `created` state, and a queue deletes a
 * created job after its `retentionSeconds` — **14 days by default**, which is
 * what this deployment runs. A plan three weeks out would have its job quietly
 * swept away and would then sit `planned` forever with nothing coming for it.
 *
 * Half the retention rather than all of it, so the margin absorbs a queue
 * setting somebody lowers later without turning a plan into a row that never
 * fires and never says why.
 */
export const EVAL_PLAN_HORIZON_DAYS = 7;

/**
 * `GET /api/evals/schedule`: the standing arrangement, and what is coming.
 *
 * The two halves are different things on purpose and are never merged into one
 * list — a schedule fires forever and a planned run fires once. Neither is
 * drawn as a run: `runs` on the page above means measurements that happened.
 */
export interface EvalScheduleResponse {
  /**
   * Whether this deployment can run an eval at all, the same presence boolean
   * `EvalRunsResponse` carries. A schedule on a keyless deployment would fire
   * into a queue with no worker registered on it.
   */
  evalConfigured: boolean;
  schedule: EvalScheduleRow;
  /**
   * What is coming, soonest first — and the recently missed, which is the only
   * way an admin learns that a plan did not happen. Cancelled and fired plans
   * are not here: one is a decision already taken and the other is a run, which
   * the list above draws.
   */
  plannedRuns: EvalPlannedRunRow[];
}

/**
 * How long a `missed` plan stays in the list above.
 *
 * A day, because the news it carries is "the run you expected this morning did
 * not happen" and that is worth a morning. After it, the row is history and the
 * page is about what is coming.
 */
export const EVAL_MISSED_PLAN_WINDOW_HOURS = 24;

/**
 * What became of one email this desk meant to send.
 *
 * Mirrors the `OutboundEmailStatus` enum in the schema. `undeliverable` is the
 * one that needs saying out loud: it means no mail provider is configured, so
 * nothing was attempted. That is a supported state — the state this app runs in
 * today — and not a failure, which is why it is not folded into `failed`.
 * `withheld` is a demo session's email (#325): recorded, and never sent by
 * anything, the outbox retry included.
 */
export const OUTBOUND_EMAIL_STATUS = {
  queued: "queued",
  sent: "sent",
  failed: "failed",
  undeliverable: "undeliverable",
  withheld: "withheld",
} as const;

export type OutboundEmailStatus =
  (typeof OUTBOUND_EMAIL_STATUS)[keyof typeof OUTBOUND_EMAIL_STATUS];

/** What an outbound email is for. Mirrors `OutboundEmailKind` in the schema. */
export const OUTBOUND_EMAIL_KIND = {
  reply: "reply",
  passwordReset: "passwordReset",
  invitation: "invitation",
} as const;

export type OutboundEmailKind =
  (typeof OUTBOUND_EMAIL_KIND)[keyof typeof OUTBOUND_EMAIL_KIND];

/**
 * One row of the outbox, as the admin screen sees it.
 *
 * **`textBody` is included, and that is the point of the screen.** With no mail
 * provider bound, this is how an invitation reaches a new colleague: an admin
 * reads the link off the page. It is also why the route behind it is
 * admin-only — an invitation body contains a working single-use credential
 * until it expires.
 */
export interface OutboundEmailRow {
  id: number;
  kind: OutboundEmailKind;
  status: OutboundEmailStatus;
  toEmail: string;
  toName: string | null;
  subject: string;
  textBody: string;
  /** The ticket this reply belongs to, so the screen can link to the thread. */
  ticketId: number | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface OutboxListResponse {
  emails: OutboundEmailRow[];
  /** Rows matching the filter, which may exceed the page returned. */
  total: number;
}

/**
 * The unified admin activity feed (`GET /api/activity`) is a query-time merge
 * of five sources that each already have their own trail — `TicketActivity`,
 * `KnowledgeArticleRevision`, `AdminActivity`, `AutomationSettingsRevision` —
 * plus outbound replies, derived from `Message` (`direction: outbound`)
 * because a sent reply isn't its own activity row anywhere today. Never a
 * sixth table: this repo already answers "new table vs deriving from
 * existing ones" for tickets and knowledge with dedicated per-domain trails
 * rather than one shared table, and the feed is that same answer applied to
 * *reading* across all of them at once, in `routes/activity.ts`.
 *
 * Four entity types, not five sources: an outbound reply is filed under
 * `ticket`, the same entity type as a `TicketActivity` row, because both
 * describe something that happened *to a ticket* and the filter is asking
 * "which desk", not "which table".
 */
export const ACTIVITY_ENTITY_TYPE = {
  ticket: "ticket",
  knowledge: "knowledge",
  admin: "admin",
  automation: "automation",
} as const;

export type ActivityEntityType =
  (typeof ACTIVITY_ENTITY_TYPE)[keyof typeof ACTIVITY_ENTITY_TYPE];

/** Render/validate order for the entity-type filter. */
export const ACTIVITY_ENTITY_TYPES = [
  ACTIVITY_ENTITY_TYPE.ticket,
  ACTIVITY_ENTITY_TYPE.knowledge,
  ACTIVITY_ENTITY_TYPE.admin,
  ACTIVITY_ENTITY_TYPE.automation,
] as const;

/**
 * What happened, across every source the feed merges. Each existing action
 * vocabulary is spread in unchanged — `TICKET_ACTIVITY_ACTION`,
 * `KNOWLEDGE_REVISION_ACTION` and `ADMIN_ACTIVITY_ACTION` — so a ticket's
 * `status_changed` still means only what `TicketActivity` already says it
 * means, plus two synthetic actions for the two sources this feed reads that
 * had no action column of their own: `reply_sent` for an outbound `Message`
 * (there was never a "what kind of message" column, only a direction) and
 * `handoff_changed` for `AutomationSettingsRevision` (one field pair, so a
 * change is the only thing that can happen there — the same reasoning that
 * model's own schema comment gives for having no `action` column at all).
 */
export const ACTIVITY_ACTION = {
  ...TICKET_ACTIVITY_ACTION,
  ...KNOWLEDGE_REVISION_ACTION,
  ...ADMIN_ACTIVITY_ACTION,
  reply_sent: "reply_sent",
  handoff_changed: "handoff_changed",
} as const;

export type ActivityAction =
  (typeof ACTIVITY_ACTION)[keyof typeof ACTIVITY_ACTION];

/**
 * One entry in the merged feed, normalised to a single wire shape.
 *
 * `fromValue`/`toValue` are already display strings, the same convention
 * `TicketActivity` and `AdminActivity` use — never ids, and readable after
 * the account or article they name is gone. Both are null on a
 * `KnowledgeArticleRevision` row (a full snapshot, not a transition — see
 * that model's own comment) and on `reply_sent` (nothing to diff; the reply
 * itself is the content).
 *
 * `entityId` is what a future frontend links to: a ticket id for `ticket`, an
 * article id (`KB-004`) for `knowledge`. Null for `admin` (the account acted
 * on has no page of its own) and for `automation` (a change to one
 * system-wide setting, not a record with an id).
 *
 * One filtering surprise worth naming here rather than only in the route: an
 * automated reply's `Message.authorId` is null by design (see `domain.md`'s
 * note on the assistant never being a message's *author*), so filtering this
 * feed by the assistant's own user id will not surface its replies — only its
 * `TicketActivity` rows (`auto_resolved`, `auto_declined`), where `actorId`
 * is deliberately set. That is the existing schema's own distinction between
 * "who dealt with this" and "who wrote this", not a gap the feed introduces.
 */
export interface ActivityEntry {
  /** Unique across every source: `"<table>:<row id>"`. A React key, never a
   *  value that round-trips back into a filter. */
  id: string;
  entityType: ActivityEntityType;
  entityId: string | null;
  action: ActivityAction;
  actorId: string | null;
  actorName: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

export interface ActivityFeedResponse {
  /** One page of entries, newest first. */
  entries: ActivityEntry[];
  /** Entries matching the current filters, ignoring pagination. */
  total: number;
  /** Echoed back because the server clamps both. 1-based. */
  page: number;
  pageSize: number;
}

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

/**
 * The dashboard's fixed panel set (issue #102) — every panel `DashboardPage`
 * renders today, given a durable id that survives the component being
 * renamed or moved. A user's saved layout names panels by this id, never by
 * a component name or file path, which is exactly what keeps a refactor from
 * silently orphaning someone's saved arrangement.
 *
 * Fixed on purpose: this feature reorders and resizes panels, it does not
 * add, remove or hide them, so this set changes only when a panel is added
 * to or removed from the dashboard itself, not as part of personalizing it.
 */
export const DASHBOARD_PANEL_ID = {
  volumeChart: "volumeChart",
  statusMix: "statusMix",
  needsAttention: "needsAttention",
  firstResponseChart: "firstResponseChart",
  byCategory: "byCategory",
  workload: "workload",
  backlogAge: "backlogAge",
  topCustomers: "topCustomers",
  assistantEffectiveness: "assistantEffectiveness",
} as const;

export type DashboardPanelId =
  (typeof DASHBOARD_PANEL_ID)[keyof typeof DASHBOARD_PANEL_ID];

export const DASHBOARD_PANEL_IDS = [
  DASHBOARD_PANEL_ID.volumeChart,
  DASHBOARD_PANEL_ID.statusMix,
  DASHBOARD_PANEL_ID.needsAttention,
  DASHBOARD_PANEL_ID.firstResponseChart,
  DASHBOARD_PANEL_ID.byCategory,
  DASHBOARD_PANEL_ID.workload,
  DASHBOARD_PANEL_ID.backlogAge,
  DASHBOARD_PANEL_ID.topCustomers,
  DASHBOARD_PANEL_ID.assistantEffectiveness,
] as const;

/**
 * The 4 discrete widths a panel may snap to — the same four spans
 * `PANEL_SPAN` in `apps/web/src/components/dashboard/grid.ts` already draws
 * the grid with. Never a fifth value or a continuous size: the grid is 6
 * columns for exactly this reason, see that file's own comment.
 */
export const DASHBOARD_PANEL_WIDTH = {
  narrow: "narrow",
  half: "half",
  twoThirds: "twoThirds",
  wide: "wide",
} as const;

export type DashboardPanelWidth =
  (typeof DASHBOARD_PANEL_WIDTH)[keyof typeof DASHBOARD_PANEL_WIDTH];

export const DASHBOARD_PANEL_WIDTHS = [
  DASHBOARD_PANEL_WIDTH.narrow,
  DASHBOARD_PANEL_WIDTH.half,
  DASHBOARD_PANEL_WIDTH.twoThirds,
  DASHBOARD_PANEL_WIDTH.wide,
] as const;

/** One panel's place in a saved (or default) layout: its identity plus the
 * width it's been resized to. Order in the array is display order — there is
 * no separate position field. */
export interface DashboardPanelPlacement {
  panelId: DashboardPanelId;
  width: DashboardPanelWidth;
}

/**
 * What `DashboardPage` renders when a user has never customized it — exactly
 * today's hard-coded markup, given names. `GET /api/dashboard-layout` falls
 * back to this for a user with no saved `DashboardLayout` row, and "reset to
 * default" is defined as returning to it.
 */
export const DEFAULT_DASHBOARD_LAYOUT: DashboardPanelPlacement[] = [
  {
    panelId: DASHBOARD_PANEL_ID.volumeChart,
    width: DASHBOARD_PANEL_WIDTH.twoThirds,
  },
  {
    panelId: DASHBOARD_PANEL_ID.statusMix,
    width: DASHBOARD_PANEL_WIDTH.narrow,
  },
  {
    panelId: DASHBOARD_PANEL_ID.needsAttention,
    width: DASHBOARD_PANEL_WIDTH.twoThirds,
  },
  {
    panelId: DASHBOARD_PANEL_ID.firstResponseChart,
    width: DASHBOARD_PANEL_WIDTH.narrow,
  },
  {
    panelId: DASHBOARD_PANEL_ID.byCategory,
    width: DASHBOARD_PANEL_WIDTH.narrow,
  },
  { panelId: DASHBOARD_PANEL_ID.workload, width: DASHBOARD_PANEL_WIDTH.narrow },
  {
    panelId: DASHBOARD_PANEL_ID.backlogAge,
    width: DASHBOARD_PANEL_WIDTH.narrow,
  },
  {
    panelId: DASHBOARD_PANEL_ID.topCustomers,
    width: DASHBOARD_PANEL_WIDTH.wide,
  },
  {
    panelId: DASHBOARD_PANEL_ID.assistantEffectiveness,
    width: DASHBOARD_PANEL_WIDTH.wide,
  },
];

/** `GET` / `PUT /api/dashboard-layout`: the caller's layout, defaulted where
 * they have never customized it. `isDefault` is what lets the frontend show
 * a "reset to default" action only when there is something to reset. */
export interface DashboardLayoutResponse {
  layout: DashboardPanelPlacement[];
  isDefault: boolean;
}

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

/**
 * The product's name, in its two lengths.
 *
 * `BRAND_NAME` is what the lockup reads, what every sentence says and what the
 * invitation, reset and auto-reply emails sign off as (an agent's own reply
 * signs with the agent's name); `BRAND_SHORT` is for where space is
 * tight, which today is only the browser tab. `apps/web/index.html` carries the
 * short form as a literal, because the static shell is read before any module
 * runs, and `tests/e2e/brand.spec.ts` holds the two together. Anywhere else in
 * `apps/api` or `apps/web`, a typed name fails `apps/api/src/standards-guard.test.ts`
 * (#545) unless its `BRAND_ALLOWANCES` names the file.
 *
 * Here rather than in the web app (#488): the API names the product too — the
 * invitation and reset emails in `auth.ts`, the auto-reply's sign off — and it
 * cannot import from `apps/web`. One literal, which both apps and the E2E suite
 * read.
 */
export const BRAND_NAME = "The Great Forge Desk";
export const BRAND_SHORT = "Forge Desk";

/**
 * `BRAND_NAME` without its article, for where the name stands before a noun:
 * "Your Great Forge Desk account", not "Your The Great Forge Desk account".
 * Derived rather than restated, so nothing that reads it can drift from the
 * name. The invitation and reset emails in `auth.ts` use it, and so does the
 * auto-reply's strip of a product-name sign off the model wrote itself (#513).
 */
export const BRAND_ATTRIBUTIVE = BRAND_NAME.replace(/^The /, "");

/**
 * A label as it reads after a dash mid-sentence: "Declined — not covered by
 * the knowledge base".
 *
 * A label written to stand alone opens on a capital; run on after a dash it
 * reads lower-case. The activity feed and the Evals verdict run `DECLINE_SHORT`
 * through it, and the outbox's refusal to retry a withheld email runs
 * `WITHHELD_REASON` through it. A label that opens on an acronym of two or
 * more capitals ("AI …") keeps them, or it would read "aI …". A one-letter
 * word that must stay capital ("I …") is not detected and would be lowered;
 * no label opens on one.
 *
 * Here rather than in the web app (#531): the API builds a sentence the same
 * way and cannot import from `apps/web`.
 */
export function midSentence(label: string): string {
  if (/^[A-Z]{2}/.test(label)) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}
