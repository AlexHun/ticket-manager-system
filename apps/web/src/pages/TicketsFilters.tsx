import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import {
  ASSIGNEE_NONE,
  CATEGORY_NONE,
  CLIENT_TICKET_STATUS,
  STATUS_BACKLOG,
  TICKET_CATEGORY,
  TICKET_SEARCH_MAX_LENGTH,
  type ClientTicketStatusFilter,
  type TicketCategoryFilter,
} from "@ticket/shared";
import { FilterSelect } from "@/components/FilterSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSession } from "@/lib/auth-client";
import { useAssigneesQuery } from "@/lib/use-assignees";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

/** `""` is the "no filter" choice in our own state — same convention `FilterSelect` uses. */
const ANY = "";

export interface TicketFilterState {
  /**
   * One status, `STATUS_BACKLOG` for New and Open together, or `ANY`.
   *
   * Never `Processing`: the list refuses to return those, so the API rejects the
   * filter — see `CLIENT_TICKET_STATUS`. A ticket a worker is answering is
   * hidden precisely so that nobody picks it up and answers it twice, and a
   * filter that revealed them would undo that.
   */
  status: ClientTicketStatusFilter | typeof ANY;
  category: TicketCategoryFilter | typeof ANY;
  /** A user id, `ASSIGNEE_NONE` for unassigned, or `ANY`. */
  assignedTo: string;
  search: string;
}

export const EMPTY_FILTERS: TicketFilterState = {
  status: ANY,
  category: ANY,
  assignedTo: ANY,
  search: "",
};

/**
 * How many of the select filters are set: the ones a phone keeps behind its
 * Filters button, so the count it shows.
 */
function selectFilterCount(filters: TicketFilterState): number {
  return [filters.status, filters.category, filters.assignedTo].filter(
    (value) => value !== ANY,
  ).length;
}

export function hasActiveFilters(filters: TicketFilterState): boolean {
  return selectFilterCount(filters) > 0 || filters.search.trim() !== "";
}

interface TicketsFiltersProps {
  filters: TicketFilterState;
  onChange: (filters: TicketFilterState) => void;
}

