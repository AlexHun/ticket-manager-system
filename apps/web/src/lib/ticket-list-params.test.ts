import { describe, expect, test } from "vitest";
import {
  ASSIGNEE_NONE,
  CATEGORY_NONE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_TICKET_SORT,
  FIRST_PAGE,
  MAX_PAGE_SIZE,
  SORT_ORDER,
  STATUS_BACKLOG,
  TICKET_CATEGORY,
  TICKET_SEARCH_MAX_LENGTH,
  TICKET_SORT_FIELD,
  TICKET_STATUS,
} from "@ticket/shared";
import {
  LIST_PARAM,
  parseTicketListParams,
  writeTicketListParams,
} from "./ticket-list-params";

/**
 * The ticket list's URL rules, without a ticket list.
 *
 * Per-field fallback, dropped defaults and the page-drop rule used to be
 * asserted only by rendering a seven-column table, six controls and two Radix
 * Selects, then reading the rules back out of a request body — which meant a
 * question about one `URLSearchParams` cost a mount, a fetch and a click. The
 * module was already pure and self-contained, so these are the same rules read
 * straight off it. What stays in `TicketsPage.test.tsx` is the wiring: that the
 * page parses the entry URL, that a control's change reaches the URL through
 * this writer, and that the writer is handed the *current* params rather than
 * an empty set.
 */

