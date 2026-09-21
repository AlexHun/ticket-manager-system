/**
 * The paths the dev-only Vite middleware answers on, and the one thing all
 * three dev tools share.
 *
 * **Why this is its own module** (#284). `protocol.ts` used to hold three
 * unrelated contracts in one file — the project map's graph, the test runner's
 * stream and the Usage report — which is why it appeared in fifteen of the
 * twenty-four commits that built the Usage page: a slice touching none of the
 * other two still had to edit the module they lived in. Its thirty importers
 * clustered by page — sixteen Usage, eleven map, five test runner, and only
 * three naming more than one — so it split along that line into
 * `./map-protocol`, `./test-run-protocol` and `./usage-protocol`.
 *
 * This record was the one name that did not cluster. Every tool's handler in
 * `apps/web/dev/plugin.ts` registers a path out of it and the browser client in
 * `./dev-api` calls all three, so it belongs to none of the three and to all of
 * them. Putting it in one would have made the other two read that page's
 * contract to find a route — the map importing the Usage module for the sake of
 * `graph` — which is exactly the coupling the split was for. Copying it per
 * tool was the other option and is worse: these strings are a *pairing* between
 * a client and a handler, and three copies are three chances for one end to be
 * renamed alone, with nothing failing until the request 404s at runtime. So: a
 * fourth module, small on purpose, holding the one fact that really is shared.
 *
 * It lives under `src/` for the reason the three contracts do — the browser
 * half reaches it through the `@/` alias, the node half by relative path — and
 * it has no imports of its own and must keep none. None of it ships: the plugin is
 * registered `apply: "serve"` and every importer sits behind
 * `import.meta.env.DEV`.
 */

/** Paths the dev middleware answers on. Deliberately *not* under `/__dev`,
 *  which is the client-side route prefix — keeping them apart means the SPA
 *  fallback and the API can never shadow each other. */
export const DEVTOOLS_API = {
  graph: "/__devtools/graph",
  suites: "/__devtools/suites",
  /** One SSE stream carrying every suite's output and the queue's state. */
  events: "/__devtools/events",
  start: "/__devtools/start",
  cancel: "/__devtools/cancel",
  clear: "/__devtools/clear",
  /** `POST` gathers a fresh reading of the local transcripts; `UsageReport` in
   *  `./usage-protocol` is where the absence of a `GET` beside it is argued. */
  usage: "/__devtools/usage",
} as const;
