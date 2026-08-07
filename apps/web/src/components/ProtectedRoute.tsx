import { Navigate, Outlet } from "react-router-dom";
import { RouteFallback } from "@/components/RouteFallback";
import { useSession } from "@/lib/auth-client";

export function ProtectedRoute() {
  const { data: session, isPending } = useSession();

  // Not `null`: this is a cold load waiting on the session request, and an
  // empty document is what the user would otherwise stare at until it answers.
  if (isPending) return <RouteFallback />;
  if (!session) return <Navigate to="/login" replace />;

  return <Outlet />;
}
