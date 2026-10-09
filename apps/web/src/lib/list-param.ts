/**
 * The tickets list's URL param names. They are the API's param names, so the
 * list URL *is* the request — there is no second vocabulary to keep in step.
 *
 * Import-free, like `routes.ts`, so `welcome-steps.ts` can build a filtered
 * list's address from it and `tests/e2e/demo-welcome.spec.ts` can still load
 * that module (#464). `ticket-list-params.ts`, which parses and writes them,
 * pulls in zod and the schemas, and re-exports this.
 */
export const LIST_PARAM = {
  sort: "sort",
  order: "order",
  status: "status",
  category: "category",
  assignedTo: "assignedTo",
  q: "q",
  page: "page",
  pageSize: "pageSize",
} as const;
