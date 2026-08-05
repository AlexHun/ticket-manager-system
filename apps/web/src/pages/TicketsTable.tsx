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
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import {
  TICKET_CATEGORY,
  TICKET_SORT_FIELD,
  TICKET_STATUS,
  type Ticket,
  type TicketCategory,
  type TicketSortField,
  type TicketStatus,
} from "@ticket/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const SKELETON_ROW_COUNT = 5;

/** How far one arrow-key press moves a column edge. */
const KEYBOARD_RESIZE_STEP = 16;

/**
 * Column ids are pinned to the sortable-field union: a column the server can't
 * sort by won't compile, which is what lets a `SortingState` entry be handed
 * straight to the API as `?sort=<id>`.
 */
type TicketColumn = ColumnDef<Ticket> & { id: TicketSortField };

/**
 * One source for a column's label and its width bounds. Widths are explicit so
 * they come from state rather than from cell contents — that is what stops them
 * shifting when the page changes, and what makes them draggable.
 */
const COLUMN_META: Record<
  TicketSortField,
  { label: string; size: number; minSize: number }
> = {
  [TICKET_SORT_FIELD.subject]: { label: "Subject", size: 380, minSize: 160 },
  [TICKET_SORT_FIELD.customerName]: {
    label: "Customer",
    size: 280,
    minSize: 160,
  },
  [TICKET_SORT_FIELD.status]: { label: "Status", size: 130, minSize: 100 },
  [TICKET_SORT_FIELD.category]: { label: "Category", size: 150, minSize: 100 },
  [TICKET_SORT_FIELD.createdAt]: { label: "Created", size: 140, minSize: 110 },
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
    cell: ({ row }) => (
      <span className="block truncate font-medium" title={row.original.subject}>
        {row.original.subject}
      </span>
    ),
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

const DEFAULT_TOTAL_WIDTH = columns.reduce((sum, c) => sum + (c.size ?? 0), 0);

/** Border, rounding and scrolling, shared by the table and its skeleton. */
const FRAME = "overflow-auto rounded-lg ring-1 ring-border";
const HEAD = "sticky top-0 z-10 bg-muted text-left font-medium";

interface TicketsTableProps {
  tickets: Ticket[];
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

/**
 * Sibling of the sort button rather than a child, so a drag never toggles the
 * sort. Double-click resets one column; arrow keys give it a keyboard path,
 * since a drag handle is otherwise mouse-only.
 */
function ResizeHandle({ header }: { header: Header<Ticket, unknown> }) {
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

/**
 * Status is a progression, so it reads as emphasis: Open is solid and loud,
 * Resolved is a soft accent tint, Closed recedes to neutral. Scanning a page
 * of tickets, the ones still needing work are the ones that stand out.
 */
const STATUS_BADGE: Record<
  TicketStatus,
  { variant: "default" | "outline"; className?: string }
> = {
  [TICKET_STATUS.Open]: { variant: "default" },
  [TICKET_STATUS.Resolved]: {
    variant: "outline",
    className:
      "border-transparent bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  },
  [TICKET_STATUS.Closed]: {
    variant: "outline",
    // foreground/70 rather than muted-foreground: the theme's own
    // muted-foreground-on-muted pairing measures 4.1:1, under AA for text-xs.
    className: "border-transparent bg-muted text-foreground/70",
  },
};

/**
 * Categories are peers rather than a ranking, so each gets its own hue at a
 * matched lightness. The theme's chart ramp is monochrome emerald — fine for
 * a chart, useless for telling four labels apart — hence explicit hues, with
 * `dark:` text so each stays legible on both themes.
 */
const CATEGORY_BADGE: Record<TicketCategory, string> = {
  [TICKET_CATEGORY.General]:
    "border-transparent bg-sky-500/12 text-sky-700 dark:text-sky-300",
  [TICKET_CATEGORY.Technical]:
    "border-transparent bg-violet-500/12 text-violet-700 dark:text-violet-300",
  // amber-700 measures 4.5:1 on the light tint — one step darker to clear AA.
  [TICKET_CATEGORY.Refund]:
    "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300",
  [TICKET_CATEGORY.Other]:
    "border-transparent bg-rose-500/12 text-rose-700 dark:text-rose-300",
};

function StatusBadge({ status }: { status: TicketStatus }) {
  const { variant, className } = STATUS_BADGE[status];
  return (
    <Badge variant={variant} className={className}>
      {status}
    </Badge>
  );
}

function CategoryBadge({ category }: { category: TicketCategory }) {
  return (
    <Badge variant="outline" className={CATEGORY_BADGE[category]}>
      {category}
    </Badge>
  );
}
