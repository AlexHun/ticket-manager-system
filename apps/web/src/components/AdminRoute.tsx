import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "@/lib/auth-client";

export function AdminRoute() {
  const { data: session, isPending } = useSession();

  if (isPending) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (session.user.role !== "admin") return <Navigate to="/" replace />;

  return <Outlet />;
}
