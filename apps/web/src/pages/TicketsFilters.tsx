import { Search, X } from "lucide-react";
import {
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  search: string;
}

export const EMPTY_FILTERS: TicketFilterState = {
  status: ANY,
  category: ANY,
  search: "",
};

export function hasActiveFilters(filters: TicketFilterState): boolean {
  return (
    filters.status !== ANY ||
    filters.category !== ANY ||
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

      {active && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          <X />
          Clear filters
        </Button>
      )}
    </div>
  );
}

interface FilterSelectProps {
  id: string;
  label: string;
  value: string;
  anyLabel: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

function FilterSelect({
  id,
  label,
  value,
  anyLabel,
  options,
  onChange,
}: FilterSelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value === ANY ? ANY_VALUE : value}
        onValueChange={(next) => onChange(next === ANY_VALUE ? ANY : next)}
      >
        <SelectTrigger id={id} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY_VALUE}>{anyLabel}</SelectItem>
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
