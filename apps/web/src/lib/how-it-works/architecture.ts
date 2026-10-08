/**
 * The Architecture view of How it works, as data: the runtime boxes, the
 * connections between them, the Railway frame and the shared-packages note.
 *
 * Hand-written rather than scanned: the picture is a curated story (the PRD's
 * non-goal), and the words follow `CONTEXT.md`. Where each box sits is a grid
 * cell here, and `layOutArchitecture` in `./layout` turns cells into
 * coordinates with nothing simulated, so a box is where it was on every load.
 *
 * Deliberately import-free, as `@/lib/routes` is: `tests/e2e/how-it-works.spec.ts`
 * imports this module and asserts against the same titles and labels the page
 * draws, rather than retyping them.
 */

export const ARCHITECTURE_NODE = {
  customerMail: "customerMail",
  inboundMail: "inboundMail",
  browserApp: "browserApp",
  api: "api",
  jobWorkers: "jobWorkers",
  postgres: "postgres",
  openai: "openai",
  outboundMail: "outboundMail",
  sentry: "sentry",
} as const;

export type ArchitectureNodeId =
  (typeof ARCHITECTURE_NODE)[keyof typeof ARCHITECTURE_NODE];

export interface ArchitectureNode {
  readonly id: ArchitectureNodeId;
  readonly title: string;
  /** Plain language, in `CONTEXT.md`'s words. Shown in the side panel. */
  readonly explanation: string;
  /** Grid cell, top-left. Ignored for a node drawn `inside` another. */
  readonly column: number;
  readonly row: number;
  /** How many grid rows the box covers; 1 when absent. */
  readonly rowSpan?: number;
  /** Drawn inside this node's box, along its bottom, rather than in a cell. */
  readonly inside?: ArchitectureNodeId;
}

export interface ArchitectureEdge {
  /** Stable, for the DOM and the E2E: `<from>-<to>`. */
  readonly id: string;
  readonly from: ArchitectureNodeId;
  readonly to: ArchitectureNodeId;
  /** How the two sides talk. */
  readonly label: string;
}

/** In the order a screen reader meets them: the email's way in, then out. */
export const ARCHITECTURE_NODES: readonly ArchitectureNode[] = [
  {
    id: ARCHITECTURE_NODE.customerMail,
    title: "Customer mail",
    explanation:
      "A customer writes to the support address from their own mail app. They never sign in and have no account; their email is what opens a ticket, and a reply to the desk's email joins that ticket's thread.",
    column: 0,
    row: 1,
    rowSpan: 2,
  },
  {
    id: ARCHITECTURE_NODE.inboundMail,
    title: "Inbound mail provider",
    explanation:
      "The outside service that receives mail sent to the support address and passes each email on to the API as a webhook, already parsed, with the headers that tie a reply to its thread.",
    column: 1,
    row: 1,
  },
  {
    id: ARCHITECTURE_NODE.api,
    title: "API",
    explanation:
      "The server at the centre. Ingestion turns each arriving email into a new ticket or a message on an existing thread; it also serves the browser app, checks who is signed in, and pushes live updates when a ticket changes.",
    column: 2,
    row: 1,
    rowSpan: 2,
  },
  {
    id: ARCHITECTURE_NODE.jobWorkers,
    title: "Job workers",
    explanation:
      "Work the API hands off so that nobody waits for it: classification, the auto-reply, sending each email in the outbox, eval runs, and housekeeping. Each job is kept in Postgres until it is done, so a restart loses nothing and a job that meets a provider outage is tried again.",
    column: 2,
    row: 2,
    inside: ARCHITECTURE_NODE.api,
  },
  {
    id: ARCHITECTURE_NODE.postgres,
    title: "Postgres",
    explanation:
      "The one database. It holds tickets, threads and messages, Activity, knowledge articles and their revisions, the outbox, accounts and sessions, and the queue of jobs waiting for a worker.",
    column: 3,
    row: 1,
    rowSpan: 2,
  },
  {
    id: ARCHITECTURE_NODE.openai,
    title: "OpenAI",
    explanation:
      "The model behind every piece of machine-written work: classification, the auto-reply, the Polish and Summary an agent asks for, and eval runs. Without a key the desk still works, and every ticket simply stays in New for a person.",
    column: 2,
    row: 3,
  },
  {
    id: ARCHITECTURE_NODE.outboundMail,
    title: "Outbound mail provider",
    explanation:
      "The outside service that carries the desk's email to customers. Every email is in the outbox before it is sent, and with no provider configured an email is recorded as undeliverable rather than lost.",
    column: 1,
    row: 2,
  },
  {
    id: ARCHITECTURE_NODE.browserApp,
    title: "Browser app",
    explanation:
      "The screens agents and admins work in: the dashboard, the tickets and each thread, and the admin screens for users, knowledge, the outbox, the pipeline and evals. Every ticket it shows and every change it makes goes through the API.",
    column: 2,
    row: 0,
  },
  {
    id: ARCHITECTURE_NODE.sentry,
    title: "Sentry",
    explanation:
      "Where errors go. Both the browser app and the API report what went wrong to it, so a failure is seen even when nobody was looking at the screen it happened on.",
    column: 3,
    row: 0,
  },
];

/** A connection, its id derived from its two ends so the two cannot drift. */
function connection(
  from: ArchitectureNodeId,
  to: ArchitectureNodeId,
  label: string,
): ArchitectureEdge {
  return { id: `${from}-${to}`, from, to, label };
}

const N = ARCHITECTURE_NODE;

export const ARCHITECTURE_EDGES: readonly ArchitectureEdge[] = [
  connection(N.customerMail, N.inboundMail, "email"),
  connection(N.inboundMail, N.api, "webhook"),
  connection(N.browserApp, N.api, "HTTP"),
  connection(N.api, N.browserApp, "live updates"),
  connection(N.api, N.postgres, "SQL"),
  connection(N.jobWorkers, N.postgres, "job"),
  connection(N.api, N.openai, "model call"),
  connection(N.jobWorkers, N.outboundMail, "send"),
  connection(N.outboundMail, N.customerMail, "email"),
  connection(N.browserApp, N.sentry, "error reports"),
  connection(N.api, N.sentry, "error reports"),
];

/** The node with this id. Every id names one, so this never misses. */
export function architectureNode(id: ArchitectureNodeId): ArchitectureNode {
  return ARCHITECTURE_NODES.find((node) => node.id === id)!;
}

/** The frame drawn around what Railway hosts. */
export const RAILWAY_FRAME = {
  title: "Railway",
  explanation:
    "The hosting platform the API and Postgres run on, side by side, talking over its private network.",
  encloses: [ARCHITECTURE_NODE.api, ARCHITECTURE_NODE.postgres],
} as const satisfies {
  title: string;
  explanation: string;
  encloses: readonly ArchitectureNodeId[];
};

/** A note rather than a box: nothing calls it at runtime. */
export const SHARED_PACKAGES_NOTE = {
  title: "Shared packages",
  /** The line drawn under the title; `text` is the panel's and the list's. */
  caption: "both apps build on them",
  text: "Both the browser app and the API build on the same types, constants and schemas, so the two sides of every request agree on its shape.",
  column: 0,
  row: 3,
} as const;

/** Everything the Architecture view draws, in the shape the layout takes. */
export const ARCHITECTURE = {
  nodes: ARCHITECTURE_NODES,
  edges: ARCHITECTURE_EDGES,
  frame: RAILWAY_FRAME,
  note: SHARED_PACKAGES_NOTE,
} as const;
