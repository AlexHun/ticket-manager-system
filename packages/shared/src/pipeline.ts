import {
  AUTO_REPLY_DECLINE,
  AUTO_REPLY_DECLINES,
  type AutoReplyDecline,
} from "./auto-reply.ts";
import type { DashboardRange } from "./dashboard-stats.ts";
import type { TicketCategory, TicketStatus } from "./tickets.ts";

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
