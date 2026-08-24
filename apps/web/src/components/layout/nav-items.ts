import {
  BookTextIcon,
  FlaskConicalIcon,
  GraduationCapIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  NetworkIcon,
  TicketIcon,
  SendIcon,
  UsersIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import { matchPath } from "react-router-dom";
import { USER_ROLE, type UserRole } from "@ticket/shared";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /**
   * Match the path exactly. `/` needs it: without `end`, `matchPath` treats the
   * root as a prefix of every route and Dashboard stays lit on all of them.
   * `/tickets` deliberately omits it, which is what keeps Tickets marked while
   * you are on `/tickets/42`.
   */
  end?: boolean;
  /** Absent means everyone sees it. */
  role?: UserRole;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboardIcon, end: true },
  { to: "/tickets", label: "Tickets", icon: TicketIcon },
  { to: "/users", label: "Users", icon: UsersIcon, role: USER_ROLE.admin },
  {
    to: "/knowledge",
    label: "Knowledge base",
    icon: BookTextIcon,
    role: USER_ROLE.admin,
  },
  {
    to: "/outbox",
    label: "Outbox",
    icon: SendIcon,
    role: USER_ROLE.admin,
  },
  {
    to: "/pipeline",
    label: "Pipeline",
    icon: WorkflowIcon,
    role: USER_ROLE.admin,
  },
  {
    to: "/activity",
    label: "Activity",
    icon: HistoryIcon,
    role: USER_ROLE.admin,
  },
  {
    to: "/tutorials",
    label: "Tutorials",
    icon: GraduationCapIcon,
    role: USER_ROLE.admin,
  },
] as const;

/**
 * The dev tools, which exist only while `vite dev` is running.
 *
 * Empty in a production build, and empty by construction rather than by a check
 * at render time: Vite replaces `import.meta.env.DEV` with the literal `false`,
 * so Rollup drops the array *and* the two icon imports it is the only user of.
 * Everything that consumes this — the sidebar group, the dev shell's own nav —
 * therefore renders nothing without needing to know why.
 *
 * These sit apart from `NAV_ITEMS` on purpose: they are not part of the app's
 * navigation model. They have no role gate (in dev, everyone sees them), and
 * following one leaves `AppShell` entirely, which `sectionTitle` below would
 * otherwise be asked to name.
 */
export const DEV_NAV_ITEMS: readonly NavItem[] = import.meta.env.DEV
  ? ([
      { to: "/__dev/map", label: "Project map", icon: NetworkIcon, end: true },
      { to: "/__dev/tests", label: "Tests", icon: FlaskConicalIcon, end: true },
    ] as const)
  : [];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return matchPath({ path: item.to, end: item.end ?? false }, pathname) !== null;
}

/** Nav items this role is allowed to see. `undefined` role sees only the public ones. */
export function navItemsFor(role: UserRole | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.role || item.role === role);
}

/**
 * Which section the current route belongs to, for the document title.
 *
 * Derived from the same table the sidebar maps, so the tab name and the marked
 * nav item can never drift apart — `/tickets/42` reads "Tickets" in both
 * places until the ticket loads and names the tab after its subject.
 *
 * `null` for a route in no section, which today is only the 404. That is what
 * `useDocumentTitle` wants: it appends the app name itself, so returning
 * "Ticket Manager" here — as this used to — produced "Ticket Manager · Ticket
 * Manager" in the tab strip.
 *
 * Nothing here feeds the top bar any more. Pages name themselves now, in a
 * heading you can actually see; see `PageHeader`.
 */
export function sectionTitle(pathname: string): string | null {
  const item = NAV_ITEMS.find((candidate) => isNavItemActive(candidate, pathname));
  return item?.label ?? null;
}