/** `?a=b&c=d` as the parser sees it. */
function params(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

/** The parse of an empty URL — every field at its server-side default. */
const DEFAULT_STATE = {
  sort: DEFAULT_TICKET_SORT.field,
  order: DEFAULT_TICKET_SORT.order,
  status: undefined,
  category: undefined,
  assignedTo: undefined,
  q: undefined,
  page: FIRST_PAGE,
  pageSize: DEFAULT_PAGE_SIZE,
};

describe("parseTicketListParams", () => {
  test("an empty URL is every default, with no filter narrowing anything", () => {
    expect(parseTicketListParams(params(""))).toEqual(DEFAULT_STATE);
  });

  test("reads every param a full URL carries", () => {
    expect(
      parseTicketListParams(
        params(
          "sort=subject&order=asc&status=Open&category=Technical&assignedTo=u_123&q=login&page=2&pageSize=10",
        ),
      ),
    ).toEqual({
      sort: TICKET_SORT_FIELD.subject,
      order: SORT_ORDER.asc,
      status: TICKET_STATUS.Open,
      category: TICKET_CATEGORY.Technical,
      assignedTo: "u_123",
      q: "login",
      page: 2,
      pageSize: 10,
    });
  });

  test("accepts the three query-param sentinels", () => {
    // None of these is a real status, category or user id — they are how "the
    // backlog", "no category" and "nobody" travel in a query string.
    expect(
      parseTicketListParams(
        params(
          `status=${STATUS_BACKLOG}&category=${CATEGORY_NONE}&assignedTo=${ASSIGNEE_NONE}`,
        ),
      ),
    ).toMatchObject({
      status: STATUS_BACKLOG,
      category: CATEGORY_NONE,
      assignedTo: ASSIGNEE_NONE,
    });
  });

  describe("per-field fallback", () => {
    // The point of the design: a URL is user-editable and stale links outlive
    // deploys, so one bad param must not throw away the good ones beside it.
    test("keeps the valid params beside the invalid ones", () => {
      expect(
        parseTicketListParams(
          params("sort=bogus&page=abc&status=Nope&pageSize=10&q=login"),
        ),
      ).toEqual({
        ...DEFAULT_STATE,
        pageSize: 10,
        q: "login",
      });
    });

    test.each([
      ["sort", "sort=bogus", { sort: DEFAULT_TICKET_SORT.field }],
      ["order", "order=sideways", { order: DEFAULT_TICKET_SORT.order }],
      // `Processing` is a real status the list refuses to return, so the filter
      // rejects it too rather than offering a guaranteed-empty page.
      ["status", `status=${TICKET_STATUS.Processing}`, { status: undefined }],
      ["category", "category=Fictional", { category: undefined }],
      ["page", "page=abc", { page: FIRST_PAGE }],
      ["pageSize", "pageSize=abc", { pageSize: DEFAULT_PAGE_SIZE }],
    ])("%s falls back on a garbage value", (_field, search, expected) => {
      expect(parseTicketListParams(params(search))).toMatchObject(expected);
    });

    test.each([
      ["zero", "page=0"],
      ["negative", "page=-3"],
      ["fractional", "page=2.5"],
      ["empty", "page="],
    ])("a %s page falls back to the first one", (_shape, search) => {
      expect(parseTicketListParams(params(search)).page).toBe(FIRST_PAGE);
    });

    test("a page size past the cap falls back to the default", () => {
      // The cap is the API's, and it is the reason the two share a schema: a
      // raised ceiling can't be accepted here and rejected there.
      expect(
        parseTicketListParams(params(`pageSize=${MAX_PAGE_SIZE + 1}`)).pageSize,
      ).toBe(DEFAULT_PAGE_SIZE);
      expect(
        parseTicketListParams(params(`pageSize=${MAX_PAGE_SIZE}`)).pageSize,
      ).toBe(MAX_PAGE_SIZE);
    });

    test("an over-long search falls back to no search", () => {
      const tooLong = "x".repeat(TICKET_SEARCH_MAX_LENGTH + 1);
      expect(parseTicketListParams(params(`q=${tooLong}`)).q).toBeUndefined();
      expect(parseTicketListParams(params(`q=${tooLong.slice(1)}`)).q).toBe(
        tooLong.slice(1),
      );
    });

    test("an empty assignee is no filter rather than a filter on nothing", () => {
      expect(
        parseTicketListParams(params("assignedTo=")).assignedTo,
      ).toBeUndefined();
    });

    test("the schema trims the search, so whitespace narrows nothing", () => {
      // Not `undefined` — the schema trims first, and `""` passes. It is
      // `ticketListQueryParams` that drops the empty string before it can
      // become a request param and a second cache key.
      expect(parseTicketListParams(params("q=%20%20")).q).toBe("");
      expect(parseTicketListParams(params("q=%20login%20")).q).toBe("login");
    });
  });
});

describe("writeTicketListParams", () => {
  /** The patch applied to `search`, as a plain object. */
  function write(
    search: string,
    patch: Parameters<typeof writeTicketListParams>[1],
  ): Record<string, string> {
    return Object.fromEntries(writeTicketListParams(params(search), patch));
  }

  test("writes a chosen value", () => {
    expect(write("", { status: TICKET_STATUS.Resolved })).toEqual({
      status: TICKET_STATUS.Resolved,
    });
  });

  test("keeps the params the patch does not mention", () => {
    // What makes one interaction one request: re-sorting a filtered list must
    // not lose the filter.
    expect(
      write("status=Open&q=login", { sort: TICKET_SORT_FIELD.subject }),
    ).toEqual({
      status: TICKET_STATUS.Open,
      q: "login",
      sort: TICKET_SORT_FIELD.subject,
    });
  });

  test.each([
    ["sort", { sort: DEFAULT_TICKET_SORT.field }],
    ["order", { order: DEFAULT_TICKET_SORT.order }],
    ["page", { page: FIRST_PAGE }],
    ["pageSize", { pageSize: DEFAULT_PAGE_SIZE }],
  ])("drops %s when it lands back on the server default", (field, patch) => {
    // The resting URL is a bare `/tickets`, so a shared link carries only what
    // was actually chosen.
    expect(write(`${field}=zzz`, patch)).not.toHaveProperty(field);
  });

  test("drops a param cleared to undefined or to an empty string", () => {
    expect(write("status=Open&category=Refund", { status: undefined })).toEqual({
      category: TICKET_CATEGORY.Refund,
    });
    expect(write("q=login", { q: "" })).toEqual({});
  });

  describe("the page", () => {
    test("is dropped by any patch that does not name it", () => {
      // Re-sorting and re-filtering rebuild the result set, so page 3 of the
      // old one means nothing in the new one and is often past the end.
      expect(write("page=3", { sort: TICKET_SORT_FIELD.subject })).not.toHaveProperty(
        LIST_PARAM.page,
      );
      expect(write("page=3", { status: TICKET_STATUS.Open })).not.toHaveProperty(
        LIST_PARAM.page,
      );
      expect(write("page=3", { pageSize: 50 })).not.toHaveProperty(
        LIST_PARAM.page,
      );
      // Including an empty patch: nothing named the page, so it goes.
      expect(write("page=3", {})).not.toHaveProperty(LIST_PARAM.page);
    });

    test("survives an explicit page move", () => {
      expect(write("page=3&status=Open", { page: 4 })).toEqual({
        page: "4",
        status: TICKET_STATUS.Open,
      });
    });

    test("an explicit move back to the first page clears it rather than writing 1", () => {
      expect(write("page=3", { page: FIRST_PAGE })).toEqual({});
    });
  });

  test("returns a new URLSearchParams rather than editing the current one", () => {
    // The page passes the router's own `prev` in, and mutating it would be a
    // write React Router never heard about.
    const current = params("status=Open");
    const next = writeTicketListParams(current, { status: undefined });

    expect(next).not.toBe(current);
    expect(current.get(LIST_PARAM.status)).toBe(TICKET_STATUS.Open);
    expect(next.get(LIST_PARAM.status)).toBeNull();
  });
});
