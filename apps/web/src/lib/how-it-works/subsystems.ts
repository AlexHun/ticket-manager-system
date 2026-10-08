import {
  ARCHITECTURE_NODE,
  architectureNode,
  type ArchitectureNodeId,
} from "./architecture";

/**
 * The second level of the Architecture view: what is inside the API, the job
 * workers and the browser app, and which parts of the other boxes each of
 * those subsystems talks to (R3).
 *
 * A subsystem is a part of the system someone would name, never one file: the
 * lists were settled in the 2026-10-08 grilling. The words follow `CONTEXT.md`.
 * Where each one sits is not said here; `layOutSubsystems` in
 * `./subsystem-layout` works it out from the order below and from the links,
 * with nothing simulated.
 *
 * Import-free apart from `./architecture`, which is import-free itself, so
 * `tests/e2e/how-it-works.spec.ts` reads the titles it asserts from here.
 */

/** The boxes that open onto their subsystems. */
export const DRILLABLE_BOXES = [
  ARCHITECTURE_NODE.api,
  ARCHITECTURE_NODE.jobWorkers,
  ARCHITECTURE_NODE.browserApp,
] as const satisfies readonly ArchitectureNodeId[];

export type DrillableBoxId = (typeof DRILLABLE_BOXES)[number];

export function isDrillable(id: ArchitectureNodeId): id is DrillableBoxId {
  return (DRILLABLE_BOXES as readonly ArchitectureNodeId[]).includes(id);
}

export const SUBSYSTEM = {
  // The API.
  ingestion: "ingestion",
  ticketsActivity: "ticketsActivity",
  knowledgeBase: "knowledgeBase",
  pipelineAutomation: "pipelineAutomation",
  outbox: "outbox",
  authUsers: "authUsers",
  realtime: "realtime",
  evalsSchedule: "evalsSchedule",
  demo: "demo",
  // The job workers.
  classifyJob: "classifyJob",
  autoReplyJob: "autoReplyJob",
  sendEmailJob: "sendEmailJob",
  evalJobs: "evalJobs",
  demoResetJob: "demoResetJob",
  housekeepingJobs: "housekeepingJobs",
  // The browser app's screens.
  signInScreen: "signInScreen",
  dashboardScreen: "dashboardScreen",
  ticketsScreen: "ticketsScreen",
  threadScreen: "threadScreen",
  activityScreen: "activityScreen",
  knowledgeScreen: "knowledgeScreen",
  pipelineScreen: "pipelineScreen",
  evalsScreen: "evalsScreen",
  outboxScreen: "outboxScreen",
  usersScreen: "usersScreen",
  tutorialsScreen: "tutorialsScreen",
} as const;

export type SubsystemId = (typeof SUBSYSTEM)[keyof typeof SUBSYSTEM];

/** Anything a subsystem can be joined to: a runtime box, or a subsystem of one. */
export type PartId = ArchitectureNodeId | SubsystemId;

export const LINK_DIRECTION = { out: "out", in: "in" } as const;
export type LinkDirection =
  (typeof LINK_DIRECTION)[keyof typeof LINK_DIRECTION];

export interface SubsystemLink {
  /** A part of another box: never this subsystem's own box or a sibling. */
  readonly part: PartId;
  /** How the two sides talk, in R2's words. */
  readonly label: string;
  /** `out` when this subsystem starts the conversation, `in` when the part does. */
  readonly direction: LinkDirection;
}

export interface Subsystem {
  readonly id: SubsystemId;
  readonly box: DrillableBoxId;
  readonly title: string;
  /** Plain language, in `CONTEXT.md`'s words. Shown in the side panel. */
  readonly explanation: string;
  readonly links: readonly SubsystemLink[];
}

const N = ARCHITECTURE_NODE;
const S = SUBSYSTEM;
const out = (part: PartId, label: string): SubsystemLink => ({
  part,
  label,
  direction: LINK_DIRECTION.out,
});
const from = (part: PartId, label: string): SubsystemLink => ({
  part,
  label,
  direction: LINK_DIRECTION.in,
});

/**
 * In each box's order, which is also the order the drawing stacks them in and
 * the order a screen reader meets them.
 */
