import { Link, NavLink, useLocation } from "react-router-dom";
import { useSession } from "@/lib/auth-client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { LogoMark } from "./Logo";
import { isNavItemActive, navItemsFor } from "./nav-items";

export function AppSidebar() {
  const { data: session } = useSession();
  const { pathname } = useLocation();
  const items = navItemsFor(session?.user.role);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* Deliberately the default size, not `lg`: `lg` is `h-12`, but the
                rail forces every button to `size-8!`, so the brand row would
                jump 48px → 32px on every collapse. Matching the nav rows'
                height means the only thing that changes is the width. */}
            <SidebarMenuButton asChild tooltip="Ticket Manager">
              <Link to="/">
                {/* Sized by the button's own `[&_svg]:size-4`, which outranks a
                    size utility set here — don't pass one, it silently loses. */}
                <LogoMark className="shrink-0" />
                {/* sr-only rather than left to overflow-hidden: collapsed, the
                    16px plate plus the 8px gap puts this 8px inside the 32px
                    button, so clipping alone leaked a sliver of the "T". This
                    hides it outright while keeping it as the link's accessible
                    name — the tooltip is not one. */}
                <span className="truncate font-semibold group-data-[collapsible=icon]:sr-only">
                  Ticket Manager
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* shadcn's sidebar is all divs and lists, so this is the landmark. It
            is named because TicketsPagination already ships a <nav> of its own
            and an unscoped getByRole("navigation") would match both. */}
        <nav aria-label="Main">
          <SidebarGroup>
            <SidebarGroupContent>
              {/* The radix-nova SidebarMenu ships `gap-0`, which butts the
                  items against each other so the active item's fill runs
                  straight into its neighbours' hover fills. Small gap, but it
                  is what makes them read as three targets rather than one bar. */}
              <SidebarMenu className="gap-1">
                {items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    {/* Two mechanisms, two jobs, and neither is redundant:
                        `isActive` paints the item, `NavLink` emits
                        aria-current="page". Don't collapse them into one. */}
                    <SidebarMenuButton
                      asChild
                      isActive={isNavItemActive(item, pathname)}
                      tooltip={item.label}
                      // The accent fill alone measures 1.13:1 in light mode.
                      // Tinting the icon gives the active state a second,
                      // stronger cue (3.36:1) that also survives the icon rail,
                      // where the label is clipped away.
                      className="data-[active=true]:[&>svg]:text-sidebar-primary"
                    >
                      <NavLink to={item.to} end={item.end}>
                        <item.icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      {/* Drag/click target on the sidebar's edge — the second way to collapse,
          for people who never find the keyboard shortcut. */}
      <SidebarRail />
    </Sidebar>
  );
}
