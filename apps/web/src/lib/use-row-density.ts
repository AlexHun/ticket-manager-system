import { useCallback, useState } from "react";

export const ROW_DENSITY = {
  comfortable: "comfortable",
  compact: "compact",
} as const;

export type RowDensity = (typeof ROW_DENSITY)[keyof typeof ROW_DENSITY];

/**
 * Not a URL param, deliberately. Everything else about the ticket list lives in
 * the query string because it describes *which tickets* — and a shared link
 * should carry that. Density describes the person looking, and putting it in the
 * URL would mean handing a colleague your eyesight along with your filters.
 */
const STORAGE_KEY = "ticket:row-density";

/**
 * `localStorage` throws rather than returning null when storage is disabled —
 * Safari's private mode and a blocked-cookies setting both do it, and it throws
 * on *read* as well as write. An unreadable preference is not an error worth
 * showing anyone; it just means the default.
 */
function readStored(): RowDensity {
  try {
    return localStorage.getItem(STORAGE_KEY) === ROW_DENSITY.compact
      ? ROW_DENSITY.compact
      : ROW_DENSITY.comfortable;
  } catch {
    return ROW_DENSITY.comfortable;
  }
}

/**
 * How tightly the ticket list packs its rows, remembered across sessions.
 *
 * Comfortable is the default because it is the one that shows every field: an
 * agent who has never heard of this setting should not be looking at the
 * abbreviated version of the queue.
 */
export function useRowDensity(): [RowDensity, (next: RowDensity) => void] {
  // Lazy initialiser, so storage is read once on mount rather than on every
  // render of a page that re-renders on every keystroke in the search box.
  const [density, setDensity] = useState<RowDensity>(readStored);

  const update = useCallback((next: RowDensity) => {
    setDensity(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference lost at the end of the session, which is strictly better
      // than a toggle that refuses to move.
    }
  }, []);

  return [density, update];
}