export const SUBSYSTEMS: readonly Subsystem[] = [
  {
    id: S.ingestion,
    box: N.api,
    title: "Ingestion",
    explanation:
      "Turns each email the inbound mail provider passes on into a new ticket, or into a message on the thread it replies to. A reply to a ticket the assistant had resolved Reopens it; a new ticket is queued for Classification.",
    links: [
      from(N.inboundMail, "webhook"),
      out(N.postgres, "SQL"),
      out(S.classifyJob, "job"),
    ],
  },
  {
    id: S.ticketsActivity,
    box: N.api,
    title: "Tickets & Activity",
    explanation:
      "Everything an agent does to a ticket: the queue and its filters, the thread, replies, Status and Assignee changes, and the Activity that records each one. It also asks the model for a Polish of a draft reply or a Summary of a long thread.",
    links: [
      from(N.browserApp, "HTTP"),
      out(N.postgres, "SQL"),
      out(N.openai, "model call"),
    ],
  },
  {
    id: S.knowledgeBase,
    box: N.api,
    title: "Knowledge base",
    explanation:
      "The knowledge articles the auto-reply answers from, each change kept as a Revision. Admins write and archive them; the auto-reply reads only what is published.",
    links: [from(N.browserApp, "HTTP"), out(N.postgres, "SQL")],
  },
  {
    id: S.pipelineAutomation,
    box: N.api,
    title: "Pipeline & Automation",
    explanation:
      "The unattended part of a ticket's life, counted Stage by Stage, and who a Handoff goes to. A Simulated ticket sent from here takes the same path as real mail.",
    links: [from(N.browserApp, "HTTP"), out(N.postgres, "SQL")],
  },
  {
    id: S.outbox,
    box: N.api,
    title: "Outbox",
    explanation:
      "Every email the desk sends is written here first, in the same step as the reply it carries, and then handed to a job to send. An admin sees each one's Delivery, or why it was Undeliverable.",
    links: [
      from(N.browserApp, "HTTP"),
      out(N.postgres, "SQL"),
      out(S.sendEmailJob, "job"),
    ],
  },
  {
    id: S.authUsers,
    box: N.api,
    title: "Auth & Users",
    explanation:
      "Signing in, sessions, Invitations and password Resets, and the accounts admins manage. It also keeps what each person has seen: the tutorials, the New badges and their dashboard's layout.",
    links: [from(N.browserApp, "HTTP"), out(N.postgres, "SQL")],
  },
  {
    id: S.realtime,
    box: N.api,
    title: "Realtime",
    explanation:
      "Tells every open browser the moment a ticket changes, whoever or whatever changed it, so a queue or a thread never needs reloading.",
    links: [out(N.browserApp, "live updates")],
  },
  {
    id: S.evalsSchedule,
    box: N.api,
    title: "Evals & Schedule",
    explanation:
      "Measures the classifier and the auto-reply against a fixed Corpus of Cases, each Run scored against its Threshold. Runs start by hand, on a Planned run or on the nightly Schedule.",
    links: [
      from(N.browserApp, "HTTP"),
      out(N.postgres, "SQL"),
      out(S.evalJobs, "job"),
    ],
  },
  {
    id: S.demo,
    box: N.api,
    title: "Demo",
    explanation:
      "Lets a Demo visitor in without an account, for a limited session that can look at every screen and change none of the showcase ones, and caps how much model work a day of demos may spend.",
    links: [from(N.browserApp, "HTTP"), out(N.postgres, "SQL")],
  },

  {
    id: S.classifyJob,
    box: N.jobWorkers,
    title: "Classify ticket",
    explanation:
      "Gives a new ticket its Category. The ticket stays in New; a ticket the knowledge base might answer is passed on to the auto-reply. An outage is tried again rather than counted as a Decline.",
    links: [
      from(S.ingestion, "job"),
      out(N.openai, "model call"),
      out(N.postgres, "SQL"),
      out(S.realtime, "live updates"),
    ],
  },
  {
    id: S.autoReplyJob,
    box: N.jobWorkers,
    title: "Auto-reply",
    explanation:
      "Claims the ticket, which puts it in Processing, and drafts a reply from the knowledge base. A reply that passes every check goes to the outbox and the ticket is Resolved under the assistant; anything else is a Decline and a Handoff, in Open.",
    links: [
      out(N.openai, "model call"),
      out(N.postgres, "SQL"),
      out(S.outbox, "reply"),
      out(S.realtime, "live updates"),
    ],
  },
  {
    id: S.sendEmailJob,
    box: N.jobWorkers,
    title: "Send email",
    explanation:
      "Takes one email from the outbox and hands it to the outbound mail provider, recording the Delivery. A provider outage is tried again; with no provider configured, the email is marked Undeliverable.",
    links: [
      from(S.outbox, "job"),
      out(N.outboundMail, "send"),
      out(N.postgres, "SQL"),
    ],
  },
  {
    id: S.evalJobs,
    box: N.jobWorkers,
    title: "Eval runs",
    explanation:
      "Works through a Run's Cases with the model and stores each Verdict: a Run started by hand, a Planned run when its time comes, and the nightly one.",
    links: [
      from(S.evalsSchedule, "job"),
      out(N.openai, "model call"),
      out(N.postgres, "SQL"),
      out(S.realtime, "live updates"),
    ],
  },
  {
    id: S.demoResetJob,
    box: N.jobWorkers,
    title: "Demo reset",
    explanation:
      "The Nightly reset: puts the demo's tickets back as they were, so each day's visitors start from the same desk. It does nothing where demo mode is off.",
    links: [out(N.postgres, "SQL")],
  },
  {
    id: S.housekeepingJobs,
    box: N.jobWorkers,
    title: "Housekeeping",
    explanation:
      "Regular sweeps that keep the database from growing without end: old outbox rows and old Activity trails are pruned once they are past keeping.",
    links: [out(N.postgres, "SQL")],
  },

  {
    id: S.signInScreen,
    box: N.browserApp,
    title: "Sign in",
    explanation:
      "Where an agent or admin signs in, accepts an Invitation or asks for a Reset, and where a Demo visitor starts a demo session.",
    links: [out(S.authUsers, "HTTP"), out(S.demo, "HTTP")],
  },
  {
    id: S.dashboardScreen,
    box: N.browserApp,
    title: "Dashboard",
    explanation:
      "The desk at a glance: how many tickets are in each Status, how fast they are answered, and how much the assistant resolved on its own.",
    links: [out(S.ticketsActivity, "HTTP"), from(S.realtime, "live updates")],
  },
  {
    id: S.ticketsScreen,
    box: N.browserApp,
    title: "Tickets",
    explanation:
      "The queue: every ticket, filtered, sorted and saved as views, kept current as tickets arrive and change.",
    links: [out(S.ticketsActivity, "HTTP"), from(S.realtime, "live updates")],
  },
  {
    id: S.threadScreen,
    box: N.browserApp,
    title: "Ticket thread",
    explanation:
      "One ticket's thread, where an agent replies, asks for a Polish or a Summary, and changes the Status or the Assignee.",
    links: [out(S.ticketsActivity, "HTTP"), from(S.realtime, "live updates")],
  },
  {
    id: S.activityScreen,
    box: N.browserApp,
    title: "Activity",
    explanation:
      "Every change made to every ticket, by whom or by what, across the whole desk.",
    links: [out(S.ticketsActivity, "HTTP")],
  },
  {
    id: S.knowledgeScreen,
    box: N.browserApp,
    title: "Knowledge",
    explanation:
      "Where admins write, revise and archive the knowledge articles the auto-reply answers from.",
    links: [out(S.knowledgeBase, "HTTP")],
  },
  {
    id: S.pipelineScreen,
    box: N.browserApp,
    title: "Pipeline",
    explanation:
      "The unattended path drawn as a rail, with how many tickets each Stage holds, where Handoffs go, and a form to send a Simulated ticket through.",
    links: [
      out(S.pipelineAutomation, "HTTP"),
      from(S.realtime, "live updates"),
    ],
  },
  {
    id: S.evalsScreen,
    box: N.browserApp,
    title: "Evals",
    explanation:
      "Each Run's Verdicts against its Threshold, and the Schedule that starts them.",
    links: [out(S.evalsSchedule, "HTTP"), from(S.realtime, "live updates")],
  },
  {
    id: S.outboxScreen,
    box: N.browserApp,
    title: "Outbox",
    explanation:
      "Every email the desk has sent or tried to send, with its Delivery.",
    links: [out(S.outbox, "HTTP")],
  },
  {
    id: S.usersScreen,
    box: N.browserApp,
    title: "Users",
    explanation:
      "Where admins invite agents, change roles and remove accounts.",
    links: [out(S.authUsers, "HTTP")],
  },
  {
    id: S.tutorialsScreen,
    box: N.browserApp,
    title: "Tutorials",
    explanation:
      "Where admins edit the short walkthrough each main page offers the first time someone opens it.",
    links: [out(S.authUsers, "HTTP")],
  },
];

