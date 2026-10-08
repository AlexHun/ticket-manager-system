import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { BRAND_NAME } from "@/lib/brand";
import { ROUTE } from "@/lib/routes";
import { WELCOME_LABEL } from "@/lib/welcome";

/**
 * Where "Use demo session" lands (demo-welcome PRD, R1): what the product does,
 * in `CONTEXT.md`'s words (R2), and the way on to the Dashboard (R6).
 *
 * A demo session's page only — `DemoOnlyRoute` in `App.tsx` shows anybody else
 * the not-found page (R10). It mounts no `<Tutorial>` (R9), so the Dashboard's
 * still pops up the first time the visitor gets there. It reads no data.
 */
export function WelcomePage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <PageHeader
        title={WELCOME_LABEL.title}
        description={`${BRAND_NAME} is a support desk that reads customer email and answers what it can on its own.`}
      />
      <section aria-labelledby="welcome-how" className="max-w-prose">
        <h2 id="welcome-how" className="text-lg font-semibold">
          How a ticket travels
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          <li>
            A customer emails the support address, and the email becomes a
            ticket.
          </li>
          <li>
            The assistant classifies the ticket, filing it under one of four
            categories.
          </li>
          <li>
            When a knowledge article answers the question, the assistant sends
            an auto-reply built from it. When none does, it hands the ticket off
            to an agent.
          </li>
        </ol>
        <p className="mt-4 text-sm text-muted-foreground">
          You are signed in as a demo visitor, an agent with no password. Work
          tickets as an agent would, and look around the admin screens.
        </p>
        <Button asChild className="mt-6">
          <Link to={ROUTE.dashboard.path}>
            {WELCOME_LABEL.startExploring}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </section>
    </div>
  );
}
