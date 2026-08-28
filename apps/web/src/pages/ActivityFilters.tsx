import { useState } from "react";
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  startOfMonth,
  startOfToday,
} from "date-fns";
import type { DateRange } from "react-day-picker";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { ACTIVITY_ENTITY_TYPES, type ActivityEntityType } from "@ticket/shared";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACTIVITY_ENTITY_LABEL } from "@/lib/activity-feed-labels";
import { useUsersQuery } from "@/lib/use-users";

/** `""` is "no filter", in our own state — same convention as `TicketsFilters`. */
const ANY = "";

/** Radix reserves the empty string on a `SelectItem` for "cleared". */
const ANY_VALUE = "any";

export interface ActivityFilterState {
  entityType: ActivityEntityType | typeof ANY;
  actorId: string;
  /** `YYYY-MM-DD`, or `""` for no bound. Inclusive of the whole day. */
  from: string;
  to: string;
}

export const EMPTY_ACTIVITY_FILTERS: ActivityFilterState = {
  entityType: ANY,
  actorId: ANY,
  from: "",
  to: "",
};

export function hasActiveActivityFilters(filters: ActivityFilterState): boolean {
  return (
    filters.entityType !== ANY ||
    filters.actorId !== ANY ||
    filters.from !== "" ||
    filters.to !== ""
  );
}

/**
 * Parsed by splitting rather than `new Date(iso)` — same reasoning as
 * `formatBucketLabel` in `lib/format.ts`: `new Date("2026-08-03")` is UTC
 * midnight, which `Calendar` would then render as Aug 2 anywhere west of
 * Greenwich. Splitting into local year/month/day keeps the date the field
 * shows in sync with the date actually sent.
 */
function parseLocalDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toValue(date: Date | undefined): string {
  return date ? formatLocalDate(date) : "";
}

/** The trigger's label: the start alone while a range is still mid-pick,
 *  collapsed to one date for a same-day range, both ends otherwise. */
function rangeLabel(from: Date | undefined, to: Date | undefined): string {
  if (!from) return "Any date";
  if (!to || formatLocalDate(from) === formatLocalDate(to)) {
    return format(from, "MMM d, yyyy");
  }
  return `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`;
}

interface DatePreset {
  label: string;
  range: () => { from?: Date; to?: Date };
}

/**
 * Computed at click time, not module load — "Today" has to mean today
 * whenever the popover happens to be opened, not whenever the page was
 * first rendered.
 */
const DATE_PRESETS: DatePreset[] = [
  { label: "Today", range: () => ({ from: startOfToday(), to: startOfToday() }) },
  {
    label: "Last 7 days",
    range: () => ({ from: addDays(startOfToday(), -6), to: startOfToday() }),
  },
  {
    label: "Last 30 days",
    range: () => ({ from: addDays(startOfToday(), -29), to: startOfToday() }),
  },
  {
    label: "This month",
    // Through today, not month-end — there's no future activity to bound.
    range: () => ({ from: startOfMonth(startOfToday()), to: startOfToday() }),
  },
  {
    label: "Last month",
    range: () => {
      const end = endOfMonth(addMonths(startOfToday(), -1));
      return { from: startOfMonth(end), to: end };
    },
  },
  { label: "All time", range: () => ({ from: undefined, to: undefined }) },
];

interface ActivityFiltersProps {
  filters: ActivityFilterState;
  onChange: (filters: ActivityFilterState) => void;
}

export function ActivityFilters({ filters, onChange }: ActivityFiltersProps) {
  const active = hasActiveActivityFilters(filters);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <EntityTypeFilter
        value={filters.entityType}
        onChange={(entityType) => onChange({ ...filters, entityType })}
      />

      <ActorFilter
        value={filters.actorId}
        onChange={(actorId) => onChange({ ...filters, actorId })}
      />

      <ActivityDateRangeField
        value={{ from: filters.from, to: filters.to }}
        onChange={({ from, to }) => onChange({ ...filters, from, to })}
      />

      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(EMPTY_ACTIVITY_FILTERS)}
        >
          <X />
          Clear filters
        </Button>
      )}
    </div>
  );
}

