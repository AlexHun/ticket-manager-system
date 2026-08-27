import type { TutorialPageKey } from "@ticket/shared";

/**
 * Query keys for tutorials — the admin editor's list, and each page's own
 * status.
 *
 * `list` is one key because the editor is one request: `GET /api/tutorials`
 * returns every page's content in a single array (see `tutorialsRouter`),
 * unlike the knowledge base, which has a list and a separate per-article
 * revision history. A save invalidates `list` and every open dialog's
 * `defaultValues` refreshes from the refetched row.
 *
 * `status` is per page key rather than a single entry, because `<Tutorial>`
 * mounts once per page and each mount needs its own `shouldShow` — marking
 * the dashboard's tutorial seen must not touch the cache entry the tickets
 * page reads.
 */
export const tutorialKeys = {
  list: ["tutorials", "list"] as const,
  status: (pageKey: TutorialPageKey) =>
    ["tutorials", "status", pageKey] as const,
};
