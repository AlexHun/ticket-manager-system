import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type Header,
  type OnChangeFn,
  type SortDirection,
  type SortingState,
} from "@tanstack/react-table";
import { Link, useLocation } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import {
  TICKET_SORT_FIELD,
  type Ticket,
  type TicketSortField,
  type TicketWithAssignee,
} from "@ticket/shared";
import { CategoryBadge, StatusBadge } from "@/components/TicketBadges";
import { Skeleton } from "@/components/ui/skeleton";
import type { TicketListLocationState } from "@/lib/ticket-list-params";
import { cn } from "@/lib/utils";

const SKELETON_ROW_COUNT = 5;

/** How far one arrow-key press moves a column edge. */
const KEYBOARD_RESIZE_STEP = 16;

/**
 * Column ids are pinned to the sortable-field union: a column the server can't
 * sort by won't compile, which is what lets a `SortingState` entry be handed
 * straight to the API as `?sort=<id>`.
 */
type TicketColumn = ColumnDef<TicketWithAssignee> & { id: TicketSortField };

/**
 * One source for a column's label and its width bounds. Widths are explicit so
 * they come from state rather than from cell contents — that is what stops them
 * shifting when the page changes, and what makes them draggable.
 *
 * The defaults must sum to comfortably less than the content frame at the
 * narrowest desktop width, or the table stops stretching to fill it and starts
 * scrolling sideways instead: `minWidth: table.getTotalSize()` wins over
 * `w-full` once the total exceeds the frame, and dragging a column then grows
 * the table rather than taking the space from its neighbours.
 *
 * At 1280px with the sidebar expanded the frame is 976px (1280 − 256 sidebar
 * − 48 padding), so these total 880. The ~96px of headroom is deliberate and
 * not just slack for a scrollbar: it is how far a column can be widened before
 * the redistributing behaviour gives way to horizontal scrolling. The sidebar
 * is why these are narrower than they used to be — check the sum, and that
 * headroom, before growing a column.
 *
 * "Assigned to" was fitted inside that 880 by taking width from its neighbours
 * rather than added on top of it. Adding ~130 to the total instead would have
 * pushed past the frame and left the table permanently scrolling sideways at
 * 1280px, which is the failure this budget exists to prevent.
 */
const COLUMN_META: Record<
  TicketSortField,
  { label: string; size: number; minSize: number }
> = {
  [TICKET_SORT_FIELD.subject]: { label: "Subject", size: 240, minSize: 160 },
  [TICKET_SORT_FIELD.customerName]: {
    label: "Customer",
    size: 170,
    minSize: 160,
  },
  [TICKET_SORT_FIELD.status]: { label: "Status", size: 110, minSize: 100 },
  [TICKET_SORT_FIELD.category]: { label: "Category", size: 120, minSize: 100 },
  [TICKET_SORT_FIELD.assignedTo]: {
    label: "Assigned to",
    size: 130,
    minSize: 110,
  },
  [TICKET_SORT_FIELD.createdAt]: { label: "Created", size: 110, minSize: 110 },
};

function metaOf(id: TicketSortField) {
  return COLUMN_META[id];
}

