import { Moon, Sun } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { authClient, useSession } from "@/lib/auth-client";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { topBarTitle } from "./nav-items";

/**
 * The shell's top strip: collapse trigger, where you are, who you are, out.
 *
 * It is a `shrink-0` flex sibling of the scroll region rather than `sticky`, so
 * it stays put without leaving the flow. And it lives *inside* SidebarInset's
 * `<main>`, which means it is deliberately not a `banner` landmark — a banner
 * nested in main is an accessibility violation, so don't add `role="banner"`.
 */
export function AppTopBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: session } = useSession();
  const { theme, toggleTheme } = useTheme();

  const title = topBarTitle(pathname);

  const handleSignOut = async () => {
    await authClient.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger />
      {/* Explicit height rather than the component's default `self-stretch`:
          stretched, it runs the full 48px and meets the header's bottom border,
          which reads as a join between two rules instead of a divider.
          `self-center` has to come with it — `align-self: stretch` falls back to
          flex-start once the height is definite, so the bare height alone left
          this hanging from the top of the bar rather than centred in it. Use
          the `data-vertical:` variant so tailwind-merge drops the base class;
          an unprefixed `self-center` loses to it on specificity. */}
      <Separator orientation="vertical" className="mr-1 h-6 data-vertical:self-center" />
      {title.heading ? (
        <h1 className="truncate text-sm font-semibold">{title.label}</h1>
      ) : (
        <span className="truncate text-sm font-semibold">{title.label}</span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {session?.user.name && (
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {session.user.name}
          </span>
        )}
        <Button
          variant="outline"
          size="icon-sm"
          onClick={toggleTheme}
          aria-label={
            theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
          }
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
