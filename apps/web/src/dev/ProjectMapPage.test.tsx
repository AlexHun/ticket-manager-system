import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { renderRoutes } from "@/test/render";
import { ProjectMapPage } from "./ProjectMapPage";
import {
  EDGE_KIND,
  GUARD,
  LAYER,
  WORKSPACE,
  type ModuleNode,
  type ProjectGraph,
} from "./protocol";

/**
 * The filter bar reaches every tab.
 *
 * Worth a test rather than a look at the page, because the bug it locks down was
 * invisible in exactly the way a look would miss: the search box worked, on two
 * of the four tabs, and not on the one the page opens on. Nothing errored and
 * nothing looked broken — the list simply never moved. So each tab is asserted
 * separately, and the assertion is always "the row that should not match is
 * gone", never "something changed".
 */

// --- Mocks ------------------------------------------------------------------

const mockUseProjectGraph = vi.fn();

// The dev middleware, not `@/lib/api`: these endpoints are served by the Vite dev
// server itself (see the note in `dev-api.ts`), so the hook is the boundary.
vi.mock("./dev-api", () => ({
  useProjectGraph: () => mockUseProjectGraph(),
}));

// --- Fixtures ---------------------------------------------------------------

const TICKETS_PAGE = "apps/web/src/pages/TicketsPage.tsx";
const DASHBOARD_PAGE = "apps/web/src/pages/DashboardPage.tsx";
const TICKETS_ROUTE = "apps/api/src/routes/tickets.ts";

function makeModule(id: string, over: Partial<ModuleNode> = {}): ModuleNode {
  return {
    id,
    name: id.slice(id.lastIndexOf("/") + 1),
    dir: id.slice(0, id.lastIndexOf("/")),
    workspace: id.startsWith("apps/api") ? WORKSPACE.api : WORKSPACE.web,
    layer: id.startsWith("apps/api") ? LAYER.route : LAYER.page,
    code: 100,
    comments: 20,
    bytes: 4000,
    exports: [],
    imports: [],
    importedBy: [],
    externals: [],
    unresolved: [],
    testFile: null,
    isTest: false,
    testable: true,
    ...over,
  };
}

function makeGraph(): ProjectGraph {
  const modules = [
    makeModule(TICKETS_PAGE),
    makeModule(DASHBOARD_PAGE),
    makeModule(TICKETS_ROUTE),
  ];

  return {
    generatedAt: new Date("2026-08-30T12:00:00Z").toISOString(),
    scanMs: 110,
    totals: {
      modules: modules.length,
      code: 300,
      comments: 60,
      edges: 1,
      externals: 2,
      endpoints: 2,
      routes: 2,
      testFiles: 0,
      testedModules: 0,
      testableModules: modules.length,
    },
    workspaces: [
      {
        workspace: WORKSPACE.web,
        dir: "apps/web",
        modules: 2,
        code: 200,
        comments: 40,
        layers: [{ layer: LAYER.page, count: 2 }],
      },
    ],
    modules,
    edges: [{ from: TICKETS_PAGE, to: DASHBOARD_PAGE, kind: EDGE_KIND.static }],
    endpoints: [
      {
        method: "GET",
        path: "/api/tickets",
        guard: GUARD.auth,
        file: TICKETS_ROUTE,
        callers: [TICKETS_PAGE],
      },
      {
        method: "GET",
        path: "/api/stats",
        guard: GUARD.auth,
        file: "apps/api/src/routes/stats.ts",
        callers: [DASHBOARD_PAGE],
      },
    ],
    routes: [
      {
        path: "/tickets",
        component: "TicketsPage",
        file: TICKETS_PAGE,
        lazy: true,
        guards: [],
        redirectTo: null,
      },
      {
        path: "/dashboard",
        component: "DashboardPage",
        file: DASHBOARD_PAGE,
        lazy: true,
        guards: [],
        redirectTo: null,
      },
    ],
    externals: [
      { name: "axios", users: [TICKETS_PAGE], workspaces: [WORKSPACE.web] },
      { name: "recharts", users: [DASHBOARD_PAGE], workspaces: [WORKSPACE.web] },
    ],
    models: [
      {
        name: "Ticket",
        table: "tickets",
        fields: [{ name: "subject", type: "String", optional: false, list: false, relationTo: null }],
      },
      {
        name: "KnowledgeArticle",
        table: "knowledge_articles",
        fields: [{ name: "title", type: "String", optional: false, list: false, relationTo: null }],
      },
    ],
    cycles: [],
    orphans: [TICKETS_PAGE, DASHBOARD_PAGE],
    warnings: [],
  };
}

function renderMap(graph: ProjectGraph = makeGraph()) {
  mockUseProjectGraph.mockReturnValue({
    data: graph,
    isPending: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  });
  return renderRoutes([{ path: "/", element: <ProjectMapPage /> }]);
}

/** Types into the search box and waits out the 150 ms debounce. */
async function search(term: string) {
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("Find a module"));
  await user.type(screen.getByLabelText("Find a module"), term);
}

async function openTab(name: string) {
  await userEvent.setup().click(screen.getByRole("tab", { name }));
}

// --- Tests ------------------------------------------------------------------

