import {
  AGENT_SETTABLE_STATUS,
  TICKET_STATUS,
  type TicketStatus,
} from "@ticket/shared";

/**
 * The Ticket lifecycle view of How it works, as data: the three swimlanes, the
 * steps a ticket passes through from the email that opens it to the agent who
 * closes it, the two places the path forks, and the three notes that qualify a
 * step.
 *
 * It draws what the code does, as `docs/standards/domain.md` describes it:
 * classification leaves a ticket in New, Processing lasts only while a reply is
 * being composed, and only a ticket the assistant resolved is reopened
 * (`apps/api/src/ingest.ts`). A change to a drawn step updates this file.
 *
 * Where each step sits is a lane, a row inside that lane and a column, and
 * `layOutLifecycle` in `./lifecycle-layout` turns those into coordinates with
 * nothing simulated, so a step is where it was on every load (R9).
 *
 * Import-free apart from `@ticket/shared`, as `./architecture` is: the E2E
 * imports this module and asserts against the same titles the page draws.
 */

export const LIFECYCLE_LANE = {
  customer: "customer",
  assistant: "assistant",
  agent: "agent",
} as const;

export type LifecycleLaneId =
  (typeof LIFECYCLE_LANE)[keyof typeof LIFECYCLE_LANE];

export interface LifecycleLane {
  readonly id: LifecycleLaneId;
  readonly title: string;
}

/** Top to bottom, in the order the lanes are drawn. */
export const LIFECYCLE_LANES: readonly LifecycleLane[] = [
  { id: LIFECYCLE_LANE.customer, title: "Customer" },
  { id: LIFECYCLE_LANE.assistant, title: "Assistant" },
  { id: LIFECYCLE_LANE.agent, title: "Agent" },
];

export const LIFECYCLE_STEP = {
  emailSent: "emailSent",
  ingestion: "ingestion",
  classification: "classification",
  claim: "claim",
  autoReplySent: "autoReplySent",
  declineHandoff: "declineHandoff",
  agentReplies: "agentReplies",
  agentResolves: "agentResolves",
  customerReplies: "customerReplies",
  reopen: "reopen",
  replyJoinsThread: "replyJoinsThread",
  agentCloses: "agentCloses",
} as const;

export type LifecycleStepId =
  (typeof LIFECYCLE_STEP)[keyof typeof LIFECYCLE_STEP];

export interface LifecycleStep {
  readonly id: LifecycleStepId;
  readonly title: string;
  readonly lane: LifecycleLaneId;
  /** Which row of its lane the step sits in; 0 when absent. */
  readonly row?: number;
  readonly column: number;
  /**
   * The Status the ticket has at this step. Null only before there is a
   * ticket at all: the customer's email has not arrived yet.
   */
  readonly status: TicketStatus | null;
  /** Plain language, in `CONTEXT.md`'s words. Shown in the side panel. */
  readonly explanation: string;
}

/** What the tag on a step with no Status says. */
export const NO_TICKET_YET = "No ticket yet";

const S = TICKET_STATUS;
const L = LIFECYCLE_LANE;

/** In the order a ticket meets them, which is also the order a reader does. */
export const LIFECYCLE_STEPS: readonly LifecycleStep[] = [
  {
    id: LIFECYCLE_STEP.emailSent,
    title: "Email sent",
    lane: L.customer,
    column: 0,
    status: null,
    explanation:
      "A customer writes to the support address from their own mail app. They never sign in; their email is what opens a ticket.",
  },
  {
    id: LIFECYCLE_STEP.ingestion,
    title: "Ingestion",
    lane: L.assistant,
    column: 1,
    status: S.New,
    explanation:
      "The email arrives through the inbound mail provider and becomes a new ticket in New, with the email as the first message of its thread. Nobody owns it yet.",
  },
  {
    id: LIFECYCLE_STEP.classification,
    title: "Classification",
    lane: L.assistant,
    column: 2,
    status: S.New,
    explanation:
      "A model files the ticket under one of the four categories. Filing it moves nothing: the ticket stays in New, and the auto-reply is offered the ticket if its category is one it may answer.",
  },
  {
    id: LIFECYCLE_STEP.claim,
    title: "Claim",
    lane: L.assistant,
    column: 3,
    status: S.Processing,
    explanation:
      "The auto-reply takes exclusive hold of a ticket that is still New and unassigned, which puts it in Processing for the few seconds a reply is being composed. A ticket in Processing is hidden from the list, so an agent cannot answer it at the same time.",
  },
  {
    id: LIFECYCLE_STEP.autoReplySent,
    title: "Auto-reply sent",
    lane: L.assistant,
    column: 4,
    status: S.Resolved,
    explanation:
      "The knowledge base covers the question, the reply passes every check, and it goes to the customer with nobody reading it first. The ticket is Resolved and filed under the assistant's own account.",
  },
  {
    id: LIFECYCLE_STEP.declineHandoff,
    title: "Decline and Handoff",
    lane: L.assistant,
    row: 1,
    column: 4,
    status: S.Open,
    explanation:
      "The auto-reply decides not to answer, and records why. That is a normal outcome, not a failure. The ticket is handed to a person, the one the handoff setting on the Pipeline page names, and is Open.",
  },
  {
    id: LIFECYCLE_STEP.agentReplies,
    title: "Agent replies",
    lane: L.agent,
    column: 5,
    status: S.Open,
    explanation:
      "An agent reads the thread and answers it. Polish rewrites their draft before they send it, and a Summary of the thread is drawn beside it on request. Replying does not change the Status: the ticket is still Open.",
  },
  {
    id: LIFECYCLE_STEP.agentResolves,
    title: "Agent resolves",
    lane: L.agent,
    column: 6,
    status: S.Resolved,
    explanation:
      "Once the customer has what they needed, the agent sets the ticket to Resolved. It stays theirs.",
  },
  {
    id: LIFECYCLE_STEP.customerReplies,
    title: "Customer replies",
    lane: L.customer,
    column: 7,
    status: S.Resolved,
    explanation:
      "The customer writes back to a resolved ticket. Their email joins the same thread; what happens to the Status depends on who resolved it.",
  },
  {
    id: LIFECYCLE_STEP.reopen,
    title: "Reopen",
    lane: L.assistant,
    column: 8,
    status: S.Open,
    explanation:
      "If the assistant had resolved the ticket, the reply reopens it: the ticket goes back to Open and to the person the handoff setting names, since the assistant is not coming back for it.",
  },
  {
    id: LIFECYCLE_STEP.replyJoinsThread,
    title: "Reply joins the thread",
    lane: L.agent,
    column: 8,
    status: S.Resolved,
    explanation:
      "If a person had resolved the ticket, the reply joins the thread and nothing else moves: it stays Resolved and stays theirs. They judged it finished, and a thank-you should not reopen it.",
  },
  {
    id: LIFECYCLE_STEP.agentCloses,
    title: "Agent closes",
    lane: L.agent,
    column: 9,
    status: S.Closed,
    explanation:
      "When the conversation is over, an agent sets the ticket to Closed.",
  },
];

