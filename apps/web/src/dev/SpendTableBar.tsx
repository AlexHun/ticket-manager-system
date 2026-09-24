import { useId } from "react";
import { Columns3, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/ui/toggle";
import { countLabel } from "./module-match";
import { UsageFilters } from "./UsageFilters";
import {
  USAGE_DETAIL_LABEL,
  USAGE_SEARCH_LABEL,
  USAGE_TABLE_LABEL,
} from "./usage-copy";
import { withDetail, type UsageTableView } from "./usage-view";

/**
 * The filter bar: the box and the three selects that narrow the table,
 * what they have narrowed it to, and the control that widens it (#271,
 * #273, #274).
 *
 * **Its reach is the table and nothing else**, which is this slice's
 * whole decision. The two charts, the unattributed total and the
 * gathered-at line all read `report.issues` up on `UsagePage` and never
 * see the narrowed rows, so the accuracy figure goes on describing the scan
 * rather than the search box — a filter that moved it would turn a claim about
 * this repository into a claim about what somebody had typed. The
 * project map's bar next door reaches two ways at once (its selects stop
 * at two tabs, its search reaches all four), which is why a new
 * filtering surface here has to choose one deliberately.
 *
 * They all sit on one row because they are one bar. The toggle keeps
 * `variant="outline"` and its `aria-label`; the box is the project map's
 * shape down to the icon and the `pl-8`, and the selects are that page's
 * workspace select down to the `w-44`, because two filter bars two
 * clicks apart should not need learning twice.
 *
 * The narrowing controls wrap as a group of their own rather than
 * sharing one `flex-wrap` with the count and the toggle: at a width
 * where the selects have to drop to a second line, a `justify-between`
 * over all six would leave the count stranded beside the search box with
 * the thing it counts below it.
 *
 * Its own component since #297, out of `SpendTable.tsx`. It holds no state:
 * every control writes the whole `UsageTableView` back through
 * `onViewChange`, which is the page's (#272), and `shown` is whatever
 * `visibleRows` left — the bar counts rows, it never narrows them.
 */
export function SpendTableBar({
  view,
  onViewChange,
  shown,
  total,
}: {
  view: UsageTableView;
  onViewChange: (next: UsageTableView) => void;
  /** Rows left after every control on the bar. */
  shown: number;
  /** Rows the scan produced. */
  total: number;
}) {
  const searchId = useId();
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 max-w-sm flex-1 flex-col gap-1.5">
          <Label htmlFor={searchId}>{USAGE_SEARCH_LABEL}</Label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={searchId}
              type="search"
              value={view.query}
              placeholder="issue number or words from a title"
              onChange={(event) =>
                onViewChange({ ...view, query: event.target.value })
              }
              className="pl-8"
            />
          </div>
        </div>

        <UsageFilters
          facets={view.facets}
          onChange={(next) => onViewChange({ ...view, facets: next })}
        />
      </div>

      <div className="flex items-center gap-3">
        {/* The count, and it has to move when the rows do: a line still
            reading 98 over three visible rows is the same lie the map's
            frozen module counter used to tell, and the number is what a
            developer reads to confirm the search took at all. `countLabel` is
            that helper — a bare total at rest, `shown of total` while
            anything is narrowing it. **Anything**, which is why it reads
            `shown` rather than counting the query's own work: the
            facets narrow the same list, so one number describes all four
            controls without any of them having to report itself (#274).

            Visible rather than folded into the scroller's `aria-label`, which
            is where the plan first put it. `TableFrame`'s name is a landmark
            name: re-writing it on every keystroke would make the region
            announce a new title as you type, and it would still leave a
            sighted developer counting rows. The frame keeps the stable
            `USAGE_TABLE_LABEL`, and this line carries the arithmetic. */}
        <p className="text-sm text-muted-foreground tabular-nums">
          {USAGE_TABLE_LABEL} ({countLabel(shown, total)})
        </p>
        <Toggle
          variant="outline"
          size="sm"
          pressed={view.detail}
          /* The sort reset that comes with hiding a column is
             `withDetail`'s, in `./usage-view` — see its comment for why
             going back to the order the rows arrived in is the one outcome a
             vanished header can still announce. */
          onPressedChange={(next) => onViewChange(withDetail(view, next))}
          aria-label={USAGE_DETAIL_LABEL}
        >
          <Columns3 aria-hidden="true" />
          Detail columns
        </Toggle>
      </div>
    </div>
  );
}
