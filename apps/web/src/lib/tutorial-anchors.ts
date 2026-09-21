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
    { id: "summary", label: "AI summary panel" },
    { id: "thread", label: "The message thread" },
    { id: "reply", label: "The reply composer" },
    { id: "polish", label: "AI polish button" },
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
  // The last three live on a run card, which makes them the only anchors in
  // this file a page can fail to draw for a reason that is not a tagging
  // mistake. Three such reasons, and the first is the ordinary one: a
  // deployment nobody has run an eval on has no card to point at, a run still
  // filling in has no metrics yet, and `cases` sits inside the card's own
  // fold, so it is there only while that card is open — which the newest one
  // is on arrival. Those land on the centered callout, which is the fallback
  // doing its job rather than a step pointing at nothing, and the copy beside
  // them is written to read the same either way.
  //
  // `status` and `metrics` are also the only ids on this page that are not
  // unique: a card draws them, and there are up to `EVAL_RUN_LIMIT` cards.
  // `Tutorial` resolves by `document.querySelector`, so a step points at the
  // newest run — which is the one an admin came to read, and the one the page
  // leaves open. Worth knowing before anything reorders that list.
  [TUTORIAL_PAGE_KEY.evals]: [
    { id: "run", label: "The Run button" },
    { id: "corpus", label: "Corpus selector" },
    { id: "status", label: "A run's name and badges" },
    { id: "metrics", label: "A run's headline rates" },
    { id: "cases", label: "The per-case table" },
  ],
};
