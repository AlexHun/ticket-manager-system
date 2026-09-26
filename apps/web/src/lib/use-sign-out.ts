import { useNavigate } from "react-router-dom";
import { authClient, useSession } from "@/lib/auth-client";
import { ROUTE } from "@/lib/routes";

/**
 * Sign out and land on `/login`: the top bar's "Sign out", and the demo
 * banner's "Exit demo" (#324), which is the same act under a visitor's name.
 */
export function useSignOut(): () => Promise<void> {
  const navigate = useNavigate();
  const { refetch: refetchSession } = useSession();

  return async () => {
    await authClient.signOut();
    // `signOut` resolving means the *server* has dropped the session; the
    // client's session store still holds the old one until its own refetch
    // lands, and that refetch does not begin until after this navigation.
    // Navigating on that gap sends LoginPage a session that still reads as
    // signed in, so it bounces to `/` — and `/` bounces straight back once
    // the store catches up, remounting LoginPage and wiping whatever had
    // been typed into it. Awaiting the refetch here closes the gap, so
    // LoginPage only ever mounts against a settled, signed-out store.
    await refetchSession();
    navigate(ROUTE.login.path, { replace: true });
  };
}
