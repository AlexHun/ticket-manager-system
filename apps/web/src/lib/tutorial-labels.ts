import { TUTORIAL_PAGE_KEY, type TutorialPageKey } from "@ticket/shared";

/**
 * The eight tutorial pages, named for the editor's list.
 *
 * `nav-items.ts` names the *nav item* a page sits under, which is not the same
 * set: `/tickets` and `/tickets/:id` are one nav entry but two tutorials
 * (`tickets`, `ticketDetail`), and the dashboard's nav label doesn't say which
 * page it is either. This is its own small map for that reason, not a lookup
 * into `NAV_ITEMS`.
 */
export const TUTORIAL_PAGE_LABEL: Record<TutorialPageKey, string> = {
  [TUTORIAL_PAGE_KEY.dashboard]: "Dashboard",
  [TUTORIAL_PAGE_KEY.tickets]: "Tickets",
  [TUTORIAL_PAGE_KEY.ticketDetail]: "Ticket detail",
  [TUTORIAL_PAGE_KEY.pipeline]: "Pipeline",
  [TUTORIAL_PAGE_KEY.knowledge]: "Knowledge base",
  [TUTORIAL_PAGE_KEY.users]: "Users",
  [TUTORIAL_PAGE_KEY.activity]: "Activity",
  [TUTORIAL_PAGE_KEY.outbox]: "Outbox",
};
