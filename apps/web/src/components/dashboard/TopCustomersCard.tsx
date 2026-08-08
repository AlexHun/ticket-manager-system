import type { CustomerStats } from "@ticket/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Who is writing in most.
 *
 * A table with a bar inside the count cell rather than a chart: past about seven
 * rows the bars stop being comparable anyway, and a table keeps the email
 * address — the thing that identifies the customer — readable at full width. The
 * inline bar is proportional to the busiest customer, so it shows shape without
 * needing an axis.
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
                <th scope="col" className="py-1.5 text-right font-medium">
                  Open
                </th>
                <th scope="col" className="py-1.5 pl-3 font-medium">
                  Tickets
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
                  <td className="py-2 text-right text-xs text-muted-foreground tabular-nums">
                    {customer.open}
                  </td>
                  <td className="w-[45%] py-2 pl-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2 min-w-0.5 rounded-full"
                        style={{
                          width: `${(customer.total / max) * 100}%`,
                          backgroundColor: "var(--viz-accent)",
                        }}
                        aria-hidden="true"
                      />
                      <span className="shrink-0 text-xs tabular-nums">
                        {customer.total}
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
