import { useState } from "react";
import { Search, X } from "lucide-react";
import {
  ASSIGNEE_NONE,
  CATEGORY_NONE,
  TICKET_CATEGORY,
  TICKET_SEARCH_MAX_LENGTH,
  TICKET_STATUS,
  type TicketCategoryFilter,
  type TicketStatus,
} from "@ticket/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAssigneesQuery } from "@/lib/use-assignees";

/** `""` is the "no filter" choice in our own state. */
const ANY = "";

/**
 * Radix rejects an empty-string item value (it reserves "" for "cleared"), so
 * the "any" row needs its own token. It never leaves this module — the state
 * and the API still use `ANY`.
 */
const ANY_VALUE = "any";

export interface TicketFilterState {
  status: TicketStatus | typeof ANY;
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

export function hasActiveFilters(filters: TicketFilterState): boolean {
  return (
    filters.status !== ANY ||
    filters.category !== ANY ||
    filters.assignedTo !== ANY ||
    filters.search.trim() !== ""
  );
}

interface TicketsFiltersProps {
  filters: TicketFilterState;
  onChange: (filters: TicketFilterState) => void;
}

export function TicketsFilters({ filters, onChange }: TicketsFiltersProps) {
  const active = hasActiveFilters(filters);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
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
            className="w-64 pl-8"
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
          />
        </div>
      </div>

      <FilterSelect
        id="ticket-status-filter"
        label="Status"
        value={filters.status}
        anyLabel="Any status"
        options={Object.values(TICKET_STATUS).map((s) => ({
          value: s,
          label: s,
        }))}
        onChange={(value) =>
          onChange({ ...filters, status: value as TicketFilterState["status"] })
        }
      />

      <FilterSelect
        id="ticket-category-filter"
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
      />

      {active && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          <X />
          Clear filters
        </Button>
      )}
    </div>
  );
}

const ANY_ASSIGNEE_LABEL = "Any assignee";
const UNASSIGNED_LABEL = "Unassigned";

/**
 * Narrow the list to one person's tickets, or to the ones nobody owns.
 *
 * Its own component because it is the only filter whose options come from the
 * server. The other two are enums the client already has, and answer instantly.
 */
function AssigneeFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
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
            (isLoading ? "Loading…" : "Unknown user"))
      }
      // A hint rather than a disabled item: a `SelectItem` is selectable, and
      // "Loading…" is not something anyone should be able to filter by.
      hint={isLoading ? "Loading users…" : undefined}
    />
  );
}

interface FilterSelectProps {
  id: string;
  label: string;
  value: string;
  anyLabel: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  /**
   * Trigger text, when the caller can't rely on `value` matching an option —
   * see `AssigneeFilter`. Omitted, the selected item's own label is shown.
   */
  valueLabel?: string;
  /** Non-selectable line under the options. */
  hint?: string;
  onOpenChange?: (open: boolean) => void;
}

function FilterSelect({
  id,
  label,
  value,
  anyLabel,
  options,
  onChange,
  valueLabel,
  hint,
  onOpenChange,
}: FilterSelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value === ANY ? ANY_VALUE : value}
        onValueChange={(next) => onChange(next === ANY_VALUE ? ANY : next)}
        onOpenChange={onOpenChange}
      >
        <SelectTrigger id={id} className="w-44">
          {/* `undefined` children leave Radix's default in place, which is the
              selected item's text — what every filter but the assignee wants. */}
          <SelectValue>{valueLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY_VALUE}>{anyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          {/* SelectGroup is not decoration: SelectLabel reads its id from the
              group's context and throws without one, which takes the page down
              with it — there is no error boundary above this. */}
          {hint && (
            <SelectGroup>
              <SelectLabel>{hint}</SelectLabel>
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
