import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The catch-all, and deliberately a page rather than a redirect.
 *
 * This used to be `<Navigate to="/" replace />`, which made a mistyped URL and
 * a successful trip to the dashboard indistinguishable — you asked for
 * `/tikets`, you landed on charts, and nothing anywhere said the address was
 * wrong. Worse for a stale bookmark or a shared link to a ticket that has since
 * been renamed: the app silently pretends the link worked.
 *
 * It lives *inside* `AppShell`, so a signed-in visitor keeps the sidebar and
 * can leave by any route rather than only the two buttons below. That also puts
 * it behind `ProtectedRoute`, which is correct — a signed-out visitor should
 * reach the login screen, not a 404 telling them a page they cannot see does
 * not exist.
 *
 * Static, not lazy. Everything else under the shell is code-split, but routing
 * has already failed by the time this renders and putting a network round trip
 * in front of the error message is how a 404 turns into a blank screen.
 */
export function NotFoundPage() {
  const { pathname } = useLocation();

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          {/* The document's `<h1>`, and the only page under the shell that has
              to say so out loud — everywhere else the heading is the page's own
              (see `PageHeader`), and `CardTitle` is a `<div>`. Nesting rather
              than restyling because preflight resets a heading's size and
              weight to `inherit`, so this looks identical to every other card
              title in the app while giving the page a heading to land on. */}
          <CardTitle>
            <h1>No such page</h1>
          </CardTitle>
          <CardDescription>
            Nothing here answers to{" "}
            <span className="break-all text-foreground">{pathname}</span>. The
            link may be out of date, or the address may have a typo in it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/tickets">Go to tickets</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Go to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
