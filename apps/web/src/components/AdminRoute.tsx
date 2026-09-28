import { Navigate, Outlet } from "react-router-dom";
import { USER_ROLE } from "@ticket/shared";
import { RouteFallback } from "@/components/RouteFallback";
import { useSession } from "@/lib/auth-client";
import { ROUTE } from "@/lib/routes";
import { viewerOf } from "@/lib/viewer";
import { NotFoundPage } from "@/pages/NotFoundPage";

/**
 * The admin screens' gate, in two strengths (#320) named after the API guards
 * they stand in front of. All of this is UX; `requireAdmin` and
 * `requireAdminView` are the control.
 *
 * Two components rather than one with a prop because `App.tsx` mounts them as
 * `Component: Name`, which is also the form the `/__dev/map` scanner reads a
 * route's wrappers from.
 */

/**
 * Admins only — Users and Outbox. A demo session gets the not-found page rather
 * than a redirect, so a typed URL says nothing about what is there (R3).
 */
export function AdminRoute() {
  return <AdminGate allowDemo={false} />;
}

/**
 * Admins and demo sessions — Pipeline, Knowledge, Evals, Activity and
 * Tutorials, whose reads the API opens to a demo with `requireAdminView`.
 */
export function AdminViewRoute() {
  return <AdminGate allowDemo />;
}

function AdminGate({ allowDemo }: { allowDemo: boolean }) {
  const { data: session, isPending } = useSession();

  // See ProtectedRoute — same wait, same holding screen. Sized to the frame
  // rather than the viewport: this route sits inside the shell, so the sidebar
  // and top bar are already on screen around it.
  if (isPending) return <RouteFallback className="min-h-0 flex-1" />;
  if (!session) return <Navigate to={ROUTE.login.path} replace />;

  const viewer = viewerOf(session.user);
  if (viewer.role === USER_ROLE.admin) return <Outlet />;
  if (viewer.demo) return allowDemo ? <Outlet /> : <NotFoundPage />;
  // An agent, from either gate: unchanged by the demo.
  return <Navigate to={ROUTE.dashboard.path} replace />;
}