export function TicketsFilters({ filters, onChange }: TicketsFiltersProps) {
  const isMobile = useIsMobile();
  const active = hasActiveFilters(filters);

  const clearButton = active && (
    <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
      <X />
      Clear filters
    </Button>
  );

  // One layout or the other, never both hidden by CSS: each filter's label is
  // wired to its control by id, and two copies of the bar would put every id on
  // the page twice.
  if (!isMobile) {
    return (
      <div className="flex flex-wrap items-end gap-3">
        <SearchField
          filters={filters}
          onChange={onChange}
          inputClassName="w-64"
        />
        <SelectFilters filters={filters} onChange={onChange} />
        {clearButton}
      </div>
    );
  }

  // On a phone the bar above wraps to one field per line, which left the table
  // a handful of rows (#402). Search stays on the page, since its box
  // shows what it holds; the rest move into a sheet, and the button's count
  // says how many of them are set.
  const count = selectFilterCount(filters);

  return (
    <div className="flex items-end gap-2">
      <SearchField
        filters={filters}
        onChange={onChange}
        className="min-w-0 flex-1"
        inputClassName="w-full"
      />
      <Sheet>
        <SheetTrigger asChild>
          {/* Named outright while it carries a count: the badge alone would read
              as "Filters2", since an accessible name runs inline text together. */}
          <Button
            variant="outline"
            aria-label={count > 0 ? `Filters, ${count} active` : undefined}
          >
            <SlidersHorizontal aria-hidden="true" />
            Filters
            {count > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {count}
              </Badge>
            )}
          </Button>
        </SheetTrigger>
        {/* No description: the title and the labelled fields under it are the
            whole of what the sheet says. */}
        <SheetContent side="bottom" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          {/* Every change applies as it is made, as on the desktop bar, so the
              URL is written the same way and there is no Apply to forget. */}
          <div className="flex flex-col gap-3 px-4 pb-4">
            <SelectFilters
              filters={filters}
              onChange={onChange}
              triggerClassName="w-full"
            />
            {clearButton && <div className="self-start">{clearButton}</div>}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SearchField({
  filters,
  onChange,
  className,
  inputClassName,
}: TicketsFiltersProps & { className?: string; inputClassName: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor="ticket-search">Search</Label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="ticket-search"
          type="search"
          value={filters.search}
          maxLength={TICKET_SEARCH_MAX_LENGTH}
          placeholder="Subject, customer or email"
          className={cn("pl-8", inputClassName)}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </div>
    </div>
  );
}

/** Status, category and assignee — the filters a phone keeps in its sheet. */
function SelectFilters({
  filters,
  onChange,
  triggerClassName,
}: TicketsFiltersProps & { triggerClassName?: string }) {
  return (
    <>
      <FilterSelect
        id="ticket-status-filter"
        triggerClassName={triggerClassName}
        label="Status"
        value={filters.status}
        anyLabel="Any status"
        // `CLIENT_TICKET_STATUS`, not every status: `Processing` is missing
        // because the list never returns one, so offering it would be a filter
        // guaranteed to show an empty page.
        //
        // Backlog leads, and is the only entry here that is a set rather than a
        // status. It has to be offered: the sidebar's saved views all select it,
        // and a value the select cannot draw leaves Radix rendering an empty
        // trigger — a filtered list that looks unfiltered. It is the same word
        // the sidebar uses, deliberately, so arriving from "Backlog" and reading
        // the control you arrived at agree.
        options={[
          { value: STATUS_BACKLOG, label: "Backlog" },
          ...CLIENT_TICKET_STATUS.map((s) => ({
            value: s,
            label: s,
          })),
        ]}
        onChange={(value) =>
          onChange({ ...filters, status: value as TicketFilterState["status"] })
        }
      />

      <FilterSelect
        id="ticket-category-filter"
        triggerClassName={triggerClassName}
        label="Category"
        value={filters.category}
        anyLabel="Any category"
        options={[
          ...Object.values(TICKET_CATEGORY).map((c) => ({
            value: c,
            label: c,
          })),
          { value: CATEGORY_NONE, label: "Uncategorised" },
        ]}
        onChange={(value) =>
          onChange({
            ...filters,
            category: value as TicketFilterState["category"],
          })
        }
      />

      <AssigneeFilter
        value={filters.assignedTo}
        onChange={(assignedTo) => onChange({ ...filters, assignedTo })}
        triggerClassName={triggerClassName}
      />

      <AssigneeShortcuts
        value={filters.assignedTo}
        onChange={(assignedTo) => onChange({ ...filters, assignedTo })}
      />
    </>
  );
}

const ANY_ASSIGNEE_LABEL = "Any assignee";
const UNASSIGNED_LABEL = "Unassigned";

/** Local tokens for the two shortcut chips — neither ever leaves this module. */
const SHORTCUT = { mine: "mine", unassigned: "unassigned" } as const;

/**
 * The two assignee filters worth reaching in one click, beside the select that
 * can express all of them.
 *
 * They exist because the dropdown next door is the slowest control on the page
 * for the two questions asked most: it fetches the roster on first open, so
 * "what's mine" meant opening a menu, waiting for a request, and finding your
 * own name in an alphabetical list of colleagues. The session already knows who
 * you are, so that whole round trip buys nothing here.
 *
 * Not a replacement for the select — picking a *colleague* is still a roster
 * job. These write the same `assignedTo` field, so the two controls always
 * agree, and "Clear filters" clears them like anything else.
 */
function AssigneeShortcuts({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { data: session } = useSession();
  const myId = session?.user.id;

  const active =
    myId && value === myId
      ? SHORTCUT.mine
      : value === ASSIGNEE_NONE
        ? SHORTCUT.unassigned
        : ANY;

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={active}
      // Radix emits "" when the pressed item is clicked again, and unlike the
      // dashboard's ranges that is meaningful here: clicking the lit chip is
      // how you take the filter off, so the empty value is written through
      // rather than ignored.
      onValueChange={(next) => {
        if (next === SHORTCUT.mine && myId) onChange(myId);
        else if (next === SHORTCUT.unassigned) onChange(ASSIGNEE_NONE);
        else onChange(ANY);
      }}
      aria-label="Assignee shortcuts"
    >
      {/* Hidden rather than disabled without a session: there is no session to
          resolve "mine" against, and a dead control is worse than no control.
          In practice `ProtectedRoute` means this is always present. */}
      {myId && <ToggleGroupItem value={SHORTCUT.mine}>Mine</ToggleGroupItem>}
      <ToggleGroupItem value={SHORTCUT.unassigned}>
        {UNASSIGNED_LABEL}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/**
 * Narrow the list to one person's tickets, or to the ones nobody owns.
 *
 * Its own component because it is the only filter whose options come from the
 * server. The other two are enums the client already has, and answer instantly.
 */
function AssigneeFilter({
  value,
  onChange,
  triggerClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  triggerClassName?: string;
}) {
  // The roster is only needed to draw this dropdown, and most visits to the
  // tickets list never open it — so it isn't fetched with the page. Opening it
  // once latches this on for the rest of the mount; a link that arrived already
  // filtered skips the wait, because the trigger has an id to turn into a name.
  const [opened, setOpened] = useState(false);
  const { data: assignees, isLoading } = useAssigneesQuery({
    enabled: opened || value !== ANY,
  });

  const options = [
    { value: ASSIGNEE_NONE, label: UNASSIGNED_LABEL },
    ...(assignees ?? []).map((assignee) => ({
      value: assignee.id,
      label: assignee.name,
    })),
  ];

  return (
    <FilterSelect
      id="ticket-assignee-filter"
      triggerClassName={triggerClassName}
      label="Assigned to"
      value={value}
      anyLabel={ANY_ASSIGNEE_LABEL}
      options={options}
      onChange={onChange}
      onOpenChange={(open) => open && setOpened(true)}
      // Radix draws an empty trigger for a value it has no item for, which is
      // every first paint of a filtered link and any id the roster has stopped
      // carrying — someone deleted since the link was shared. Name it either way
      // rather than showing a blank control that reads as "no filter".
      valueLabel={
        value === ANY
          ? ANY_ASSIGNEE_LABEL
          : (options.find((option) => option.value === value)?.label ??
            (isLoading ? "Loading…" : "Unknown team member"))
      }
      // A hint rather than a disabled item: a `SelectItem` is selectable, and
      // "Loading…" is not something anyone should be able to filter by.
      hint={isLoading ? "Loading the team…" : undefined}
    />
  );
}