const columns: TicketColumn[] = [
  {
    id: TICKET_SORT_FIELD.subject,
    accessorKey: "subject",
    ...metaOf(TICKET_SORT_FIELD.subject),
    header: metaOf(TICKET_SORT_FIELD.subject).label,
    cell: ({ row }) => <SubjectCell ticket={row.original} />,
  },
  {
    id: TICKET_SORT_FIELD.customerName,
    accessorKey: "customerName",
    ...metaOf(TICKET_SORT_FIELD.customerName),
    header: metaOf(TICKET_SORT_FIELD.customerName).label,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="truncate" title={row.original.customerName}>
          {row.original.customerName}
        </span>
        <span
          className="truncate text-xs text-muted-foreground"
          title={row.original.customerEmail}
        >
          {row.original.customerEmail}
        </span>
      </div>
    ),
  },
  {
    id: TICKET_SORT_FIELD.status,
    accessorKey: "status",
    ...metaOf(TICKET_SORT_FIELD.status),
    header: metaOf(TICKET_SORT_FIELD.status).label,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: TICKET_SORT_FIELD.category,
    accessorKey: "category",
    ...metaOf(TICKET_SORT_FIELD.category),
    header: metaOf(TICKET_SORT_FIELD.category).label,
    cell: ({ row }) =>
      row.original.category ? (
        <CategoryBadge category={row.original.category} />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: TICKET_SORT_FIELD.assignedTo,
    // Not an accessorKey: the value lives at `assignedTo.name`, and the column
    // is sorted by the server anyway — this only has to reach the cell.
    accessorFn: (ticket) => ticket.assignedTo?.name ?? null,
    ...metaOf(TICKET_SORT_FIELD.assignedTo),
    header: metaOf(TICKET_SORT_FIELD.assignedTo).label,
    cell: ({ row }) =>
      row.original.assignedTo ? (
        // The email is the tooltip rather than a second line: two agents can
        // share a first name, but the row is already two lines tall under
        // Customer and a third would set the row height for every ticket.
        <span className="block truncate" title={row.original.assignedTo.email}>
          {row.original.assignedTo.name}
        </span>
      ) : (
        <span className="text-muted-foreground">Unassigned</span>
      ),
  },
  {
    id: TICKET_SORT_FIELD.createdAt,
    accessorKey: "createdAt",
    ...metaOf(TICKET_SORT_FIELD.createdAt),
    header: metaOf(TICKET_SORT_FIELD.createdAt).label,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {new Date(row.original.createdAt).toLocaleDateString()}
      </span>
    ),
  },
];

/**
 * A component rather than inline JSX so it can use a hook: the link carries the
 * current list URL along in router state, which is what lets the detail page
 * offer a "back" that lands on this same filtered, sorted, paginated view
 * without putting anyone's filters into a shareable ticket URL.
 *
 * Only the subject is a link, not the whole row — that gives keyboard access, a
 * focus ring, middle-click and open-in-new-tab for free.
 */
function SubjectCell({ ticket }: { ticket: Ticket }) {
  const location = useLocation();

  return (
    <Link
      to={`/tickets/${ticket.id}`}
      state={{ listSearch: location.search } satisfies TicketListLocationState}
      title={ticket.subject}
      // `block` is what makes `truncate` work: an inline <a> isn't constrained
      // by the fixed-layout cell, so the ellipsis would never appear.
      className={cn(
        "block truncate font-medium underline-offset-4",
        "hover:underline focus-visible:underline",
      )}
    >
      {ticket.subject}
    </Link>
  );
}

const DEFAULT_TOTAL_WIDTH = columns.reduce((sum, c) => sum + (c.size ?? 0), 0);

/** Border, rounding and scrolling, shared by the table and its skeleton. */
const FRAME = "overflow-auto rounded-lg ring-1 ring-border";
const HEAD = "sticky top-0 z-10 bg-muted text-left font-medium";

interface TicketsTableProps {
  tickets: TicketWithAssignee[];
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  /** Shown instead of the table when there is nothing to render. */
  emptyMessage?: string;
  className?: string;
}

