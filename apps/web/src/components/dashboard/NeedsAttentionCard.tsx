import { Link } from "react-router-dom";
import type { NeedsAttentionTicket } from "@ticket/shared";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatSince } from "@/lib/format";
import { ticketDetailPath } from "@/lib/routes";

/**
 * The open tickets that have gone quietest, oldest silence first.
 *
 * This is the one panel that is a worklist rather than a measurement: every row
 * is a link into the ticket, so the dashboard can be acted on instead of only
 * read. `waitingOnUs` comes from the direction of the newest message — the
 * customer had the last word, or nobody has said anything at all.
 *
 * It is also the one panel the date range does not touch (see `mineWhere` in
 * `ticket-stats.ts`), which the description has to say out loud: every other
 * card on the screen answers for the selected range, and a card that quietly
 * answered for a different span would be read as though it did too.
 */
export function NeedsAttentionCard({
  tickets,
  className,
}: {
  tickets: NeedsAttentionTicket[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        <CardDescription>
          Open tickets with the longest silence · any date
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tickets.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing waiting. Inbox zero.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1.5 font-medium">
                  Ticket
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  Assignee
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Silent for
                </th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                // The whole row responds, not just the link inside it — the row
                // is the target the eye picks, and a wash under it says "this
                // one" more clearly than an underline on four words.
                <tr
                  key={ticket.id}
                  className="border-b transition-colors last:border-0 hover:bg-muted/50"
                >
                  <td className="py-2 pr-3">
                    <Link
                      to={ticketDetailPath(ticket.id)}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {ticket.subject}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {ticket.customerName}
                      </span>
                      {ticket.waitingOnUs && (
                        <Badge variant="secondary" className="text-[10px]">
                          Waiting on us
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {ticket.assignedTo?.name ?? "Unassigned"}
                  </td>
                  <td className="py-2 text-right text-xs text-muted-foreground tabular-nums">
                    {formatSince(ticket.lastMessageAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
