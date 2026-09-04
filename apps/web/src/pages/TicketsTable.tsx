import { useState, type ReactNode } from "react";
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
  BACKLOG_STATUS,
  TICKET_SORT_FIELD,
  type Ticket,
  type TicketSortField,
  type TicketWithAssignee,
} from "@ticket/shared";
import { Hint } from "@/components/Hint";
import { CategoryBadge, StatusBadge } from "@/components/TicketBadges";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSince } from "@/lib/format";
import { ticketDetailPath } from "@/lib/routes";
import { TableFrame } from "@/lib/table-frame";
import type { TicketListLocationState } from "@/lib/ticket-list-params";
import { ROW_DENSITY, type RowDensity } from "@/lib/use-row-density";
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
 *
 * "Activity" was fitted the same way, and the total is still exactly 880. It is
 * the narrowest column here because `formatSince` renders "6d" or "45m" rather
 * than a date — the header word is the widest thing in it, which is why the
 * label is "Activity" and not "Last activity".
 */
const COLUMN_META: Record<
  TicketSortField,
  { label: string; size: number; minSize: number }
> = {
  [TICKET_SORT_FIELD.subject]: { label: "Subject", size: 205, minSize: 160 },
  [TICKET_SORT_FIELD.customerName]: {
    label: "Customer",
    size: 160,
    minSize: 150,
  },
  [TICKET_SORT_FIELD.status]: { label: "Status", size: 100, minSize: 100 },
  [TICKET_SORT_FIELD.category]: { label: "Category", size: 110, minSize: 100 },
  [TICKET_SORT_FIELD.assignedTo]: {
    label: "Assigned to",
    size: 115,
    minSize: 110,
  },
  [TICKET_SORT_FIELD.lastMessageAt]: {
    label: "Activity",
    size: 90,
    minSize: 80,
  },
  [TICKET_SORT_FIELD.createdAt]: { label: "Created", size: 100, minSize: 90 },
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
        <Hint content={row.original.customerName}>
          <span className="truncate">{row.original.customerName}</span>
        </Hint>
        <Hint content={row.original.customerEmail}>
          <span className="truncate text-xs text-muted-foreground">
            {row.original.customerEmail}
          </span>
        </Hint>
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
        <Hint content={row.original.assignedTo.email}>
          <span className="block truncate">{row.original.assignedTo.name}</span>
        </Hint>
      ) : (
        <span className="text-muted-foreground">Unassigned</span>
      ),
  },
  {
    id: TICKET_SORT_FIELD.lastMessageAt,
    accessorKey: "lastMessageAt",
    ...metaOf(TICKET_SORT_FIELD.lastMessageAt),
    header: metaOf(TICKET_SORT_FIELD.lastMessageAt).label,
    // Elapsed rather than absolute, and the same `formatSince` the dashboard's
    // needs-attention panel uses — "6d" answers "has this been ignored?" at a
    // glance, where a date makes every reader do the subtraction.
    //
    // No `Hint`, unlike the three columns above. Theirs reveal text the cell
    // truncated; this value never truncates, so a tooltip here would be a
    // second job for a cell that has one, and the exact instant is already on
    // the ticket's own page under "Last message". It is not free either: every
    // Hint is a Radix Tooltip per row, and adding a fourth was enough to push
    // the slowest specs in TicketsPage.test.tsx past their timeout.
    cell: ({ row }) => (
      <span className="text-muted-foreground tabular-nums">
        {formatSince(row.original.lastMessageAt)}
      </span>
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
    <Hint content={ticket.subject}>
      <Link
        to={ticketDetailPath(ticket.id)}
        state={{ listSearch: location.search } satisfies TicketListLocationState}
        // `block` is what makes `truncate` work: an inline <a> isn't constrained
        // by the fixed-layout cell, so the ellipsis would never appear.
        className={cn(
          // The serif's other home. A subject is the one string on this page a
          // stranger typed, and at 15px in a table cell it is also the hardest
          // place to put a second family — which is why the face is a
          // screen-drawn transitional serif and not a display one.
          "block truncate font-display text-[0.95rem] font-medium underline-offset-4",
          "hover:underline focus-visible:underline",
        )}
      >
        {ticket.subject}
      </Link>
    </Hint>
  );
}

