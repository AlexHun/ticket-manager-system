import { useNavigate } from "react-router-dom";
import { authClient, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";

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
  const { data: session } = useSession();

  const handleSignOut = async () => {
    await authClient.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger />
      <div className="ml-auto flex items-center gap-2">
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
