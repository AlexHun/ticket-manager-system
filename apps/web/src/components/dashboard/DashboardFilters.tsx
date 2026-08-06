import {
  DASHBOARD_RANGE,
  DASHBOARD_SCOPE,
  type DashboardRange,
  type DashboardScope,
} from "@ticket/shared";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Shortest first, so the group reads as a scale. The labels are the API's own
 *  preset values — there is nothing to translate. */
const RANGES: { value: DashboardRange; label: string }[] = [
  { value: DASHBOARD_RANGE.d7, label: "7d" },
  { value: DASHBOARD_RANGE.d30, label: "30d" },
  { value: DASHBOARD_RANGE.d90, label: "90d" },
  { value: DASHBOARD_RANGE.m12, label: "12m" },
];

const SCOPES: { value: DashboardScope; label: string }[] = [
  { value: DASHBOARD_SCOPE.all, label: "Everyone" },
  { value: DASHBOARD_SCOPE.mine, label: "Mine" },
];

interface DashboardFiltersProps {
  range: DashboardRange;
  scope: DashboardScope;
  onRangeChange: (range: DashboardRange) => void;
  onScopeChange: (scope: DashboardScope) => void;
}

/**
 * One filter row above everything it scopes.
 *
 * Both controls apply to every panel on the page — per-card filters would let
 * two cards describe different slices while sitting side by side, which is the
 * whole reason the API answers in one response.
 *
 * Segmented controls rather than selects: each is a small closed set the reader
 * benefits from seeing all of, and picking a range shouldn't cost a popup.
 */
export function DashboardFilters({
  range,
  scope,
  onRangeChange,
  onScopeChange,
}: DashboardFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={range}
        // Radix emits "" when the active item is clicked again. A range is not
        // clearable — there is no "no time" — so an empty value is ignored
        // rather than being written back as a broken URL.
        onValueChange={(value) => {
          if (value) onRangeChange(value as DashboardRange);
        }}
        aria-label="Time range"
      >
        {RANGES.map(({ value, label }) => (
          <ToggleGroupItem key={value} value={value} aria-label={`Last ${label}`}>
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={scope}
        onValueChange={(value) => {
          if (value) onScopeChange(value as DashboardScope);
        }}
        aria-label="Ticket scope"
      >
        {SCOPES.map(({ value, label }) => (
          <ToggleGroupItem key={value} value={value}>
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