const DEFAULT_TOTAL_WIDTH = columns.reduce((sum, c) => sum + (c.size ?? 0), 0);

/**
 * The silence meter: how long this ticket has been quiet, as a bar on the
 * leading edge of its row.
 *
 * One element, in one place, encoding the single thing this product exists to
 * fix. The dashboard already measures silence in four buckets and the list could
 * not show it at all — you had to read a duration in the Activity column and do
 * the arithmetic per row. Heat does that at a glance down fifty rows.
 *
 * **It only lights for the backlog.** A Closed ticket that has been quiet for
 * eighteen months is not waiting for anybody, and letting the ramp run over
 * settled rows would paint the loudest thing on the page onto the work that is
 * finished — which is exactly the mistake the old all-green palette made in the
 * other direction. `BACKLOG_STATUS` is the same predicate the saved views and
 * every "not dealt with" number use.
 *
 * The thresholds are `AGE_BUCKET`'s, not new ones, so this bar and the backlog
 * age panel on the dashboard are one measurement drawn twice.
 *
 * It reads `lastMessageAt`, which is the last message in *either* direction —
 * so this is "quiet", not "waiting on us". The stronger claim needs the last
 * message's direction, which the list does not carry; see `waitingOnUs` in
 * ticket-stats.ts. Naming it honestly is the reason the tooltip says quiet.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

const SILENCE_STEPS = [
  { after: 7 * DAY_MS, className: "bg-ember-3", label: "quiet over a week" },
  { after: 3 * DAY_MS, className: "bg-ember-2", label: "quiet 3–7 days" },
  { after: 1 * DAY_MS, className: "bg-ember-1", label: "quiet 1–3 days" },
] as const;

function silenceOf(
  ticket: TicketWithAssignee,
): { className: string; label: string } | null {
  if (!BACKLOG_STATUS.some((s) => s === ticket.status)) return null;
  const quiet = Date.now() - new Date(ticket.lastMessageAt).getTime();
  return SILENCE_STEPS.find((step) => quiet >= step.after) ?? null;
}

const HEAD = "sticky top-0 z-10 bg-muted text-left font-medium";

/**
 * One `<th>` implementation for both the interactive header and its loading
 * skeleton, so `scope`, the header classes, and whether `aria-label` is set
 * can't drift between the two the way `aria-label` did in `00b7468` — the
 * skeleton's copy of this cell kept the same visible label but never got the
 * attribute, so an e2e locator matching by accessible name resolved against
 * it instead of the loaded header and read widths keyed by `""`.
 *
 * `ariaLabel` is left undefined by the skeleton on purpose, not an oversight
 * this time: it's the one thing that tells the two states apart while both
 * are briefly mounted during a refetch, and `columnWidths()` in
 * `tests/e2e/tickets.spec.ts` scopes its wait and its read to `th[aria-label]`
 * for exactly that reason. Don't add it there without updating that test.
 */
function HeaderCell({
  ariaLabel,
  ariaSort,
  children,
}: {
  ariaLabel?: string;
  ariaSort?: "ascending" | "descending" | "none";
  children: ReactNode;
}) {
  return (
    <th
      scope="col"
      aria-label={ariaLabel}
      aria-sort={ariaSort}
      // No `relative` here: it would fight `sticky` for the position
      // property. Sticky is already a containing block for the
      // absolutely-positioned resize handle.
      className={cn(HEAD, "px-4 py-2")}
    >
      {children}
    </th>
  );
}

/**
 * What a row's density actually changes: the cell padding, and the leading the
 * two-line Customer cell inherits.
 *
 * Both lines survive compaction, and that is the deliberate part. The obvious
 * way to halve a row here is to drop the customer's email to a tooltip — but
 * this queue holds two distinct customers both named "Marta Kowalska", told
 * apart only by `@example.com` against `@gmail.com`. Hiding that behind a hover
 * would make the mode meant for scanning the one mode you cannot safely scan,
 * and the hover in question is a shadcn Tooltip on a 2s delay. So compact takes
 * the space out of the padding and the line height, where nothing is lost.
 *
 * `leading-tight` is set on the cell rather than inside the Customer renderer
 * because line-height inherits — one class here reaches both lines without the
 * column definitions needing to know density exists.
 */
