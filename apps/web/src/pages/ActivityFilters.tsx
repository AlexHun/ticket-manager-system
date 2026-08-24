import { useState } from "react";
import { X } from "lucide-react";
import { ACTIVITY_ENTITY_TYPES, type ActivityEntityType } from "@ticket/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
 * The one validation this bar owns: a `from` after `to` is nonsense to send,
 * and the API's own `superRefine` would only echo it back as a 400 on the
 * request that already looks wrong on screen. Caught here instead, next to
 * the two fields, rather than after a round trip.
 */
export function hasInvalidActivityRange(filters: ActivityFilterState): boolean {
  return filters.from !== "" && filters.to !== "" && filters.from > filters.to;
}

interface ActivityFiltersProps {
  filters: ActivityFilterState;
  onChange: (filters: ActivityFilterState) => void;
}

export function ActivityFilters({ filters, onChange }: ActivityFiltersProps) {
  const active = hasActiveActivityFilters(filters);
  const invalidRange = hasInvalidActivityRange(filters);

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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="activity-from">From</Label>
        <Input
          id="activity-from"
          type="date"
          value={filters.from}
          max={filters.to || undefined}
          aria-invalid={invalidRange}
          className="w-40"
          onChange={(e) => onChange({ ...filters, from: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="activity-to">To</Label>
        <Input
          id="activity-to"
          type="date"
          value={filters.to}
          min={filters.from || undefined}
          aria-invalid={invalidRange}
          className="w-40"
          onChange={(e) => onChange({ ...filters, to: e.target.value })}
        />
      </div>

      {invalidRange && (
        <p role="alert" className="text-xs text-destructive">
          "From" must be on or before "To".
        </p>
      )}

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