/** The subsystems inside one box, in the data's order. */
export function subsystemsOf(box: DrillableBoxId): Subsystem[] {
  return SUBSYSTEMS.filter((subsystem) => subsystem.box === box);
}

/** The subsystem with this id. Every id names one, so this never misses. */
export function subsystem(id: SubsystemId): Subsystem {
  return SUBSYSTEMS.find((candidate) => candidate.id === id)!;
}

function isSubsystem(id: PartId): id is SubsystemId {
  return SUBSYSTEMS.some((candidate) => candidate.id === id);
}

/** The runtime box a part sits in: itself, for a box. */
export function boxOf(id: PartId): ArchitectureNodeId {
  return isSubsystem(id) ? subsystem(id).box : id;
}

/** What a part is called on its own. */
export function partTitle(id: PartId): string {
  return isSubsystem(id) ? subsystem(id).title : architectureNode(id).title;
}

/**
 * What a part is called beside parts of other boxes: a subsystem names the box
 * it is in, so the API's Outbox and the app's Outbox screen are told apart.
 */
export function partLabel(id: PartId): string {
  return isSubsystem(id)
    ? `${subsystem(id).title} (${architectureNode(subsystem(id).box).title})`
    : architectureNode(id).title;
}

/** What a part does, for the panel. */
export function partExplanation(id: PartId): string {
  return isSubsystem(id)
    ? subsystem(id).explanation
    : architectureNode(id).explanation;
}

/** A link as a sentence: "SQL to Postgres", "webhook from Inbound mail provider". */
export function linkPhrase(link: SubsystemLink): string {
  const preposition = link.direction === LINK_DIRECTION.out ? "to" : "from";
  return `${link.label} ${preposition} ${partLabel(link.part)}`;
}
