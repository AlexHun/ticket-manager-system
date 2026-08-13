/**
 * Query keys for ticket data.
 *
 * Written down once because a mutation has to name the exact entry a page is
 * reading: assignment updates the detail cache and marks the list stale, and a
 * key spelled slightly differently in two files would silently do neither.
 *
 * Everything sits under the same `all` prefix, so one invalidate reaches every
 * ticket query.
 */
export const ticketKeys = {
  all: ["tickets"] as const,

  /** `id` is stringified because the detail page reads it from the URL. */
  detail: (id: string | number) => ["tickets", "detail", String(id)] as const,

  /**
   * Matches every cached detail entry, whatever id it was keyed by.
   *
   * A mutation uses this to find the entry holding a ticket by the ticket's own
   * id, rather than by guessing how the URL spelled it — `/tickets/012` and
   * `/tickets/12` are the same ticket but not the same key.
   */
  isDetailKey: (key: readonly unknown[]) =>
    key[0] === "tickets" && key[1] === "detail",

  /** The params object is part of the key: each filter/sort/page is its own entry. */
  list: (params: object) => ["tickets", params] as const,

  /**
   * The sidebar's saved-view counts. No params — the server derives every view
   * from the session.
   *
   * Under the `all` prefix like everything else, so a ticket mutation marks it
   * stale. Note that marking is not enough on its own here: this query has a
   * permanently mounted observer, and the sweeps that reach it pass
   * `refetchType: "none"`. `useTicketField` therefore invalidates this key
   * separately, and on purpose — see the comment there.
   */
  views: ["tickets", "views"] as const,

  /**
   * One dashboard slice, keyed by range + scope.
   *
   * Under the `all` prefix on purpose: `useTicketField`'s
   * `invalidateQueries({ queryKey: ticketKeys.all, refetchType: "none" })` then
   * reaches the dashboard too, so resolving a ticket on the detail page marks
   * the stats stale without fetching them, and they reload on the way home.
   *
   * `isDetailKey` stays correct alongside this — it tests `key[1] === "detail"`.
   */
  stats: (params: object) => ["tickets", "stats", params] as const,
};

/**
 * The assignee roster, deliberately outside the `tickets` prefix: it is shared
 * by every ticket and unchanged by assigning one, so an invalidate that sweeps
 * ticket data should leave it alone.
 */
export const ticketAssigneesKey = ["ticket-assignees"] as const;
