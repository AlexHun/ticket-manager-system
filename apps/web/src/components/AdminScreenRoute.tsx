import { Navigate, Outlet, useMatches } from "react-router-dom";
import {
  DEMO_SEES_ADMIN_SCREEN,
  USER_ROLE,
  type AdminScreen,
} from "@ticket/shared";
import { RouteFallback } from "@/components/RouteFallback";
import { useSession } from "@/lib/auth-client";
import { ROUTE } from "@/lib/routes";
import { viewerOf } from "@/lib/viewer";
import { NotFoundPage } from "@/pages/NotFoundPage";

/** What an admin screen's route carries as its `handle`: which screen it is. */
interface AdminScreenHandle {
  adminScreen: AdminScreen;
}

/** The `handle` that names a route's admin screen, for `AdminScreenRoute`. */
export function adminScreen(screen: AdminScreen): AdminScreenHandle {
  return { adminScreen: screen };
}

/** The screen the deepest matched route names, or `null` when none does. */
function matchedScreen(handles: unknown[]): AdminScreen | null {
  for (const handle of [...handles].reverse()) {
    const screen = (handle as Partial<AdminScreenHandle> | undefined)
      ?.adminScreen;
    if (screen) return screen;
  }
  return null;
}

/**
 * The admin screens' gate. Admins pass everywhere; a demo session (#320)
 * passes where `DEMO_SEES_ADMIN_SCREEN` says it sees the screen (#368), which
 * each route under this one names with `handle: adminScreen(...)`. A route
 * that names none is shut to a demo, so nothing defaults to open.
 *
 * All of this is UX; `requireAdmin` and `requireAdminView` are the control.
 */
export function AdminScreenRoute() {
  const { data: session, isPending } = useSession();
  const screen = matchedScreen(useMatches().map((match) => match.handle));

  // See ProtectedRoute — same wait, same holding screen. Sized to the frame
  // rather than the viewport: this route sits inside the shell, so the sidebar
  // and top bar are already on screen around it.
  if (isPending) return <RouteFallback className="min-h-0 flex-1" />;
  if (!session) return <Navigate to={ROUTE.login.path} replace />;

  const viewer = viewerOf(session.user);
  if (viewer.role === USER_ROLE.admin) return <Outlet />;
  // Not found rather than a redirect, so a typed URL to a screen a demo is
  // kept from says nothing about what is there (R3).
  if (viewer.demo) {
    return screen !== null && DEMO_SEES_ADMIN_SCREEN[screen] ? (
      <Outlet />
    ) : (
      <NotFoundPage />
    );
  }
  // An agent: unchanged by the demo.
  return <Navigate to={ROUTE.dashboard.path} replace />;
}