const CELL_DENSITY: Record<RowDensity, string> = {
  [ROW_DENSITY.comfortable]: "py-2",
  [ROW_DENSITY.compact]: "py-1 leading-tight",
};

interface TicketsTableProps {
  tickets: TicketWithAssignee[];
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  /** Shown instead of the table when there is nothing to render. */
  emptyMessage?: string;
  density?: RowDensity;
  className?: string;
}

export function TicketsTable({
  tickets,
  sorting,
  onSortingChange,
  emptyMessage = "No tickets found.",
  density = ROW_DENSITY.comfortable,
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
      <TableFrame
        label="Tickets"
        className={cn("grid place-items-center", className)}
      >
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </TableFrame>
    );
  }

  return (
    <TableFrame label="Tickets" className={className}>
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
                  <HeaderCell
                    key={header.id}
                    // Explicit, so the resize handle's own label doesn't get
                    // concatenated into the header's accessible name.
                    ariaLabel={label}
                    ariaSort={direction === false ? "none" : ARIA_SORT[direction]}
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
                  </HeaderCell>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const silence = silenceOf(row.original);
            return (
              <tr
                key={row.id}
                className="border-t border-border transition-colors hover:bg-muted/50"
              >
                {row.getVisibleCells().map((cell, index) => (
                  <td
                    key={cell.id}
                    className={cn("relative px-4", CELL_DENSITY[density])}
                  >
                    {/* The meter, on the first cell only — a table row cannot
                        carry a positioned child of its own, and the leading
                        edge is where the eye starts. `inset-y-px` keeps it off
                        the row borders so a column of them reads as separate
                        marks rather than one continuous stripe. */}
                    {index === 0 && silence && (
                      <span
                        aria-hidden="true"
                        title={`Last message ${silence.label}`}
                        className={cn(
                          "absolute inset-y-px left-0 w-[3px] rounded-r-sm",
                          silence.className,
                        )}
                      />
                    )}
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableFrame>
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

/**
 * The placeholder shape per column, keyed by column id rather than written as a
 * list of cells in row order.
 *
 * That is not tidiness. The cells here used to be six hand-written `<td>`s while
 * `<colgroup>` and `<thead>` mapped over `columns` — so adding the Activity
 * column left every skeleton row one cell short, silently, because a short row
 * is still valid HTML and the missing cell is invisible against an empty table.
 * A `Record` over the id union makes the next added column a compile error here.
 */
const SKELETON_CELL: Record<TicketSortField, string> = {
  [TICKET_SORT_FIELD.subject]: "h-4 w-40",
  [TICKET_SORT_FIELD.customerName]: "h-4 w-28",
  [TICKET_SORT_FIELD.status]: "h-5 w-16 rounded-md",
  [TICKET_SORT_FIELD.category]: "h-5 w-16 rounded-md",
  [TICKET_SORT_FIELD.assignedTo]: "h-4 w-20",
  [TICKET_SORT_FIELD.lastMessageAt]: "h-4 w-10",
  [TICKET_SORT_FIELD.createdAt]: "h-4 w-16",
};

export function TicketsTableSkeleton({
  density = ROW_DENSITY.comfortable,
  className,
}: {
  density?: RowDensity;
  className?: string;
}) {
  return (
    <TableFrame label="Loading tickets" className={className} aria-busy="true">
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
            {columns.map((column) => {
              const { label } = COLUMN_META[column.id];
              return (
                <HeaderCell key={column.id}>
                  <span className="truncate">{label}</span>
                </HeaderCell>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
            <tr key={i} className="border-t border-border">
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cn("px-4", CELL_DENSITY[density])}
                >
                  <Skeleton className={SKELETON_CELL[column.id]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
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

