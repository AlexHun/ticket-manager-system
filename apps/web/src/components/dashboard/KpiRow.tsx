import { Link } from "react-router-dom";
import {
  ASSIGNEE_NONE,
  CATEGORY_NONE,
  STATUS_BACKLOG,
  TICKET_STATUS,
  type FirstResponseStats,
  type TicketCategoryCount,
  type TicketStatsSummary,
} from "@ticket/shared";
import { formatHours, formatPercent } from "@/lib/format";
import { ROUTE } from "@/lib/routes";
import { StatTile } from "./StatTile";
import {
  backlogCount,
  backlogVerdict,
  firstReplyVerdict,
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
 * how many in the Backlog nobody owns, how many are still uncategorised, how
 * many have never been answered.
 */
export function KpiRow({ summary, firstResponse, categories }: KpiRowProps) {
  // The Backlog, New and Open together — the same set the "unassigned" link
  // and the pill count. Labelled "Open" and counting Open alone, the tile's
  // figure disagreed with its own link whenever anything sat in New.
  const backlog = backlogCount(summary);
  const uncategorised = categories.find((c) => c.category === null)?.count ?? 0;

  // Thresholds live in `kpi-status.ts`, not here — this component's job is to
  // lay four tiles out, and burying the definition of "bad" in JSX is how it
  // stops getting re-tuned.
  const backlogState = backlogVerdict(summary);
  const settledState = settledVerdict(summary);
  const replyState = firstReplyVerdict(firstResponse);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 *:animate-panel-in">
      <StatTile
        label="Backlog"
        value={backlog}
        status={backlogState?.status}
        statusLabel={backlogState?.label}
        sub={
          summary.openUnassigned > 0 ? (
            // Links to the list already filtered the same way, so the count is a
            // starting point rather than a thing to go and reproduce by hand.
            //
            // Both axes, and the status one is `STATUS_BACKLOG` — this count is
            // "arrived and nobody owns it", which spans New *and* Open (see
            // `openUnassigned` in ticket-stats.ts). Until the list could express
            // that as one filter there was no honest destination: `status=Open`
            // dropped every untriaged ticket and omitting status swept in
            // everything already settled. Now the link selects the same set the
            // number counted, on both axes.
            //
            // The one remaining difference is the date window — the tile is
            // scoped to the dashboard's range and the list has no such filter —
            // so a wider range can still show fewer tickets here than there.
            //
            // Overrides the tile's muted colour and underlines unconditionally:
            // inheriting text-muted-foreground put an interactive control at
            // 4.65:1 in light mode and, worse, left "this is a link" carried by
            // nothing but a hover state that a touch device never shows.
            <Link
              to={`${ROUTE.tickets.path}?status=${STATUS_BACKLOG}&assignedTo=${ASSIGNEE_NONE}`}
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
          firstResponse.awaiting > 0 ? (
            `${firstResponse.awaiting} still awaiting a first reply`
          ) : uncategorised > 0 ? (
            <Link
              to={`${ROUTE.tickets.path}?category=${CATEGORY_NONE}`}
              className="text-foreground underline underline-offset-2"
            >
              {uncategorised} uncategorised
            </Link>
          ) : (
            "every ticket answered"
          )
        }
      />
    </div>
  );
}
