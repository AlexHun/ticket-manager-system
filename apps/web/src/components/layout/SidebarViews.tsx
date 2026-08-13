import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  InboxIcon,
  TagsIcon,
  UserRoundCheckIcon,
  UserRoundXIcon,
  type LucideIcon,
} from "lucide-react";
import {
  TICKET_VIEW,
  TICKET_VIEWS,
  ticketViewParams,
  type TicketView,
  type TicketViewCountsResponse,
} from "@ticket/shared";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { LIST_PARAM } from "@/lib/ticket-list-params";
import { ticketKeys } from "@/lib/ticket-queries";
import { cn } from "@/lib/utils";

/**
 * What each view is called and what it is drawn as. Deliberately *not* in
 * `@ticket/shared` beside `ticketViewParams`: the server counts these and has no
 * business holding an icon. What has to be shared is the query, and only that.
 *
 * The two ownership views take the two person-shaped icons, so the pair reads as
 * one question — who has this — answered two ways.
 */
const VIEW_META: Record<TicketView, { label: string; icon: LucideIcon }> = {
  [TICKET_VIEW.backlog]: { label: "Backlog", icon: InboxIcon },
  [TICKET_VIEW.unassigned]: { label: "Unassigned", icon: UserRoundXIcon },
  [TICKET_VIEW.mine]: { label: "Mine", icon: UserRoundCheckIcon },
  [TICKET_VIEW.untriaged]: { label: "Untriaged", icon: TagsIcon },
};

/**
 * The params that decide *which* tickets. Sort, page and page size are missing
 * on purpose: they change how a view is read, not what is in it, so paging to
 * the second page of Unassigned must not un-light the row you got there from.
 */
const FILTER_PARAMS = [
  LIST_PARAM.status,
  LIST_PARAM.category,
  LIST_PARAM.assignedTo,
  LIST_PARAM.q,
] as const;

/**
 * Whether the list is currently showing exactly this view.
 *
 * Every filter param has to agree, including the ones the view doesn't set —
 * a search typed on top of Unassigned is a narrower thing than the view, and
 * leaving the row lit would claim the badge's number was on screen when it is
 * not. Absent and empty are the same thing here, which is what `?? ""` is for.
 */
function isViewActive(
  params: Record<string, string>,
  searchParams: URLSearchParams,
): boolean {
  return FILTER_PARAMS.every(
    (key) => (searchParams.get(key) ?? "") === (params[key] ?? ""),
  );
}

function useTicketViewCounts() {
  return useQuery({
    queryKey: ticketKeys.views,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketViewCountsResponse>(
        "/api/tickets/views",
        { signal },
      );
      return data.counts;
    },
  });
}

/**
 * Saved queue views, with how many tickets are behind each.
 *
 * These are the questions the list gets opened to ask, and until now every one
 * of them cost a trip through the filter bar — two selects and, for "Mine", a
 * roster fetch to find your own name in. The counts are the other half: an agent
 * can see there is nothing unassigned without going to look, which is the
 * difference between a nav item and a queue.
 *
 * Every row's `href` and every badge's number are built from the same
 * `ticketViewParams` entry, on the two sides of the wire — see the note there.
 * The rule this enforces is that a number and the page it links to say the same
 * thing, which is not something this app has always managed.
 */
export function SidebarViews() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { data: session } = useSession();
  const { data: counts } = useTicketViewCounts();

  // `ProtectedRoute` blocks on the session before this renders, so the fallback
  // is for the type rather than for a state anyone sees.
  const viewerId = session?.user.id ?? "";
  const onList = pathname === "/tickets";

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Queues</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-1">
          {TICKET_VIEWS.map((view) => {
            const { label, icon: Icon } = VIEW_META[view];
            const params = ticketViewParams(view, viewerId);
            const active = onList && isViewActive(params, searchParams);
            const count = counts?.[view];

            return (
              <SidebarMenuItem key={view}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={label}
                  className="data-[active=true]:[&>svg]:text-sidebar-primary"
                >
                  {/* `Link`, not `NavLink`: NavLink derives aria-current from
                      the path alone, and all four of these share one path — it
                      would mark every row current the moment you were anywhere
                      on the list. The search params are what tell them apart, so
                      the state is computed here and written by hand. */}
                  <Link
                    to={{ pathname: "/tickets", search: `?${new URLSearchParams(params)}` }}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>

                {/* Nothing at all until the number is known — a placeholder here
                    would be a shape in the position a count goes, which reads as
                    a count. Once loaded the row keeps its number through every
                    refetch, so this appears once per session and never blinks.

                    Zero is drawn quietly rather than hidden: an empty queue is
                    worth saying, but three permanent noughts should not be the
                    loudest thing in the sidebar. */}
                {count !== undefined && (
                  <SidebarMenuBadge
                    className={cn(count === 0 && "text-muted-foreground/60")}
                  >
                    {count}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
