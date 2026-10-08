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

/** What a step's Status tag reads: its Status, or that there is no ticket. */
export function statusLabel(status: TicketStatus | null): string {
  return status ?? NO_TICKET_YET;
}

/** In the order a ticket meets them, which is also the order a reader does. */
export const LIFECYCLE_STEPS: readonly LifecycleStep[] = [
  {
    id: LIFECYCLE_STEP.emailSent,
    title: "Email sent",
    lane: LIFECYCLE_LANE.customer,
    column: 0,
    status: null,
    explanation:
      "A customer writes to the support address from their own mail app. They never sign in; their email is what opens a ticket.",
  },
  {
    id: LIFECYCLE_STEP.ingestion,
    title: "Ingestion",
    lane: LIFECYCLE_LANE.assistant,
    column: 1,
    status: TICKET_STATUS.New,
    explanation:
      "The email arrives through the inbound mail provider and becomes a new ticket in New, with the email as the first message of its thread. Nobody owns it yet.",
  },
  {
    id: LIFECYCLE_STEP.classification,
    title: "Classification",
    lane: LIFECYCLE_LANE.assistant,
    column: 2,
    status: TICKET_STATUS.New,
    explanation:
      "A model files the ticket under one of the four categories. Filing it moves nothing: the ticket stays in New. If the auto-reply is switched on, the ticket is then offered to it, whatever its category; a category it may not answer is turned back after the Claim, as a Decline.",
  },
  {
    id: LIFECYCLE_STEP.claim,
    title: "Claim",
    lane: LIFECYCLE_LANE.assistant,
    column: 3,
    status: TICKET_STATUS.Processing,
    explanation:
      "The auto-reply takes exclusive hold of a ticket that is still New and unassigned, which puts it in Processing for the few seconds a reply is being composed. A ticket in Processing is hidden from the list, so an agent cannot answer it at the same time.",
  },
  {
    id: LIFECYCLE_STEP.autoReplySent,
    title: "Auto-reply sent",
    lane: LIFECYCLE_LANE.assistant,
    column: 4,
    status: TICKET_STATUS.Resolved,
    explanation:
      "The knowledge base covers the question, the reply passes every check, and it goes to the customer with nobody reading it first. The ticket is Resolved and filed under the assistant's own account.",
  },
  {
    id: LIFECYCLE_STEP.declineHandoff,
    title: "Decline and Handoff",
    lane: LIFECYCLE_LANE.assistant,
    row: 1,
    column: 4,
    status: TICKET_STATUS.Open,
    explanation:
      "The auto-reply decides not to answer, and records why. That is a normal outcome, not a failure. The ticket is Open, and is handed to whoever the handoff setting on the Pipeline page names, if anyone.",
  },
  {
    id: LIFECYCLE_STEP.agentReplies,
    title: "Agent replies",
    lane: LIFECYCLE_LANE.agent,
    column: 5,
    status: TICKET_STATUS.Open,
    explanation:
      "An agent reads the thread and answers it. Polish rewrites their draft before they send it, and a Summary of the thread is drawn beside it on request. Replying does not change the Status: the ticket is still Open.",
  },
  {
    id: LIFECYCLE_STEP.agentResolves,
    title: "Agent resolves",
    lane: LIFECYCLE_LANE.agent,
    column: 6,
    status: TICKET_STATUS.Resolved,
    explanation:
      "Once the customer has what they needed, the agent sets the ticket to Resolved. It stays theirs.",
  },
  {
    id: LIFECYCLE_STEP.customerReplies,
    title: "Customer replies",
    lane: LIFECYCLE_LANE.customer,
    column: 7,
    status: TICKET_STATUS.Resolved,
    explanation:
      "The customer writes back to a resolved ticket. Their email joins the same thread; what happens to the Status depends on who resolved it.",
  },
  {
    id: LIFECYCLE_STEP.reopen,
    title: "Reopen",
    lane: LIFECYCLE_LANE.assistant,
    column: 8,
    status: TICKET_STATUS.Open,
    explanation:
      "If the assistant had resolved the ticket, the reply reopens it: the ticket goes back to Open, and from the assistant to whoever the handoff setting names, if anyone, since the assistant is not coming back for it.",
  },
  {
    id: LIFECYCLE_STEP.replyJoinsThread,
    title: "Reply joins the thread",
    lane: LIFECYCLE_LANE.agent,
    column: 8,
    status: TICKET_STATUS.Resolved,
    explanation:
      "If a person had resolved the ticket, the reply joins the thread and nothing else moves: it stays Resolved and stays theirs. They judged it finished, and a thank-you should not reopen it.",
  },
  {
    id: LIFECYCLE_STEP.agentCloses,
    title: "Agent closes",
    lane: LIFECYCLE_LANE.agent,
    column: 9,
    status: TICKET_STATUS.Closed,
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

/** After the Claim: the auto-reply answers, or declines and hands off. */
const AUTO_REPLY_FORK: LifecycleBranch = {
  from: LIFECYCLE_STEP.claim,
  arms: [LIFECYCLE_STEP.autoReplySent, LIFECYCLE_STEP.declineHandoff],
};

/** After a customer's reply: a Reopen, or the reply simply joins the thread. */
const CUSTOMER_REPLY_FORK: LifecycleBranch = {
  from: LIFECYCLE_STEP.customerReplies,
  arms: [LIFECYCLE_STEP.reopen, LIFECYCLE_STEP.replyJoinsThread],
};

export const LIFECYCLE_BRANCHES: readonly LifecycleBranch[] = [
  AUTO_REPLY_FORK,
  CUSTOMER_REPLY_FORK,
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

/** The edge from a fork's step to each of its arms. */
function fork({ from, arms }: LifecycleBranch): LifecycleEdge[] {
  return arms.map((arm) => edge(from, arm));
}

export const LIFECYCLE_EDGES: readonly LifecycleEdge[] = [
  edge(LIFECYCLE_STEP.emailSent, LIFECYCLE_STEP.ingestion),
  edge(LIFECYCLE_STEP.ingestion, LIFECYCLE_STEP.classification),
  edge(LIFECYCLE_STEP.classification, LIFECYCLE_STEP.claim),
  ...fork(AUTO_REPLY_FORK),
  edge(LIFECYCLE_STEP.declineHandoff, LIFECYCLE_STEP.agentReplies),
  edge(LIFECYCLE_STEP.agentReplies, LIFECYCLE_STEP.agentResolves),
  edge(LIFECYCLE_STEP.autoReplySent, LIFECYCLE_STEP.customerReplies),
  edge(LIFECYCLE_STEP.agentResolves, LIFECYCLE_STEP.customerReplies),
  ...fork(CUSTOMER_REPLY_FORK),
  edge(LIFECYCLE_STEP.reopen, LIFECYCLE_STEP.agentCloses),
  edge(LIFECYCLE_STEP.replyJoinsThread, LIFECYCLE_STEP.agentCloses),
];

/** The edges that end at this step: what the walk highlights as the way in. */
export function edgesInto(id: LifecycleStepId): LifecycleEdge[] {
  return LIFECYCLE_EDGES.filter((edge) => edge.to === id);
}

/**
 * The step one along from `current` in `LIFECYCLE_STEPS`' order, forward (1)
 * or back (-1); null past either end. From no step at all, forward is the
 * first step and back is nowhere.
 */
export function stepBeside(
  current: LifecycleStepId | null,
  direction: 1 | -1,
): LifecycleStepId | null {
  const index =
    current === null
      ? direction === 1
        ? 0
        : -1
      : LIFECYCLE_STEPS.findIndex((step) => step.id === current) + direction;
  return LIFECYCLE_STEPS[index]?.id ?? null;
}

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
    step: LIFECYCLE_STEP.classification,
    column: 1,
  },
  {
    id: LIFECYCLE_NOTE.outage,
    text: "An outage is not a Decline: the ticket goes back to New, unassigned, and the auto-reply tries again. Only when the retries run out is it handed off, as Open.",
    step: LIFECYCLE_STEP.claim,
    column: 3,
  },
  {
    id: LIFECYCLE_NOTE.anyStatus,
    text: `An agent can move a ticket to ${settable} at any point. Never to Processing, which only the auto-reply holds, and never back to New.`,
    step: LIFECYCLE_STEP.agentReplies,
    column: 5,
  },
];

/** The notes that qualify this step, in the data's order. */
export function notesFor(id: LifecycleStepId): LifecycleNote[] {
  return LIFECYCLE_NOTES.filter((note) => note.step === id);
}

/** Everything the lifecycle view draws, in the shape the layout takes. */
export const LIFECYCLE = {
  lanes: LIFECYCLE_LANES,
  steps: LIFECYCLE_STEPS,
  edges: LIFECYCLE_EDGES,
  branches: LIFECYCLE_BRANCHES,
  notes: LIFECYCLE_NOTES,
} as const;
