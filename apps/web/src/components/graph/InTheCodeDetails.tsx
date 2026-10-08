import { Link } from "react-router-dom";
import { navItemsFor, NAV_ITEMS } from "@/components/layout/nav-items";
import { useSession } from "@/lib/auth-client";
import type { InTheCode } from "@/lib/how-it-works/code";
import {
  GRAPH_CODE_ATTRIBUTE,
  GRAPH_SCREEN_ATTRIBUTE,
  HOW_IT_WORKS_LABEL,
} from "@/lib/how-it-works/dom";
import { viewerOf } from "@/lib/viewer";

/**
 * The half of the panel that leads into the code (R4): the repo paths behind
 * the selection, and the app screen it can be seen on.
 *
 * The screen is named after its nav item and linked only when the sidebar
 * would link it for this viewer — the same `navItemsFor` question — so an agent
 * reading about Classification sees "Pipeline" as a name rather than a link
 * to the not-found page. That is UX; the route's own gate is the control.
 */
export function InTheCodeDetails({ code, screen }: InTheCode) {
  const { data: session } = useSession();
  const item = screen && NAV_ITEMS.find((candidate) => candidate.to === screen);
  const opens =
    item !== undefined &&
    navItemsFor(viewerOf(session?.user)).some(
      (candidate) => candidate.to === item.to,
    );

  return (
    <>
      <h3 className="mt-4 text-sm font-medium">
        {HOW_IT_WORKS_LABEL.inTheCode}
      </h3>
      <ul
        {...{ [GRAPH_CODE_ATTRIBUTE]: "" }}
        className="mt-1 space-y-0.5 text-xs text-muted-foreground"
      >
        {code.map((path) => (
          <li key={path}>
            <code className="font-mono break-all">{path}</code>
          </li>
        ))}
      </ul>
      {item && (
        <p
          {...{ [GRAPH_SCREEN_ATTRIBUTE]: item.to }}
          className="mt-3 text-sm text-muted-foreground"
        >
          {HOW_IT_WORKS_LABEL.screen}:{" "}
          {opens ? (
            <Link
              to={item.to}
              className="text-link underline-offset-4 hover:underline"
            >
              {item.label}
            </Link>
          ) : (
            <span>{item.label} (admins only)</span>
          )}
        </p>
      )}
    </>
  );
}

/** The paths as one sentence, for the hidden lists a screen reader reads. */
export function CodeLine({ code }: Pick<InTheCode, "code">) {
  return (
    <p>
      {HOW_IT_WORKS_LABEL.inTheCode}: {code.join(", ")}
    </p>
  );
}
