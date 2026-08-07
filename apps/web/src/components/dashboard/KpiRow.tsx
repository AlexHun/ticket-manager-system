import { Link } from "react-router-dom";
import {
  CATEGORY_NONE,
  TICKET_STATUS,
  type FirstResponseStats,
  type TicketCategoryCount,
  type TicketStatsSummary,
} from "@ticket/shared";
import { formatHours, formatPercent } from "@/lib/format";
import { StatTile } from "./StatTile";

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

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Open"
        value={open}
        sub={
          summary.openUnassigned > 0 ? (
            // Links to the list already filtered the same way, so the count is a
            // starting point rather than a thing to go and reproduce by hand.
            //
            // Overrides the tile's muted colour and underlines unconditionally:
            // inheriting text-muted-foreground put an interactive control at
            // 4.65:1 in light mode and, worse, left "this is a link" carried by
            // nothing but a hover state that a touch device never shows.
            <Link
              to={`/tickets?status=${TICKET_STATUS.Open}`}
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
        sub={`${summary.byStatus[TICKET_STATUS.Resolved] + summary.byStatus[TICKET_STATUS.Closed]} of ${summary.total} resolved or closed`}
      />
      <StatTile
        label="Median first reply"
        display={formatHours(firstResponse.medianHours)}
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
