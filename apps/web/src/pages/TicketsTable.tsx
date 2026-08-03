import { TICKET_STATUS, type Ticket, type TicketStatus } from "@ticket/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROW_COUNT = 5;

const COLUMNS = [
  "Subject",
  "Customer",
  "Status",
  "Category",
  "Created",
] as const;

interface TicketsTableProps {
  tickets: Ticket[];
}

export function TicketsTable({ tickets }: TicketsTableProps) {
  if (tickets.length === 0) {
    return <p className="text-sm text-muted-foreground">No tickets found.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-border">
      <table className="w-full text-sm">
        <TicketsTableHead />
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id} className="border-t border-border">
              <td className="px-4 py-2 font-medium">{t.subject}</td>
              <td className="px-4 py-2">
                <div className="flex flex-col">
                  <span>{t.customerName}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.customerEmail}
                  </span>
                </div>
              </td>
              <td className="px-4 py-2">
                <StatusBadge status={t.status} />
              </td>
              <td className="px-4 py-2">
                {t.category ? (
                  <Badge variant="outline">{t.category}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {new Date(t.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TicketsTableSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-lg ring-1 ring-border"
      aria-busy="true"
      aria-label="Loading tickets"
    >
      <table className="w-full text-sm">
        <TicketsTableHead />
        <tbody>
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
            <tr key={i} className="border-t border-border">
              <td className="px-4 py-2">
                <Skeleton className="h-4 w-56" />
              </td>
              <td className="px-4 py-2">
                <Skeleton className="h-4 w-40" />
              </td>
              <td className="px-4 py-2">
                <Skeleton className="h-5 w-16 rounded-md" />
              </td>
              <td className="px-4 py-2">
                <Skeleton className="h-5 w-20 rounded-md" />
              </td>
              <td className="px-4 py-2">
                <Skeleton className="h-4 w-20" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TicketsTableHead() {
  return (
    <thead className="bg-muted text-left text-muted-foreground">
      <tr>
        {COLUMNS.map((label) => (
          <th key={label} className="px-4 py-2 font-medium">
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

const STATUS_VARIANT: Record<
  TicketStatus,
  "default" | "secondary" | "outline"
> = {
  [TICKET_STATUS.Open]: "default",
  [TICKET_STATUS.Resolved]: "secondary",
  [TICKET_STATUS.Closed]: "outline",
};

function StatusBadge({ status }: { status: TicketStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
}
