import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Lets the "?" button in `AppTopBar` reopen whichever page's `<Tutorial>` is
 * currently mounted, even though the two live in separate subtrees —
 * `AppTopBar` is a sibling of the routed `<Outlet>`, not an ancestor of it.
 *
 * `Tutorial` registers a reopen callback on mount (only once it has content
 * to show — see the call site) and clears it on unmount, so `reopen` here is
 * `null` on any page without a tutorial and briefly `null` during a route
 * change, both of which the button treats as "nothing to show".
 *
 * Registering the callback itself, rather than a boolean plus a pageKey,
 * avoids re-deriving `Tutorial`'s open/step state on this end — the button
 * only ever needs to trigger it, never read it.
 */
interface TutorialTriggerContextValue {
  reopen: (() => void) | null;
  register: (fn: () => void) => void;
  unregister: () => void;
}

const TutorialTriggerContext =
  createContext<TutorialTriggerContextValue | null>(null);

export function TutorialTriggerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [reopen, setReopen] = useState<(() => void) | null>(null);

  const register = useCallback((fn: () => void) => {
    setReopen(() => fn);
  }, []);
  const unregister = useCallback(() => {
    setReopen(null);
  }, []);

  const value = useMemo(
    () => ({ reopen, register, unregister }),
    [reopen, register, unregister],
  );

  return (
    <TutorialTriggerContext.Provider value={value}>
      {children}
    </TutorialTriggerContext.Provider>
  );
}

/**
 * `null` outside a `TutorialTriggerProvider` (component tests render
 * `<Tutorial>` standalone) rather than throwing, so registration is a no-op
 * there instead of a required test-setup change.
 */
export function useTutorialTrigger() {
  return useContext(TutorialTriggerContext);
}
