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

/**
 * Radix rejects an empty-string item value (it reserves "" for "cleared"), so
 * the "any" row needs its own token. It never leaves this module — every
 * filter bar's own state and API params use `""` for "no filter".
 */
const ANY_VALUE = "any";

export interface FilterSelectOption {
  value: string;
  label: string;
}

export interface FilterSelectProps {
  id: string;
  label: string;
  /** `""` means "no filter" — the convention every caller's own state uses. */
  value: string;
  anyLabel: string;
  options: FilterSelectOption[];
  onChange: (value: string) => void;
  /**
   * Trigger text, when the caller can't rely on `value` matching an option —
   * e.g. a value drawn before its label has loaded. Omitted, the selected
   * item's own label is shown.
   */
  valueLabel?: string;
  /** Non-selectable line under the options. */
  hint?: string;
  onOpenChange?: (open: boolean) => void;
  /** Trigger width; filter bars vary this per field. */
  triggerClassName?: string;
}

/**
 * One labelled shadcn `Select` for a filter bar: the Radix wiring, the
 * `""`↔`ANY_VALUE` empty-string workaround, and the `SelectGroup` requirement
 * `SelectLabel` throws without — in a single place instead of once per filter.
 */
export function FilterSelect({
  id,
  label,
  value,
  anyLabel,
  options,
  onChange,
  valueLabel,
  hint,
  onOpenChange,
  triggerClassName = "w-44",
}: FilterSelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value === "" ? ANY_VALUE : value}
        onValueChange={(next) => onChange(next === ANY_VALUE ? "" : next)}
        onOpenChange={onOpenChange}
      >
        <SelectTrigger id={id} className={triggerClassName}>
          {/* `undefined` children leave Radix's default in place, which is
              the selected item's text — what most filters want. */}
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
              group's context and throws without one, which takes the page
              down with it — there is no error boundary above this. */}
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
