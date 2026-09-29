import { Link } from "react-router-dom";
import { BRAND_NAME } from "@/lib/brand";
import { ROUTE } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * The top of the sidebar: the lockup THE GREAT / FORGE / DESK, with no mark
 * beside it. The hallmark stays the favicon, where a word cannot go.
 *
 * Deliberately not a `SidebarMenuButton`: the icon rail forces those to
 * `size-8!`, so a lockup inside one would drop from its own height to 32px on
 * every collapse and pull the whole nav up with it. This row holds one height
 * (`h-22`) in both states instead, and collapsed, the lockup gives way to a
 * single "F" in the same face and finish.
 *
 * The letters are drawn rather than read — split across lines, spaced and
 * clipped to a gradient — so both halves are `aria-hidden` and the link takes
 * its name from `aria-label`, which also survives the collapse.
 */
/** THE GREAT and DESK: the small spaced lines above and below FORGE. */
const SMALL_LINE =
  "flex items-center gap-2 text-[0.74rem] font-bold tracking-[0.46em] text-muted-foreground";

export function SidebarBrand() {
  return (
    <Link
      to={ROUTE.dashboard.path}
      aria-label={BRAND_NAME}
      className="flex h-22 items-center rounded-md px-3 font-brand uppercase outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
    >
      <span
        aria-hidden="true"
        className="flex w-max flex-col group-data-[collapsible=icon]:hidden"
      >
        <span className={SMALL_LINE}>
          <span>The Great</span>
          <i className="brand-rule h-px min-w-4 flex-1" />
        </span>
        <span className="lit-iron mt-[0.1em] mb-[0.06em] -ml-[0.03em] text-[3.3rem] leading-[0.82] font-black tracking-[0.015em]">
          Forge
        </span>
        {/* The negative margin takes back the tracking after the last letter,
            so DESK ends flush with FORGE rather than 0.46em short of it — keep
            it equal to SMALL_LINE's tracking. */}
        <span className={cn(SMALL_LINE, "-mr-[0.46em] justify-end")}>
          <i className="brand-rule h-px min-w-4 flex-1 -scale-x-100" />
          <span>Desk</span>
        </span>
      </span>
      <span
        aria-hidden="true"
        className="lit-iron hidden text-[2rem] leading-[0.82] font-black group-data-[collapsible=icon]:block"
      >
        F
      </span>
    </Link>
  );
}