describe("the search reaches every tab", () => {
  test("Overview — the tab the page opens on — narrows its module lists", async () => {
    renderMap();

    // Both pages are listed as untested and as orphans before anything is typed.
    expect(screen.getAllByText(DASHBOARD_PAGE).length).toBeGreaterThan(0);
    expect(screen.getAllByText(TICKETS_PAGE).length).toBeGreaterThan(0);

    await search("dashboard");

    // The regression: this used to stay on screen, because Overview never
    // received the query at all.
    await waitFor(() => {
      expect(screen.queryAllByText(TICKETS_PAGE)).toHaveLength(0);
    });
    expect(screen.getAllByText(DASHBOARD_PAGE).length).toBeGreaterThan(0);
  });

  test("Overview matches a package on its own name and on its importers", async () => {
    renderMap();

    // `exact: false` because the badge carries its importer count in the same
    // element, so its text is "axios1" rather than "axios".
    const pkg = (name: string) => screen.queryByText(name, { exact: false });

    // Both packages are asserted inside the same `waitFor` because only the two
    // together describe a *settled* search: `search()` clears the box before it
    // types, so the 150 ms debounce can fire on "" or on a prefix on the way,
    // and either of those transient renders satisfies one half on its own.
    await search("recharts");
    await waitFor(() => {
      expect(pkg("recharts")).toBeInTheDocument();
      expect(pkg("axios")).not.toBeInTheDocument();
    });

    // Searching a *module* keeps the packages that module imports — the point of
    // matching on `users` as well as on the name.
    await search("TicketsPage");
    await waitFor(() => {
      expect(pkg("axios")).toBeInTheDocument();
      expect(pkg("recharts")).not.toBeInTheDocument();
    });
  });

  test("Wiring narrows routes, endpoints and models", async () => {
    renderMap();
    await openTab("Wiring");

    expect(screen.getByText("/api/tickets")).toBeInTheDocument();
    expect(screen.getByText("/api/stats")).toBeInTheDocument();

    await search("tickets");

    await waitFor(() => {
      expect(screen.queryByText("/api/stats")).not.toBeInTheDocument();
    });
    expect(screen.getByText("/api/tickets")).toBeInTheDocument();
    // Matched through its caller rather than its own path, which is the join the
    // Wiring tab exists to show.
    expect(screen.getByText("/tickets")).toBeInTheDocument();
    expect(screen.queryByText("/dashboard")).not.toBeInTheDocument();
    // A model is not a module, so it matches on its own name.
    expect(screen.getByText("Ticket")).toBeInTheDocument();
    expect(screen.queryByText("KnowledgeArticle")).not.toBeInTheDocument();
  });

  test("Wiring says which kind of thing came up empty", async () => {
    renderMap();
    await openTab("Wiring");

    await search("nothing-matches-this");

    await waitFor(() => {
      expect(screen.getByText("No endpoint matches the search.")).toBeInTheDocument();
    });
    expect(screen.getByText("No client route matches the search.")).toBeInTheDocument();
    expect(screen.getByText("No model matches the search.")).toBeInTheDocument();
  });

  test("Modules narrows to the matching rows", async () => {
    renderMap();
    await openTab("Modules");

    const rowsBefore = screen.getAllByRole("row");
    await search("dashboard");

    await waitFor(() => {
      // One header row plus the single hit.
      expect(screen.getAllByRole("row")).toHaveLength(2);
    });
    expect(rowsBefore.length).toBeGreaterThan(2);
  });
});

describe("the filter bar's counter", () => {
  test("reports the whole set at rest and the matching set while searching", async () => {
    renderMap();

    expect(
      screen.getByText(/3 of 3 modules in Graph and Modules/),
    ).toBeInTheDocument();

    await search("dashboard");

    // The number used to be frozen: it was computed before the search applied, so
    // typing moved nothing on screen *and* nothing in the count.
    await waitFor(() => {
      expect(screen.getByText(/1 of 3 modules match/)).toBeInTheDocument();
    });
  });
});

describe("selecting a module the search would hide", () => {
  /**
   * Reachable because a row matches on *any* of its fields: searching an endpoint
   * path shows that row, and the caller link inside it is a module the term says
   * nothing about. Clicking it used to leave you looking at an inspector for a
   * file the Modules tab refused to list.
   */
  test("clears the search rather than stranding the pick", async () => {
    renderMap();
    await openTab("Wiring");
    await search("/api/stats");

    await waitFor(() => {
      expect(screen.queryByText("/api/tickets")).not.toBeInTheDocument();
    });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "pages/DashboardPage.tsx" }));

    expect(screen.getByLabelText("Find a module")).toHaveValue("");
    // The pick stuck, and the inspector it opened offers the way back out.
    expect(
      screen.getByRole("button", { name: "Clear selection" }),
    ).toBeInTheDocument();
  });

  test("leaves a search alone when the pick already matches it", async () => {
    renderMap();
    await openTab("Wiring");
    await search("dashboard");

    await waitFor(() => {
      expect(screen.queryByText("/api/tickets")).not.toBeInTheDocument();
    });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "pages/DashboardPage.tsx" }));

    expect(screen.getByLabelText("Find a module")).toHaveValue("dashboard");
  });
});
