import { Link } from "react-router-dom";
import {
  ASSIGNEE_NONE,
  CATEGORY_NONE,
  TICKET_STATUS,
  type FirstResponseStats,
  type TicketCategoryCount,
  type TicketStatsSummary,
} from "@ticket/shared";
import { formatHours, formatPercent } from "@/lib/format";
import { StatTile } from "./StatTile";
import {
  firstReplyVerdict,
  openVerdict,
  settledVerdict,
} from "./kpi-status";

interface KpiRowProps {
  summary: TicketStatsSummary;
  firstResponse: FirstResponseStats;
  categories: TicketCategoryCount[];
}

/**
 * Four peers, not a hero and three footnotes — enlarging one would rank them,
 * and on a support dashboard the urgent number changes by the day.
 *
 * Each tile carries a second line that turns the count into something to do:
 * how many of the open ones nobody owns, how many are still unfiled, how many
 * have never been answered.
 */
export function KpiRow({ summary, firstResponse, categories }: KpiRowProps) {
  const open = summary.byStatus[TICKET_STATUS.Open];
  const untriaged =
    categories.find((c) => c.category === null)?.count ?? 0;

  // Thresholds live in `kpi-status.ts`, not here — this component's job is to
  // lay four tiles out, and burying the definition of "bad" in JSX is how it
  // stops getting re-tuned.
  const openState = openVerdict(summary);
  const settledState = settledVerdict(summary);
  const replyState = firstReplyVerdict(firstResponse);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:animate-panel-in">
      <StatTile
        label="Open"
        value={open}
        status={openState?.status}
        statusLabel={openState?.label}
        sub={
          summary.openUnassigned > 0 ? (
            // Links to the list already filtered the same way, so the count is a
            // starting point rather than a thing to go and reproduce by hand.
            //
            // `assignedTo`, not `status`: this count is "arrived and nobody owns
            // it", which spans New *and* Open (see `openUnassigned` in
            // ticket-stats.ts), and the list's status filter takes one value. So
            // the assignee axis is the one that can be expressed honestly — it
            // over-counts by including settled-but-unassigned tickets rather
            // than silently dropping every untriaged one, which is what
            // `status=Open` did.
            //
            // Overrides the tile's muted colour and underlines unconditionally:
            // inheriting text-muted-foreground put an interactive control at
            // 4.65:1 in light mode and, worse, left "this is a link" carried by
            // nothing but a hover state that a touch device never shows.
            <Link
              to={`/tickets?assignedTo=${ASSIGNEE_NONE}`}
              className="text-foreground underline underline-offset-2"
            >
              {summary.openUnassigned} unassigned
            </Link>
          ) : (
            "all assigned"
          )
        }
      />
      <StatTile
        label="Created"
        value={summary.total}
        delta={summary.total - summary.previousTotal}
      />
      <StatTile
        label="Settled"
        display={formatPercent(summary.settledShare)}
        status={settledState?.status}
        statusLabel={settledState?.label}
        sub={`${summary.byStatus[TICKET_STATUS.Resolved] + summary.byStatus[TICKET_STATUS.Closed]} of ${summary.total} resolved or closed`}
      />
      <StatTile
        label="Median first reply"
        display={formatHours(firstResponse.medianHours)}
        status={replyState?.status}
        statusLabel={replyState?.label}
        sub={
          firstResponse.awaiting > 0
            ? `${firstResponse.awaiting} still awaiting a first reply`
            : untriaged > 0
              ? (
                  <Link
                    to={`/tickets?category=${CATEGORY_NONE}`}
                    className="text-foreground underline underline-offset-2"
                  >
                    {untriaged} untriaged
                  </Link>
                )
              : "every ticket answered"
        }
      />
    </div>
  );
}
