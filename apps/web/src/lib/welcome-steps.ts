import { TICKET_STATUS } from "@ticket/shared";
import { LIST_PARAM } from "./list-param";
import { ROUTE } from "./routes";

/**
 * The welcome's suggested first steps (demo-welcome PRD R4, R13), in the order
 * the owner approved on #464: How it works first, then four screens of the
 * demo.
 *
 * **No step names a ticket by id.** The nightly reset (`DEMO_RESET_SWEEP`)
 * re-creates the showcase tickets with new ids, so a step links to a screen or
 * a filtered list, built from `ROUTE` and `LIST_PARAM` rather than a retyped
 * path. Every screen here is one a demo session may open, and none asks the
 * visitor to change something they cannot: the pipeline simulator and the
 * eval run button are read-only to a demo, so those steps ask the visitor to
 * look, never to run anything.
 *
 * No `@/…` alias and no React, for the reason `routes.ts` gives:
 * `tests/e2e/demo-welcome.spec.ts` imports this list and walks it rather than
 * restating it, so a step added here is a step the E2E opens.
 */
export interface WelcomeStep {
  /** Stable, for React's key and nothing else. */
  readonly key: string;
  /** One sentence, which is also the link's accessible name. */
  readonly sentence: string;
  /** Where it goes: a route's path, with a query string for a filtered list. */
  readonly to: string;
}

const resolvedTickets = `${ROUTE.tickets.path}?${new URLSearchParams({
  [LIST_PARAM.status]: TICKET_STATUS.Resolved,
})}`;

export const WELCOME_STEPS: readonly WelcomeStep[] = [
  {
    key: "how-it-works",
    sentence:
      "See how the system fits together: the services it runs on, and the path a ticket takes from email to reply.",
    to: ROUTE.howItWorks.path,
  },
  {
    key: "resolved-tickets",
    sentence:
      "Read the tickets already resolved, and the replies that resolved them.",
    to: resolvedTickets,
  },
  {
    key: "pipeline",
    sentence:
      "Open the pipeline simulator to see what happens to a ticket before anyone opens it.",
    to: ROUTE.pipeline.path,
  },
  {
    key: "evals",
    sentence: "Check how the assistant scored in the latest eval run.",
    to: ROUTE.evals.path,
  },
  {
    key: "knowledge",
    sentence:
      "Browse the knowledge base the assistant's replies are built from.",
    to: ROUTE.knowledge.path,
  },
];