/** The step with this id. Every id names one, so this never misses. */
export function lifecycleStep(id: LifecycleStepId): LifecycleStep {
  return LIFECYCLE_STEPS.find((step) => step.id === id)!;
}

/** The lane with this id. Every id names one, so this never misses. */
export function lifecycleLane(id: LifecycleLaneId): LifecycleLane {
  return LIFECYCLE_LANES.find((lane) => lane.id === id)!;
}

/**
 * A place the path forks: one step, and the two steps that can follow it. The
 * arms share a column, since they are alternatives at the same point in time.
 */
export interface LifecycleBranch {
  readonly from: LifecycleStepId;
  readonly arms: readonly [LifecycleStepId, LifecycleStepId];
}

const P = LIFECYCLE_STEP;

export const LIFECYCLE_BRANCHES: readonly LifecycleBranch[] = [
  { from: P.claim, arms: [P.autoReplySent, P.declineHandoff] },
  { from: P.customerReplies, arms: [P.reopen, P.replyJoinsThread] },
];

export interface LifecycleEdge {
  /** Stable, for the DOM and the E2E: `<from>-<to>`. */
  readonly id: string;
  readonly from: LifecycleStepId;
  readonly to: LifecycleStepId;
}

function edge(from: LifecycleStepId, to: LifecycleStepId): LifecycleEdge {
  return { id: `${from}-${to}`, from, to };
}

export const LIFECYCLE_EDGES: readonly LifecycleEdge[] = [
  edge(P.emailSent, P.ingestion),
  edge(P.ingestion, P.classification),
  edge(P.classification, P.claim),
  ...LIFECYCLE_BRANCHES[0].arms.map((arm) => edge(P.claim, arm)),
  edge(P.declineHandoff, P.agentReplies),
  edge(P.agentReplies, P.agentResolves),
  edge(P.autoReplySent, P.customerReplies),
  edge(P.agentResolves, P.customerReplies),
  ...LIFECYCLE_BRANCHES[1].arms.map((arm) => edge(P.customerReplies, arm)),
  edge(P.reopen, P.agentCloses),
  edge(P.replyJoinsThread, P.agentCloses),
];

export const LIFECYCLE_NOTE = {
  noKey: "noKey",
  outage: "outage",
  anyStatus: "anyStatus",
} as const;

export type LifecycleNoteId =
  (typeof LIFECYCLE_NOTE)[keyof typeof LIFECYCLE_NOTE];

export interface LifecycleNote {
  readonly id: LifecycleNoteId;
  readonly text: string;
  /** The step it qualifies; a dashed line joins the two. */
  readonly step: LifecycleStepId;
  /** The first of the two columns the note spans, below the lanes. */
  readonly column: number;
}

/** "Open, Resolved or Closed", from the list the API accepts. */
const settable = `${AGENT_SETTABLE_STATUS.slice(0, -1).join(", ")} or ${AGENT_SETTABLE_STATUS.at(-1)}`;

export const LIFECYCLE_NOTES: readonly LifecycleNote[] = [
  {
    id: LIFECYCLE_NOTE.noKey,
    text: "With no OpenAI key nothing is classified or answered, and every ticket stays in New for a person.",
    step: P.classification,
    column: 1,
  },
  {
    id: LIFECYCLE_NOTE.outage,
    text: "An outage is not a Decline: the ticket goes back to New, unassigned, and the auto-reply tries again. Only when the retries run out is it handed to a person.",
    step: P.claim,
    column: 3,
  },
  {
    id: LIFECYCLE_NOTE.anyStatus,
    text: `An agent can move a ticket to ${settable} at any point. Never to Processing, which only the auto-reply holds, and never back to New.`,
    step: P.agentReplies,
    column: 5,
  },
];

/** Everything the lifecycle view draws, in the shape the layout takes. */
export const LIFECYCLE = {
  lanes: LIFECYCLE_LANES,
  steps: LIFECYCLE_STEPS,
  edges: LIFECYCLE_EDGES,
  branches: LIFECYCLE_BRANCHES,
  notes: LIFECYCLE_NOTES,
} as const;
