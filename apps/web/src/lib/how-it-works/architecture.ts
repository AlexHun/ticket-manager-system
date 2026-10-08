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
      "A customer writes to the support address from their own mail app. They never sign in and have no account; their email is what opens a ticket, and every later email on the same subject joins its thread.",
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
      "Work the API hands off so that nobody waits for it: classification, the auto-reply, sending each email in the outbox, and housekeeping. Each job is kept in Postgres until it is done, so a restart or a provider outage loses nothing and the job is retried.",
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
      "The model behind every piece of machine-written work: classification, the auto-reply, and the Polish and Summary an agent asks for. Without a key the desk still works, and every ticket simply stays in New for a person.",
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
      "The screens agents and admins work in: the dashboard, the tickets and each thread, and the admin screens for users, knowledge, the outbox, the pipeline and evals. It reads and writes through the API and nothing else.",
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

export const ARCHITECTURE_EDGES: readonly ArchitectureEdge[] = [
  {
    id: "customerMail-inboundMail",
    from: ARCHITECTURE_NODE.customerMail,
    to: ARCHITECTURE_NODE.inboundMail,
    label: "email",
  },
  {
    id: "inboundMail-api",
    from: ARCHITECTURE_NODE.inboundMail,
    to: ARCHITECTURE_NODE.api,
    label: "webhook",
  },
  {
    id: "browserApp-api",
    from: ARCHITECTURE_NODE.browserApp,
    to: ARCHITECTURE_NODE.api,
    label: "HTTP",
  },
  {
    id: "api-browserApp",
    from: ARCHITECTURE_NODE.api,
    to: ARCHITECTURE_NODE.browserApp,
    label: "live updates",
  },
  {
    id: "api-postgres",
    from: ARCHITECTURE_NODE.api,
    to: ARCHITECTURE_NODE.postgres,
    label: "SQL",
  },
  {
    id: "jobWorkers-postgres",
    from: ARCHITECTURE_NODE.jobWorkers,
    to: ARCHITECTURE_NODE.postgres,
    label: "job",
  },
  {
    id: "api-openai",
    from: ARCHITECTURE_NODE.api,
    to: ARCHITECTURE_NODE.openai,
    label: "model call",
  },
  {
    id: "jobWorkers-outboundMail",
    from: ARCHITECTURE_NODE.jobWorkers,
    to: ARCHITECTURE_NODE.outboundMail,
    label: "send",
  },
  {
    id: "outboundMail-customerMail",
    from: ARCHITECTURE_NODE.outboundMail,
    to: ARCHITECTURE_NODE.customerMail,
    label: "email",
  },
  {
    id: "browserApp-sentry",
    from: ARCHITECTURE_NODE.browserApp,
    to: ARCHITECTURE_NODE.sentry,
    label: "error reports",
  },
  {
    id: "api-sentry",
    from: ARCHITECTURE_NODE.api,
    to: ARCHITECTURE_NODE.sentry,
    label: "error reports",
  },
];

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
  text: "Both the browser app and the API build on the same types, constants and schemas, so the two sides of every request agree on its shape.",
  column: 0,
  row: 3,
} as const;
