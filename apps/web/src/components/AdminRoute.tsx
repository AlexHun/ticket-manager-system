import { Navigate, Outlet } from "react-router-dom";
import { USER_ROLE } from "@ticket/shared";
import { RouteFallback } from "@/components/RouteFallback";
import { useSession } from "@/lib/auth-client";

export function AdminRoute() {
  const { data: session, isPending } = useSession();

  // See ProtectedRoute — same wait, same holding screen.
  if (isPending) return <RouteFallback />;
  if (!session) return <Navigate to="/login" replace />;
  if (session.user.role !== USER_ROLE.admin) return <Navigate to="/" replace />;

  return <Outlet />;
}
