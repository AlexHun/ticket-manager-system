import { useNavigate } from "react-router-dom";
import { HelpCircle } from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Hint } from "@/components/Hint";
import { ChangelogPopover } from "@/components/layout/ChangelogPopover";
import { useTutorialTrigger } from "@/lib/tutorial-trigger";

/**
 * The shell's top strip: collapse trigger, who you are, out.
 *
 * It is a `shrink-0` flex sibling of the scroll region rather than `sticky`, so
 * it stays put without leaving the flow. And it lives *inside* SidebarInset's
 * `<main>`, which means it is deliberately not a `banner` landmark — a banner
 * nested in main is an accessibility violation, so don't add `role="banner"`.
 *
 * It no longer names the page. It used to, in 14px semibold, and that was the
 * only place a section was named — so "Dashboard" was set at the same size as
 * the sign-out button and smaller than every row beneath it. Now each page
 * carries its own heading (`PageHeader`), and repeating it 20px above at half
 * the size would read as a mistake rather than as a breadcrumb. Where you are
 * is answered by the sidebar's marked item and by the page's own heading; the
 * separator that used to divide the trigger from the title went with it.
 */
export function AppTopBar() {
  const navigate = useNavigate();
  const { data: session, refetch: refetchSession } = useSession();
  const tutorialTrigger = useTutorialTrigger();

  const handleSignOut = async () => {
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
    navigate("/login", { replace: true });
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger />
      <div className="ml-auto flex items-center gap-2">
        {/* Only rendered while the current page has a tutorial to show —
            `reopen` is null on any page without one, and briefly during a
            route change; see tutorial-trigger.tsx. */}
        {tutorialTrigger?.reopen && (
          <Hint content="Show tutorial">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={tutorialTrigger.reopen}
            >
              <HelpCircle aria-hidden="true" />
              <span className="sr-only">Show tutorial</span>
            </Button>
          </Hint>
        )}
        <ChangelogPopover />
        {session?.user.name && (
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {session.user.name}
          </span>
        )}
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
