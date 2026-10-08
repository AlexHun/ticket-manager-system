import { Navigate, Outlet } from "react-router-dom";
import { RouteFallback } from "@/components/RouteFallback";
import { useSession } from "@/lib/auth-client";
import { ROUTE } from "@/lib/routes";
import { viewerOf } from "@/lib/viewer";
import { NotFoundPage } from "@/pages/NotFoundPage";

/**
 * The gate for a screen only a demo session may open: the welcome
 * (demo-welcome PRD, R10). The inverse of `AdminScreenRoute`'s demo half —
 * an admin or an agent gets the not-found page rather than a redirect, so a
 * typed address says nothing about what is there.
 *
 * UX only: the screens behind it read no data, so there is no API boundary to
 * guard.
 */
export function DemoOnlyRoute() {
  const { data: session, isPending } = useSession();

  // See `AdminScreenRoute` — same wait, sized to the shell's frame.
  if (isPending) return <RouteFallback className="min-h-0 flex-1" />;
  if (!session) return <Navigate to={ROUTE.login.path} replace />;
  if (!viewerOf(session.user).demo) return <NotFoundPage />;
  return <Outlet />;
}
