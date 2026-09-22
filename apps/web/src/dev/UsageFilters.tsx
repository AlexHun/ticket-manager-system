import { useId } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ANY_FACET,
  USAGE_FACETS,
  USAGE_FACET_KEYS,
  type UsageFacetKey,
  type UsageFacets,
} from "./usage-protocol";

/**
 * The three selects beside the Usage table's search box (#274).
 *
 * One forecast band, one verdict, or started versus unstarted — so "which
 * issues came in over their forecast?" is one action rather than a scan down
 * ninety-eight rows. They compose with the search and with each other:
 * `visibleRows` in `./usage-view` `&&`s `matchesFacets` with `matchesQuery`,
 * and the shown-out-of-total line beside them counts what both left.
 *
 * **Their reach is the table and nothing else**, which is #273's decision
 * standing rather than a new one. The accuracy figure, the distribution's
 * quartiles, the unattributed total and the gathered-at line all read
 * `report.issues` up on `UsagePage` and never see the filtered rows — the
 * accuracy figure is the number somebody might quote, and a control that moved
 * it would turn a claim about this repository into a claim about what somebody
 * had picked from a dropdown.
 *
 * **Rendered by walking `USAGE_FACET_KEYS` rather than written out three
 * times.** The specs carry every string — the label, the "any" row, each
 * option's words — so a fourth facet is an edit to the contract and nothing
 * here, and the two suites that reach for these controls by name cannot be left
 * driving one that was renamed. Three hand-written blocks would be three places
 * for the same select to drift.
 *
 * **shadcn's `Select`, not a native `<select>`**, per `frontend.md`: a native
 * popup is drawn by the OS, ignores `--popover`, `--radius` and the font
 * tokens, and shipped white-on-white options in dark mode the one time it was
 * tried in a filter bar. The consequence to know about is the `ANY_FACET`
 * token: Radix reserves `""` for *cleared* and throws on a `SelectItem` whose
 * value is it, so the row that clears a facet needs a non-empty token of its
 * own. See `ANY_FACET` in `./usage-protocol`.
 */
export function UsageFilters({
  facets,
  onChange,
}: {
  facets: UsageFacets;
  onChange: (next: UsageFacets) => void;
}) {
  /* One prefix, suffixed per facet below: `useId` is called once because the
     three controls are one component, and a hook cannot be called inside the
     map that renders them. */
  const idPrefix = useId();

  /* Radix hands `onValueChange` a bare `string` — a `SelectItem`'s value is
     typed as one, so there is no narrower signature to ask for. The values it
     can hand back are exactly the rows rendered below, which are `ANY_FACET`
     plus this facet's own options, so the assertion is over a set this module
     produced. The computed key is why it is one cast over the object rather
     than one over the value: a spread with a key of union type widens every
     field to the union of all three. */
  const pick = (key: UsageFacetKey, value: string) =>
    onChange({ ...facets, [key]: value } as UsageFacets);

  return (
    <>
      {USAGE_FACET_KEYS.map((key) => {
        const facet = USAGE_FACETS[key];
        const id = `${idPrefix}-${key}`;
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{facet.label}</Label>
            <Select
              value={facets[key]}
              onValueChange={(value) => pick(key, value)}
            >
              {/* Named by the `<Label>` above rather than by an `aria-label`,
                  matching the project map's workspace select and the search box
                  beside it — the name is on screen, so the control a sighted
                  developer reads and the one a test asks for are the same
                  thing. */}
              <SelectTrigger id={id} className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* The row that clears the facet, first and unmissable. No
                    `SelectLabel` anywhere in here: it reads its id from
                    `SelectGroup`'s context and *throws* without one, and
                    nothing above these pages is an error boundary. */}
                <SelectItem value={ANY_FACET}>{facet.any}</SelectItem>
                {facet.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </>
  );
}
