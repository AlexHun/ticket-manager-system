/**
 * The wire a usage-history push travels on (#428): `bun run tokens --push <url>`
 * on the laptop, the dev-only `DEVTOOLS_API.usagePush` handler on Railway's
 * `develop` dev server.
 *
 * **Rows, never transcripts.** Railway has no transcripts and never will — they
 * are on the developer's machine — so its Usage page can only report what it is
 * sent. What it is sent is the history's `response` rows, field for field, and
 * the issue listing `gh` gave the laptop. Both schemas are **strict**: a key
 * nobody declared here is a rejected push rather than a stored one, so a field
 * carrying message text cannot be added to the payload by one side alone.
 * `dev/usage-push.test.ts` holds the sending side to the same six fields.
 *
 * **Why the listing rides along rather than `gh` on Railway.** `Dockerfile.dev`
 * is `oven/bun:1-slim` with no `gh`, and a `gh` there would need a token
 * provisioned, rotated and kept out of the test runner's children. The laptop
 * already holds a listing for every scan, so it sends that, and the dev server
 * writes it to the file `GH_ISSUES_FILE` names — the seam `fetchIssueMetadata`
 * already reads, never falling back to `gh`.
 *
 * The schemas live here, beside the other Usage contracts, and not in
 * `@ticket/core` where the app's zod schemas go — and that is a constraint, not
 * a preference. The dev server reaches this module from `vite.config.ts` under
 * Vite's native config loader, which resolves nothing extensionless along the
 * import graph, and `@ticket/core`'s index re-exports with extensionless paths
 * (`./schemas/activity`) — the case `frontend.md` records as a dev server that
 * will not start. It is still defined once, and both ends parse with it. It imports
 * `zod` and nothing else.
 */

import { z } from "zod";

/** The six fields of a stored response, as `TranscriptResponse` names them. The
 *  test that guards the payload compares against this list. */
export const PUSHED_RESPONSE_FIELDS = [
  "id",
  "session",
  "branch",
  "at",
  "out",
  "cacheRead",
] as const;

/** The two identity namespaces a response id is in, plus the line fallback —
 *  `identityOf` in `dev/transcripts.ts`. Its file is a transcript's base name,
 *  never a path. */
const RESPONSE_ID = /^(message|uuid|line):/;

const tokens = z.number().int().nonnegative();

/** One `response` row. */
export const pushedResponseSchema = z.strictObject({
  id: z.string().regex(RESPONSE_ID),
  session: z.string().nullable(),
  branch: z.string().nullable(),
  at: z.string().nullable(),
  out: tokens,
  cacheRead: tokens,
});

export type PushedResponse = z.infer<typeof pushedResponseSchema>;

/**
 * One issue in the shape `gh issue list --json number,title,state,url,labels`
 * prints it, which is what the file `GH_ISSUES_FILE` names must hold, less what
 * this repo never reads: the one label sent is the forecast band's, by name.
 */
export const pushedIssueSchema = z.strictObject({
  number: z.number().int().positive(),
  title: z.string(),
  // `ISSUE_STATE`'s two words. Spelled out because this module imports
  // nothing but zod; `toGhListing` in `dev/issues.ts` is typed against them.
  state: z.enum(["OPEN", "CLOSED"]),
  url: z.string(),
  labels: z.array(z.strictObject({ name: z.string() })),
});

export type PushedIssue = z.infer<typeof pushedIssueSchema>;

/**
 * A whole push. `issues` is null when the laptop had no listing to send (no
 * `gh`), which leaves the one Railway already holds in place.
 */
export const usagePushSchema = z.strictObject({
  responses: z.array(pushedResponseSchema),
  issues: z.array(pushedIssueSchema).nullable(),
});

export type UsagePush = z.infer<typeof usagePushSchema>;

/** What the dev server answers a push with. */
export interface UsagePushResult {
  /** Rows in the push. */
  received: number;
  /** Rows the store did not already hold. Zero on a re-push. */
  inserted: number;
  /** Issues written to the listing file, or null when the push carried none. */
  issues: number | null;
}
