import { Navigate, Outlet } from "react-router-dom";
import { RouteFallback } from "@/components/RouteFallback";
import { useSession } from "@/lib/auth-client";
import { RealtimeProvider } from "@/lib/realtime";

export function ProtectedRoute() {
  const { data: session, isPending } = useSession();

  // Not `null`: this is a cold load waiting on the session request, and an
  // empty document is what the user would otherwise stare at until it answers.
  if (isPending) return <RouteFallback />;
  if (!session) return <Navigate to="/login" replace />;

  // The event stream opens here rather than around the whole app, because this
  // is the first point where there is certainly a session to open it with. Above
  // the router it would open on `/login` for every signed-out visitor and 401 in
  // a loop; here it is created once a session exists and closed the moment one
  // stops existing, since signing out unmounts this route.
  return (
    <RealtimeProvider>
      <Outlet />
    </RealtimeProvider>
  );
}