interface ActivityDateRangeValue {
  from: string;
  to: string;
}

/**
 * A `Calendar` in `mode="range"` plus a rail of presets, both in one
 * `Popover`. Range mode makes an inverted pick structurally impossible — the
 * second click always becomes the later end — so unlike the old pair of
 * single-date fields, there is no invalid-range state left to guard against.
 */
function ActivityDateRangeField({
  value,
  onChange,
}: {
  value: ActivityDateRangeValue;
  onChange: (value: ActivityDateRangeValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const from = parseLocalDate(value.from);
  const to = parseLocalDate(value.to);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="activity-date-range">Date range</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="activity-date-range"
            variant="outline"
            className="w-56 justify-start font-normal"
          >
            <CalendarIcon className="text-muted-foreground" />
            {rangeLabel(from, to)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-auto flex-row gap-2 p-2" align="start">
          <div className="flex flex-col gap-0.5 border-r border-border pr-2">
            {DATE_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="ghost"
                size="sm"
                className="justify-start font-normal"
                onClick={() => {
                  const picked = preset.range();
                  onChange({ from: toValue(picked.from), to: toValue(picked.to) });
                  setOpen(false);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <Calendar
            mode="range"
            showOutsideDays={false}
            // Without `min`, react-day-picker completes the range on the
            // first click alone (`{from: date, to: date}`) — a same-day
            // range, immediately closing the popover before a second click
            // can land. `min={1}` forces the first click to set only
            // `from`, so a genuine two-click pick still works; a same-day
            // range still reaches the field via the presets.
            min={1}
            selected={{ from, to } satisfies DateRange}
            defaultMonth={from ?? new Date()}
            onSelect={(range) => {
              onChange({ from: toValue(range?.from), to: toValue(range?.to) });
              if (range?.from && range?.to) setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function EntityTypeFilter({
  value,
  onChange,
}: {
  value: ActivityFilterState["entityType"];
  onChange: (value: ActivityFilterState["entityType"]) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="activity-entity-filter">Entity</Label>
      <Select
        value={value === ANY ? ANY_VALUE : value}
        onValueChange={(next) =>
          onChange(next === ANY_VALUE ? ANY : (next as ActivityEntityType))
        }
      >
        <SelectTrigger id="activity-entity-filter" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY_VALUE}>Any entity</SelectItem>
          {ACTIVITY_ENTITY_TYPES.map((entityType) => (
            <SelectItem key={entityType} value={entityType}>
              {ACTIVITY_ENTITY_LABEL[entityType]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const ANY_ACTOR_LABEL = "Any actor";

/**
 * Narrow the feed to one actor.
 *
 * Its own component because, like `AssigneeFilter` on the tickets page, the
 * roster it draws from is server data the rest of the bar doesn't need. Unlike
 * that filter this one uses `/api/users` — the full table, assistant account
 * included — because the assistant is a real actor here (`auto_resolved` /
 * `auto_declined` rows), not an assignable person.
 */
function ActorFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [opened, setOpened] = useState(false);
  const { data: users, isLoading } = useUsersQuery({
    enabled: opened || value !== ANY,
  });

  const options = (users ?? []).map((user) => ({
    value: user.id,
    label: user.automated ? `${user.name} (assistant)` : user.name,
  }));

  const valueLabel =
    value === ANY
      ? ANY_ACTOR_LABEL
      : (options.find((option) => option.value === value)?.label ??
        (isLoading ? "Loading…" : "Unknown user"));

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="activity-actor-filter">Actor</Label>
      <Select
        value={value === ANY ? ANY_VALUE : value}
        onValueChange={(next) => onChange(next === ANY_VALUE ? ANY : next)}
        onOpenChange={(open) => open && setOpened(true)}
      >
        <SelectTrigger id="activity-actor-filter" className="w-48">
          <SelectValue>{valueLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY_VALUE}>{ANY_ACTOR_LABEL}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
