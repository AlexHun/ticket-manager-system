import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { AppShell } from "@/components/layout/AppShell";
import { RouteFallback } from "@/components/RouteFallback";
import { LoginPage } from "@/pages/LoginPage";

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
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
