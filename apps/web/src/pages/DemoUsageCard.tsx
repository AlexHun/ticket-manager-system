import { useId } from "react";
import { DEMO_USAGE_LABEL } from "@ticket/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useDemoStatus, useDemoUsage } from "@/lib/demo-queries";

/**
 * Whether anybody uses the demo (#327, PRD R14): this week's demo sessions and
 * how many of them opened a ticket.
 *
 * On the Users page because that page is admin-only for a demo session too —
 * it is absent from the demo's nav and its URL is not found — and the API
 * behind this refuses one regardless. Drawn only while demo mode is on: a
 * deployment that takes real mail never offered the demo, and a card of
 * zeroes about it would be noise.
 */
export function DemoUsageCard() {
  const { data: demoEnabled } = useDemoStatus();
  const { data: usage } = useDemoUsage(demoEnabled === true);
  const titleId = useId();

  if (!demoEnabled || !usage) return null;

  return (
    <Card size="sm" role="region" aria-labelledby={titleId} className="mb-6">
      <CardHeader>
        <CardTitle id={titleId}>{DEMO_USAGE_LABEL.title}</CardTitle>
        <CardDescription>Since Monday, 00:00 UTC.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="flex gap-8">
          <Figure
            label={DEMO_USAGE_LABEL.sessionsStarted}
            value={usage.sessionsStarted}
          />
          <Figure
            label={DEMO_USAGE_LABEL.sessionsOpenedTicket}
            value={usage.sessionsOpenedTicket}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-medium tabular-nums">{value}</dd>
    </div>
  );
}
