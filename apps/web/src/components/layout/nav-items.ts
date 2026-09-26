import {
  BookTextIcon,
  CoinsIcon,
  FlaskConicalIcon,
  GaugeIcon,
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
import {
  NEW_FEATURE_KEY,
  USER_ROLE,
  type NewFeatureKey,
  type UserRole,
} from "@ticket/shared";
import { ROUTE, type RoutePath } from "@/lib/routes";
import type { Viewer } from "@/lib/viewer";

export interface NavItem {
  /**
   * Read from `ROUTE`, never retyped — the union is what makes a stale path a
   * type error rather than a nav row that quietly links nowhere (issue #151).
   */
  to: RoutePath;
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
  /**
   * A demo session sees this admin item too (#320, R3), without holding the
   * role. Users and Outbox leave it off: a visitor never sees either.
   */
  demo?: true;
  /**
   * The "new" badge (issue #45): present means `AppSidebar` renders a dot on
   * this item while `NEW_FEATURE_VERSIONS[newFeatureKey]` in `@ticket/shared`
   * is ahead of what the signed-in user has seen, and marks it seen the first
   * time they follow the link.
   */
  newFeatureKey?: NewFeatureKey;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: ROUTE.dashboard.path,
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    end: true,
  },
  { to: ROUTE.tickets.path, label: "Tickets", icon: TicketIcon },
  {
    to: ROUTE.users.path,
    label: "Users",
    icon: UsersIcon,
    role: USER_ROLE.admin,
  },
  {
    to: ROUTE.knowledge.path,
    label: "Knowledge base",
    demo: true,
    icon: BookTextIcon,
    role: USER_ROLE.admin,
  },
  {
    to: ROUTE.outbox.path,
    label: "Outbox",
    icon: SendIcon,
    role: USER_ROLE.admin,
  },
  {
    to: ROUTE.pipeline.path,
    label: "Pipeline",
    demo: true,
    icon: WorkflowIcon,
    role: USER_ROLE.admin,
  },
  {
    to: ROUTE.evals.path,
    label: "Evals",
    demo: true,
    icon: GaugeIcon,
    role: USER_ROLE.admin,
  },
  {
    to: ROUTE.activity.path,
    label: "Activity",
    demo: true,
    icon: HistoryIcon,
    role: USER_ROLE.admin,
    newFeatureKey: NEW_FEATURE_KEY.activityPage,
  },
  {
    to: ROUTE.tutorials.path,
    label: "Tutorials",
    demo: true,
    icon: GraduationCapIcon,
    role: USER_ROLE.admin,
  },
] as const;

/**
 * The dev tools, which exist only while `vite dev` is running.
 *
 * Empty in a production build, and empty by construction rather than by a check
 * at render time: Vite replaces `import.meta.env.DEV` with the literal `false`,
 * so Rollup drops the array *and* the icon imports it is the only user of.
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
      {
        to: ROUTE.devMap.path,
        label: "Project map",
        icon: NetworkIcon,
        end: true,
      },
      {
        to: ROUTE.devTests.path,
        label: "Tests",
        icon: FlaskConicalIcon,
        end: true,
      },
      {
        to: ROUTE.devUsage.path,
        label: "Usage",
        icon: CoinsIcon,
        end: true,
      },
    ] as const)
  : [];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return (
    matchPath({ path: item.to, end: item.end ?? false }, pathname) !== null
  );
}

/** Nav items this viewer is allowed to see. An `undefined` role sees only the public ones. */
export function navItemsFor(viewer: Viewer): NavItem[] {
  return NAV_ITEMS.filter(
    (item) =>
      !item.role ||
      item.role === viewer.role ||
      (viewer.demo && item.demo === true),
  );
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
  const item = NAV_ITEMS.find((candidate) =>
    isNavItemActive(candidate, pathname),
  );
  return item?.label ?? null;
}
