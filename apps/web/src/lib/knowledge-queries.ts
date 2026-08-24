/**
 * Query keys for the knowledge base.
 *
 * `all` is the prefix everything else nests under, so one invalidate after a
 * write reaches the list *and* whichever article's revision history is open —
 * which matters more here than it does for tickets: the revision list is the
 * audit trail, and an audit trail that does not show the change you just made is
 * worse than no audit trail, because it looks like the change was not recorded.
 */
export const knowledgeKeys = {
  all: ["knowledge"] as const,
  list: ["knowledge", "list"] as const,
  revisions: (id: string) => ["knowledge", "revisions", id] as const,
  /** Every pending revision, across the whole corpus — the review queue. */
  pending: ["knowledge", "pending"] as const,
};
