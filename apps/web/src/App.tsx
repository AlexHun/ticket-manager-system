import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { AppShell } from "@/components/layout/AppShell";
import { RouteFallback } from "@/components/RouteFallback";
import { LoginPage } from "@/pages/LoginPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

/**
 * Every page but the login screen is loaded on demand.
 *
 * Eagerly imported, these four pull Recharts and TanStack Table into the entry
 * chunk, so a signed-out visitor downloads the whole charting library before
 * the password field can render. Split, each route fetches its own code when
 * it is first visited — and the dashboard's charts, by far the heaviest thing
 * here, stay off the critical path for everyone who never opens it.
 *
 * `LoginPage` stays a static import on purpose: it is where every signed-out
 * visitor lands, and lazying it would put a second round trip in front of the
 * one screen that has to be fast.
 */
const DashboardPage = lazy(() =>
  import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const TicketsPage = lazy(() =>
  import("@/pages/TicketsPage").then((m) => ({ default: m.TicketsPage })),
);
const TicketDetailPage = lazy(() =>
  import("@/pages/TicketDetailPage").then((m) => ({
    default: m.TicketDetailPage,
  })),
);
const UsersPage = lazy(() =>
  import("@/pages/UsersPage").then((m) => ({ default: m.UsersPage })),
);
const KnowledgePage = lazy(() =>
  import("@/pages/KnowledgePage").then((m) => ({ default: m.KnowledgePage })),
);
const PipelinePage = lazy(() =>
  import("@/pages/PipelinePage").then((m) => ({ default: m.PipelinePage })),
);

/**
 * The dev tools, at `/__dev` — the project map and the test runner.
 *
 * The `import.meta.env.DEV` guard is what keeps them out of production, and it
 * works because Vite substitutes the literal `false` there: the ternary folds,
 * the `import()` becomes unreachable, and Rollup emits no chunk for `@/dev` at
 * all. A runtime check inside the component would not do this — the code would
 * still ship. Verify with the bundle treemap in `.vite/stats.html`, which is
 * where a leak would show up.
 *
 * One lazy route rather than two: everything under `/__dev` lives in that module,
 * including its own shell and nav, so `App.tsx` only has to know the prefix.
 */
const DevRoutes = import.meta.env.DEV
  ? lazy(() => import("@/dev/DevRoutes").then((m) => ({ default: m.DevRoutes })))
  : null;

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          {/* The shell renders the sidebar, the top bar and the app's one
              <main>; the pages inside render only their own content. */}
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/tickets" element={<TicketsPage />} />
            <Route path="/tickets/:id" element={<TicketDetailPage />} />
            {/* Nested now, where it used to sit beside ProtectedRoute and
                repeat the session check: inside the shell the admin gate is
                just the role check it always was, and /users stops tearing
                down and rebuilding the sidebar on every visit. */}
            <Route element={<AdminRoute />}>
              <Route path="/users" element={<UsersPage />} />
              {/* The knowledge base is admin-only for a stronger reason than
                  the user list is: editing an article writes into the system
                  prompt of the feature that answers customers unattended. This
                  guard is UX — `requireAdmin` on every route in
                  `apps/api/src/routes/knowledge.ts` is the control. */}
              <Route path="/knowledge" element={<KnowledgePage />} />
              {/* Admin-only for two reasons at once: it reads back how the
                  unattended pipeline is behaving, and it can post an email into
                  it. `requireAdmin` on every route in
                  `apps/api/src/routes/pipeline.ts` is the control. */}
              <Route path="/pipeline" element={<PipelinePage />} />
            </Route>
            {/* Inside the shell, so an unknown address keeps the sidebar and
                says so rather than redirecting to the dashboard and pretending
                the link worked. `Routes` scores matches by specificity rather
                than order, so the `/__dev/*` route below still wins over this
                splat for its own paths. */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
        {/* Outside ProtectedRoute deliberately: the project map reads the source
            tree through the Vite dev server, so it must stay reachable when the
            API or the database is down — see the note in dev/DevRoutes.tsx.
            `null` in production, and Routes ignores a non-element child. */}
        {DevRoutes && <Route path="/__dev/*" element={<DevRoutes />} />}
      </Routes>
    </Suspense>
  );
}
