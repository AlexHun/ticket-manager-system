import { Navigate, Outlet } from "react-router-dom";
import { USER_ROLE } from "@ticket/shared";
import { useSession } from "@/lib/auth-client";

export function AdminRoute() {
  const { data: session, isPending } = useSession();

  if (isPending) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (session.user.role !== USER_ROLE.admin) return <Navigate to="/" replace />;

  return <Outlet />;
}
