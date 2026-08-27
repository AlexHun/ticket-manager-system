import { TUTORIAL_PAGE_KEY, type TutorialPageKey } from "@ticket/shared";

/**
 * Where a tutorial step may point, per page — the admin editor's source of
 * truth for the "points at" dropdown on each step (`TutorialEditorDialog`),
 * and the human label `<Tutorial>` never needs but the editor does.
 *
 * `id` is not a CSS selector — it is matched at render time against a
 * `data-tutorial-anchor="<id>"` attribute somewhere on that page's own JSX.
 * Adding a row here is only half the work: the element it names has to
 * actually carry that attribute on the page in question, or a step that picks
 * it falls back to a centered callout (see `Tutorial.tsx`) instead of
 * pointing at nothing. Removing or renaming a tagged element without updating
 * this file — or vice versa — degrades the same way, on purpose: never a
 * rendering error, just a step that stops pointing at anything until an admin
 * re-picks it.
 */
export const TUTORIAL_ANCHORS: Record<
  TutorialPageKey,
  { id: string; label: string }[]
> = {
  [TUTORIAL_PAGE_KEY.dashboard]: [
    { id: "range", label: "Time range & scope controls" },
    { id: "kpis", label: "The KPI row" },
    { id: "assistant", label: "Assistant effectiveness card" },
  ],
  [TUTORIAL_PAGE_KEY.tickets]: [
    { id: "filters", label: "Filters" },
    { id: "table", label: "The ticket table" },
    { id: "density", label: "Row density toggle" },
  ],
  [TUTORIAL_PAGE_KEY.ticketDetail]: [
    { id: "fields", label: "Status, category, assignee fields" },
    { id: "thread", label: "The message thread" },
    { id: "reply", label: "The reply composer" },
  ],
  [TUTORIAL_PAGE_KEY.pipeline]: [
    { id: "config", label: "Whether it's running" },
    { id: "rail", label: "The rail" },
    { id: "simulator", label: "The simulator" },
  ],
  [TUTORIAL_PAGE_KEY.knowledge]: [
    { id: "answerable", label: "What the assistant can answer" },
    { id: "new", label: "New article button" },
  ],
  [TUTORIAL_PAGE_KEY.users]: [
    { id: "list", label: "The user list" },
    { id: "new", label: "New user button" },
  ],
  [TUTORIAL_PAGE_KEY.activity]: [
    { id: "filters", label: "Filters" },
    { id: "feed", label: "The feed" },
  ],
  [TUTORIAL_PAGE_KEY.outbox]: [
    { id: "status", label: "Status filter" },
    { id: "rows", label: "An email row" },
  ],
};
