import { useEffect } from "react";
import { BRAND_SHORT } from "@/lib/brand";

/**
 * What every title ends in, so a tab is identifiable as this app at a glance.
 * The short form, because a tab is the one place the full name does not fit.
 */
const APP_NAME = BRAND_SHORT;

/**
 * Name the document after what is on screen.
 *
 * Every route used to carry the bare app name, which costs more than it looks:
 * the browser's tab strip, its history menu and its back-button long-press all
 * identify a page by this string, so three open tickets and a dashboard were
 * four entries with one name. Window switchers and screen readers announce it
 * too — it is the first thing said on arrival.
 *
 * `null` is a page with no name of its own and yields the bare app name; the
 * separator is a middle dot rather than a dash because subjects contain dashes.
 *
 * No cleanup on unmount, deliberately. Whatever mounts next sets its own title,
 * and restoring a previous one in between would only produce a flicker through a
 * name for a page nobody is looking at.
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}
