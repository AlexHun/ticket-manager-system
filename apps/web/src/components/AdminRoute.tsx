import { Navigate, Outlet } from "react-router-dom";
import { USER_ROLE } from "@ticket/shared";
import { RouteFallback } from "@/components/RouteFallback";
import { useSession } from "@/lib/auth-client";
import { ROUTE } from "@/lib/routes";

export function AdminRoute() {
  const { data: session, isPending } = useSession();

  // See ProtectedRoute — same wait, same holding screen. Sized to the frame
  // rather than the viewport: this route sits inside the shell, so the sidebar
  // and top bar are already on screen around it.
  if (isPending) return <RouteFallback className="min-h-0 flex-1" />;
  if (!session) return <Navigate to={ROUTE.login.path} replace />;
  if (session.user.role !== USER_ROLE.admin)
    return <Navigate to={ROUTE.dashboard.path} replace />;

  return <Outlet />;
}
