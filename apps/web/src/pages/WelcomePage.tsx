import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { BRAND_NAME } from "@/lib/brand";
import { useFollowWelcomeStep } from "@/lib/demo-queries";
import { ROUTE } from "@/lib/routes";
import { WELCOME_LABEL } from "@/lib/welcome";
import { WELCOME_STEPS } from "@/lib/welcome-steps";

/**
 * Where "Use demo session" lands (demo-welcome PRD, R1): what the product does,
 * in `CONTEXT.md`'s words (R2), where to start (R4, R13), and the way on to
 * the Dashboard (R6).
 *
 * A demo session's page only — `DemoOnlyRoute` in `App.tsx` shows anybody else
 * the not-found page (R10). It mounts no `<Tutorial>` (R9), so the Dashboard's
 * still pops up the first time the visitor gets there. It reads no data; its
 * one write is the step mark, sent as a step's link navigates and never
 * awaited (R11).
 */
export function WelcomePage() {
  const followStep = useFollowWelcomeStep();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <PageHeader
        title={WELCOME_LABEL.title}
        description={`${BRAND_NAME} is a support desk that reads customer email and answers what it can on its own.`}
      />
      <div className="max-w-prose">
        <section aria-labelledby="welcome-how">
          <h2 id="welcome-how" className="text-lg font-semibold">
            How a ticket travels
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
            <li>
              A customer emails the support address, and the email becomes a
              ticket.
            </li>
            <li>
              The assistant classifies the ticket, filing it under a category.
            </li>
            <li>
              When a knowledge article answers the question, the assistant sends
              an auto-reply built from it. When none does, it hands the ticket
              off to an agent.
            </li>
          </ol>
          <p className="mt-4 text-sm text-muted-foreground">
            You are signed in as a demo visitor: an agent with no password.
          </p>
        </section>
        <section aria-labelledby="welcome-steps" className="mt-8">
          <h2 id="welcome-steps" className="text-lg font-semibold">
            {WELCOME_LABEL.stepsHeading}
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
            {WELCOME_STEPS.map((step) => (
              <li key={step.key}>
                <Link
                  to={step.to}
                  onClick={() => followStep.mutate()}
                  className="text-link underline-offset-4 hover:underline"
                >
                  {step.sentence}
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <Button asChild className="mt-8">
          <Link to={ROUTE.dashboard.path}>
            {WELCOME_LABEL.startExploring}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
