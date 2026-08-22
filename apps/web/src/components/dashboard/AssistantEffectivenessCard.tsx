import {
  AUTO_REPLY_DECLINES,
  type AssistantEffectivenessResponse,
} from "@ticket/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EMPTY_VALUE, formatPercent } from "@/lib/format";
import { DECLINE_SHORT } from "@/lib/pipeline-labels";

function pct(rate: number | null): string {
  return rate === null ? EMPTY_VALUE : formatPercent(rate);
}

/**
 * Whether the assistant is helping or getting in the way, for the range every
 * other panel already reads — one card because the endpoint answers one
 * question, not three: auto-reply rate, decline rate and category-override
 * rate all share the same denominator (`classified`).
 *
 * `avgEditDistance` ships null from the API today — see the field comment on
 * `AssistantEffectivenessResponse` in `@ticket/shared` for why. The footer
 * says so rather than the panel silently pretending the number doesn't exist.
 */
export function AssistantEffectivenessCard({
  data,
  className,
}: {
  data: AssistantEffectivenessResponse;
  className?: string;
}) {
  const { classified, autoReply, decline, categoryOverride, avgEditDistance } =
    data;

  // Only the reasons that actually fired — a zero-filled row for all nine
  // would crowd a card whose job is a glance, not the full pipeline diagram
  // `/pipeline` already draws.
  const reasons = AUTO_REPLY_DECLINES.map((reason) => ({
    reason,
    count: decline.reasons[reason],
  }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Assistant effectiveness</CardTitle>
        <CardDescription>
          {classified === 0
            ? "Nothing classified in this range"
            : `${classified} ticket${classified === 1 ? "" : "s"} classified in this range`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {classified === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            No tickets were classified in this range.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Metric
                label="Auto-replied"
                rate={autoReply.rate}
                sub={`${autoReply.resolved} of ${classified}`}
              />
              <Metric
                label="Declined"
                rate={decline.rate}
                sub={`${decline.count} of ${classified}`}
              />
              <Metric
                label="Category overridden"
                rate={categoryOverride.rate}
                sub={`${categoryOverride.count} of ${classified}`}
              />
            </div>

            {reasons.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Decline reasons
                </p>
                <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {reasons.map(({ reason, count }) => (
                    <li
                      key={reason}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <span className="text-muted-foreground">
                        {DECLINE_SHORT[reason]}
                      </span>
                      <span className="font-medium tabular-nums">
                        {count}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {avgEditDistance === null && (
              <p className="text-xs text-muted-foreground">
                Draft-vs-sent edit distance isn't tracked yet.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  rate,
  sub,
}: {
  label: string;
  rate: number | null;
  sub: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl leading-none font-semibold">{pct(rate)}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
