import type { CustomerStats } from "@ticket/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Who is writing in most, and how much of it is still waiting.
 *
 * A table with a bar inside the count cell rather than a chart: past about seven
 * rows the bars stop being comparable anyway, and a table keeps the email
 * address — the thing that identifies the customer — readable at full width.
 *
 * The bar used to be a single length proportional to the busiest customer, and
 * on real data it encoded nothing: a support desk's top customers cluster at two
 * or three tickets each, so every row drew the same full-width bar and the
 * column was decoration. Length still carries the total — the track is scaled
 * against the busiest customer, so a genuine outlier still reads as one — but
 * the fill is what varies row to row now: the ember portion is the customer's
 * open tickets against their own total. A customer with two tickets, both
 * answered, and a customer with two tickets, both waiting, were indistinguishable
 * here and are now opposites.
 *
 * Ember rather than the accent green, per the palette split in `index.css`: this
 * is somebody waiting, and green on this screen means settled. An empty track is
 * the honest picture of a customer with nothing outstanding.
 */
export function TopCustomersCard({
  customers,
  className,
}: {
  customers: CustomerStats[];
  className?: string;
}) {
  const max = Math.max(1, ...customers.map((c) => c.total));

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Top customers</CardTitle>
        <CardDescription>By tickets opened in this range</CardDescription>
      </CardHeader>
      <CardContent>
        {customers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing in this range.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1.5 font-medium">
                  Customer
                </th>
                {/* One column, not two. "Open" and "Tickets" were separate
                    numbers sitting a centimetre apart, which is the one
                    arrangement that makes a ratio hard to read. */}
                <th scope="col" className="py-1.5 pl-3 font-medium">
                  Open of total
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr
                  key={customer.email}
                  className="border-b transition-colors last:border-0 hover:bg-muted/50"
                >
                  <td className="py-2 pr-3">
                    <div className="font-medium">{customer.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {customer.email}
                    </div>
                  </td>
                  <td className="w-[45%] py-2 pl-3">
                    <div className="flex items-center gap-2">
                      {/* Two nested lengths: the track is this customer's total
                          against the busiest one, the fill is their open
                          tickets against their own total. `flex-1 min-w-0` is
                          what gives the track a definite width to be a
                          percentage of. */}
                      <div className="min-w-0 flex-1" aria-hidden="true">
                        <div
                          className="h-2 min-w-0.5 rounded-full bg-muted"
                          style={{ width: `${(customer.total / max) * 100}%` }}
                        >
                          <div
                            className="h-2 rounded-full bg-ember-2"
                            style={{
                              width: customer.total
                                ? `${(customer.open / customer.total) * 100}%`
                                : 0,
                            }}
                          />
                        </div>
                      </div>
                      {/* The numbers the bar is drawn from, since a bar is not
                          a reading. Also the row's only accessible account of
                          the ratio — the bar itself is hidden. */}
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        <span className="text-foreground">{customer.open}</span>{" "}
                        of {customer.total}
                      </span>
                    </div>
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
