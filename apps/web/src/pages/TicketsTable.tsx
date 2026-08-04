import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortDirection,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import {
  TICKET_SORT_FIELD,
  TICKET_STATUS,
  type Ticket,
  type TicketSortField,
  type TicketStatus,
} from "@ticket/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROW_COUNT = 5;

/**
 * Column ids are pinned to the sortable-field union: a column the server can't
 * sort by won't compile, which is what lets a `SortingState` entry be handed
 * straight to the API as `?sort=<id>`.
 */
type TicketColumn = ColumnDef<Ticket> & { id: TicketSortField };

/** Single source for header text — the table and the skeleton both read it. */
const COLUMN_LABELS: Record<TicketSortField, string> = {
  [TICKET_SORT_FIELD.subject]: "Subject",
  [TICKET_SORT_FIELD.customerName]: "Customer",
  [TICKET_SORT_FIELD.status]: "Status",
  [TICKET_SORT_FIELD.category]: "Category",
  [TICKET_SORT_FIELD.createdAt]: "Created",
};

const columns: TicketColumn[] = [
  {
    id: TICKET_SORT_FIELD.subject,
    accessorKey: "subject",
    header: COLUMN_LABELS[TICKET_SORT_FIELD.subject],
    cell: ({ row }) => (
      <span className="font-medium">{row.original.subject}</span>
    ),
  },
  {
    id: TICKET_SORT_FIELD.customerName,
    accessorKey: "customerName",
    header: COLUMN_LABELS[TICKET_SORT_FIELD.customerName],
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span>{row.original.customerName}</span>
        <span className="text-xs text-muted-foreground">
          {row.original.customerEmail}
        </span>
      </div>
    ),
  },
  {
    id: TICKET_SORT_FIELD.status,
    accessorKey: "status",
    header: COLUMN_LABELS[TICKET_SORT_FIELD.status],
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: TICKET_SORT_FIELD.category,
    accessorKey: "category",
    header: COLUMN_LABELS[TICKET_SORT_FIELD.category],
    cell: ({ row }) =>
      row.original.category ? (
        <Badge variant="outline">{row.original.category}</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: TICKET_SORT_FIELD.createdAt,
    accessorKey: "createdAt",
    header: COLUMN_LABELS[TICKET_SORT_FIELD.createdAt],
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {new Date(row.original.createdAt).toLocaleDateString()}
      </span>
    ),
  },
];

interface TicketsTableProps {
  tickets: Ticket[];
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
}

export function TicketsTable({
  tickets,
  sorting,
  onSortingChange,
}: TicketsTableProps) {
  const table = useReactTable({
    data: tickets,
    columns,
    state: { sorting },
    onSortingChange,
    // Postgres already ordered these rows — render them as they arrived.
    // Note the deliberate absence of getSortedRowModel().
    manualSorting: true,
    // Keep exactly one column sorted, so every request carries an explicit
    // sort and there is no "unsorted" state for the server to guess at.
    enableSortingRemoval: false,
    enableMultiSort: false,
    // First click on a new column is ascending, rather than v8's
    // number-vs-string guess.
    sortDescFirst: false,
    getCoreRowModel: getCoreRowModel(),
  });

  if (tickets.length === 0) {
    return <p className="text-sm text-muted-foreground">No tickets found.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-muted-foreground">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const direction = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      direction === false ? "none" : ARIA_SORT[direction]
                    }
                    className="px-4 py-2 font-medium"
                  >
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="flex items-center gap-1 select-none hover:text-foreground"
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <SortIcon direction={direction} />
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
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
        <thead className="bg-muted text-left text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" className="px-4 py-2 font-medium">
                {COLUMN_LABELS[column.id]}
              </th>
            ))}
          </tr>
        </thead>
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

const ARIA_SORT: Record<SortDirection, "ascending" | "descending"> = {
  asc: "ascending",
  desc: "descending",
};

/** Icons are decorative — the <th>'s aria-sort carries the state for AT. */
function SortIcon({ direction }: { direction: false | SortDirection }) {
  const Icon =
    direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <Icon
      aria-hidden="true"
      className={
        direction === false ? "size-3.5 opacity-40" : "size-3.5 opacity-100"
      }
    />
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
