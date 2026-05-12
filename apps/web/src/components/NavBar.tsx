import { Moon, Sun } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { authClient, useSession } from "@/lib/auth-client";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

export function NavBar() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { theme, toggleTheme } = useTheme();

  const handleSignOut = async () => {
    await authClient.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <nav className="flex items-center justify-between border-b px-6 py-3">
      <div className="flex items-center gap-6">
        <span className="font-semibold">Ticket Manager</span>
        {session?.user.role === "admin" && (
          <Link
            to="/users"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Users
          </Link>
        )}
      </div>
      <div className="flex items-center gap-4">
        {session?.user.name && (
          <span className="text-sm text-muted-foreground">
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
    </nav>
  );
}