export function TicketsTable({
  tickets,
  sorting,
  onSortingChange,
  emptyMessage = "No tickets found.",
  className,
}: TicketsTableProps) {
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  const table = useReactTable({
    data: tickets,
    columns,
    state: { sorting, columnSizing },
    onSortingChange,
    onColumnSizingChange: setColumnSizing,
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
    enableColumnResizing: true,
    // Redraw while dragging rather than only on release.
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
  });

  if (tickets.length === 0) {
    return (
      <div className={cn(FRAME, "grid place-items-center", className)}>
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn(FRAME, className)}>
      {/* Always fills the frame: `w-full` lets fixed layout hand any leftover
          space to the columns, so there is no dead strip on the right. Once the
          columns are dragged past the frame, `minWidth` takes over and the
          frame scrolls horizontally instead of squeezing them. */}
      <table
        className="w-full table-fixed text-sm"
        style={{ minWidth: table.getTotalSize() }}
      >
        <colgroup>
          {table.getVisibleLeafColumns().map((column) => (
            <col key={column.id} style={{ width: column.getSize() }} />
          ))}
        </colgroup>
        <thead className="text-muted-foreground">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const direction = header.column.getIsSorted();
                const { label } =
                  COLUMN_META[header.column.id as TicketSortField];
                return (
                  <th
                    key={header.id}
                    scope="col"
                    // Explicit, so the resize handle's own label doesn't get
                    // concatenated into the header's accessible name.
                    aria-label={label}
                    aria-sort={
                      direction === false ? "none" : ARIA_SORT[direction]
                    }
                    // No `relative` here: it would fight `sticky` for the
                    // position property. Sticky is already a containing block
                    // for the absolutely-positioned resize handle.
                    className={cn(HEAD, "px-4 py-2")}
                  >
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      // Tailwind v4's preflight leaves a bare <button> on the
                      // browser default cursor, unlike the shadcn Button.
                      className="flex w-full cursor-pointer items-center gap-1 select-none hover:text-foreground"
                    >
                      <span className="truncate">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </span>
                      <SortIcon direction={direction} />
                    </button>
                    <ResizeHandle header={header} />
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-t border-border transition-colors hover:bg-muted/50"
            >
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

/**
 * Sibling of the sort button rather than a child, so a drag never toggles the
 * sort. Double-click resets one column; arrow keys give it a keyboard path,
 * since a drag handle is otherwise mouse-only.
 */
function ResizeHandle({ header }: { header: Header<TicketWithAssignee, unknown> }) {
  if (!header.column.getCanResize()) return null;

  const label = COLUMN_META[header.column.id as TicketSortField].label;
  const resizing = header.column.getIsResizing();

  const nudge = (delta: number) => {
    const next = Math.max(
      header.column.columnDef.minSize ?? 0,
      header.column.getSize() + delta,
    );
    header.getContext().table.setColumnSizing((prev) => ({
      ...prev,
      [header.column.id]: next,
    }));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      tabIndex={0}
      data-resizing={resizing}
      onMouseDown={header.getResizeHandler()}
      onTouchStart={header.getResizeHandler()}
      onDoubleClick={() => header.column.resetSize()}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          nudge(-KEYBOARD_RESIZE_STEP);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          nudge(KEYBOARD_RESIZE_STEP);
        }
      }}
      // touch-none or the browser pans instead of letting us drag. The div is
      // a comfortable grab area; the divider inside it is what you see.
      className={cn(
        "group/resize absolute top-0 right-0 flex h-full w-2 justify-end",
        "cursor-col-resize touch-none select-none focus-visible:outline-none",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-full w-px bg-border transition-colors",
          "group-hover/resize:w-0.5 group-hover/resize:bg-ring",
          "group-focus-visible/resize:w-0.5 group-focus-visible/resize:bg-ring",
          resizing && "w-0.5 bg-ring",
        )}
      />
    </div>
  );
}

export function TicketsTableSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(FRAME, className)}
      aria-busy="true"
      aria-label="Loading tickets"
    >
      {/* Only ever rendered before a resize, so the defaults are correct. */}
      <table
        className="w-full table-fixed text-sm"
        style={{ minWidth: DEFAULT_TOTAL_WIDTH }}
      >
        <colgroup>
          {columns.map((column) => (
            <col key={column.id} style={{ width: column.size }} />
          ))}
        </colgroup>
        <thead className="text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" className={cn(HEAD, "px-4 py-2")}>
                {COLUMN_META[column.id].label}
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
                <Skeleton className="h-4 w-24" />
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
    direction === "asc"
      ? ArrowUp
      : direction === "desc"
        ? ArrowDown
        : ChevronsUpDown;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0",
        direction === false ? "opacity-40" : "opacity-100",
      )}
    />
  );
}

