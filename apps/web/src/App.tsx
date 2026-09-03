import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { AppShell } from "@/components/layout/AppShell";
import { RouteFallback } from "@/components/RouteFallback";
import { LoginPage } from "@/pages/LoginPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ticketDetailLoader } from "@/pages/TicketDetailPage.loader";
import { ticketsLoader } from "@/pages/TicketsPage.loader";

/**
 * Every page but the login screen is loaded on demand, via `lazy` rather than
 * `React.lazy` — the route-object equivalent, and the one a static `loader`
 * can run alongside instead of after. `/tickets` and `/tickets/:id` pair the
 * two; `/` is the last in-scope route still fetching on mount.
 *
 * Eagerly imported, the pages below pull Recharts and TanStack Table into the
 * entry chunk, so a signed-out visitor downloads the whole charting library
 * before the password field can render. Split, each route fetches its own
 * code when it is first visited — and the dashboard's charts, by far the
 * heaviest thing here, stay off the critical path for everyone who never
 * opens it.
 *
 * `LoginPage` stays a static import on purpose: it is where every signed-out
 * visitor lands, and lazying it would put a second round trip in front of the
 * one screen that has to be fast.
 */

/**
 * The dev tools, at `/__dev` — the project map and the test runner.
 *
 * The `import.meta.env.DEV` guard is what keeps them out of production, and it
 * works because Vite substitutes the literal `false` there: the ternary folds,
 * the branch carrying the `lazy` route (and the `import()` inside it) becomes
 * unreachable, and Rollup emits no chunk for `@/dev` at all — the same
 * fold-then-tree-shake this relied on as a plain `React.lazy(...) : null`.
 * Verify with the bundle treemap in `.vite/stats.html`, which is where a leak
 * would show up.
 *
 * One lazy route rather than two: everything under `/__dev` lives in that
 * module, including its own shell and nav, so this file only has to know the
 * prefix.
 */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: "/__dev/*",
        lazy: () =>
          import("@/dev/DevRoutes").then((m) => ({ Component: m.DevRoutes })),
      },
    ]
  : [];

export const router = createBrowserRouter([
  {
    /**
     * Pathless — every route below is a child of this one, so it always
     * matches. That makes its `HydrateFallback` the data-router equivalent
     * of the old top-level `<Suspense fallback={<RouteFallback />}>` around
     * `<Routes>`: a route with no static `loader` still has a `lazy` module
     * to await before the router can render anything, and only a matched
     * route's own `HydrateFallback` covers that gap on the very first load —
     * without one here, a cold visit to a deep link like `/tickets/3` would
     * render nothing at all until the chunk arrived. It fires once, for that
     * initial navigation only; every navigation after that is handled by
     * `AppShell`'s own inner `Suspense` boundary below.
     */
    HydrateFallback: RouteFallback,
    children: [
      { path: "/login", Component: LoginPage },
      // Signed-out, like /login: somebody following an invitation has no
      // session yet, and a colleague resetting a forgotten password cannot
      // get one. Both must sit outside ProtectedRoute or the link bounces
      // straight back to sign-in.
      { path: "/forgot-password", Component: ForgotPasswordPage },
      { path: "/reset-password", Component: ResetPasswordPage },
      {
        Component: ProtectedRoute,
        children: [
          {
            // The shell renders the sidebar, the top bar and the app's one
            // <main>; the pages inside render only their own content.
            Component: AppShell,
            children: [
              {
                path: "/",
                lazy: () =>
                  import("@/pages/DashboardPage").then((m) => ({
                    Component: m.DashboardPage,
                  })),
              },
              {
                path: "/tickets",
                // Re-runs on every filter, sort and page change, not just on
                // entry: they all move the search string, and React Router
                // revalidates when it does. That is the intended shape — see
                // the note in the loader on why one interaction still costs
                // one request.
                loader: ticketsLoader,
                lazy: () =>
                  import("@/pages/TicketsPage").then((m) => ({
                    Component: m.TicketsPage,
                  })),
              },
              {
                path: "/tickets/:id",
                // Statically imported, unlike the component beside it, and
                // that is what makes it worth having: React Router runs a
                // static `loader` in parallel with the route's `lazy`
                // `Component`, so the ticket is already being fetched while
                // this page's chunk downloads. `lazy` fills in only what the
                // route object leaves undefined, so it never overwrites this.
                loader: ticketDetailLoader,
                lazy: () =>
                  import("@/pages/TicketDetailPage").then((m) => ({
                    Component: m.TicketDetailPage,
                  })),
              },
              {
                // Nested now, where it used to sit beside ProtectedRoute and
                // repeat the session check: inside the shell the admin gate is
                // just the role check it always was, and /users stops tearing
                // down and rebuilding the sidebar on every visit.
                Component: AdminRoute,
                children: [
                  {
                    path: "/users",
                    lazy: () =>
                      import("@/pages/UsersPage").then((m) => ({
                        Component: m.UsersPage,
                      })),
                  },
                  // The knowledge base is admin-only for a stronger reason
                  // than the user list is: editing an article writes into the
                  // system prompt of the feature that answers customers
                  // unattended. This guard is UX — `requireAdmin` on every
                  // route in `apps/api/src/routes/knowledge.ts` is the
                  // control.
                  {
                    path: "/knowledge",
                    lazy: () =>
                      import("@/pages/KnowledgePage").then((m) => ({
                        Component: m.KnowledgePage,
                      })),
                  },
                  {
                    path: "/outbox",
                    lazy: () =>
                      import("@/pages/OutboxPage").then((m) => ({
                        Component: m.OutboxPage,
                      })),
                  },
                  // Admin-only for two reasons at once: it reads back how the
                  // unattended pipeline is behaving, and it can post an email
                  // into it. `requireAdmin` on every route in
                  // `apps/api/src/routes/pipeline.ts` is the control.
                  {
                    path: "/pipeline",
                    lazy: () =>
                      import("@/pages/PipelinePage").then((m) => ({
                        Component: m.PipelinePage,
                      })),
                  },
                  // Admin-only for the same reason knowledge and pipeline
                  // are: it reads across account and automation history an
                  // agent has no route to elsewhere. `requireAdmin` on every
                  // route in `apps/api/src/routes/activity.ts` is the
                  // control; this guard is UX.
                  {
                    path: "/activity",
                    lazy: () =>
                      import("@/pages/ActivityPage").then((m) => ({
                        Component: m.ActivityPage,
                      })),
                  },
                  // Admin-only for the same reason the knowledge base is:
                  // this is where the copy shown to every user gets written.
                  // No separate API guard note needed beyond `requireAdmin`
                  // on `GET /api/tutorials` and `PUT /api/tutorials/:pageKey`
                  // — see `apps/api/src/routes/tutorials.ts`.
                  {
                    path: "/tutorials",
                    lazy: () =>
                      import("@/pages/TutorialsPage").then((m) => ({
                        Component: m.TutorialsPage,
                      })),
                  },
                ],
              },
              // Inside the shell, so an unknown address keeps the sidebar and
              // says so rather than redirecting to the dashboard and
              // pretending the link worked. Route matching scores by
              // specificity rather than order, so the `/__dev/*` route below
              // still wins over this splat for its own paths.
              { path: "*", Component: NotFoundPage },
            ],
          },
        ],
      },
      // Outside ProtectedRoute deliberately: the project map reads the source
      // tree through the Vite dev server, so it must stay reachable when the
      // API or the database is down — see the note in dev/DevRoutes.tsx.
      // Empty in production, and an empty array contributes no route.
      ...devRoutes,
    ],
  },
]);
