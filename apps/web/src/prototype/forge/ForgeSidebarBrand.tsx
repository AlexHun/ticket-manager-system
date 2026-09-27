/**
 * PROTOTYPE — the brand at the top of the sidebar, after sign-in: the login
 * lockup (THE GREAT / FORGE / DESK) at sidebar scale, with no mark beside it.
 * The hallmark stays as the favicon, where a word cannot go.
 *
 * Deliberately not a SidebarMenuButton: the rail forces those to `size-8!`, so
 * a lockup inside one would jump from its own height to 32px on every
 * collapse. This header row holds one height in both states instead; collapsed,
 * the lockup gives way to a single "F" in the same face and finish.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useForge } from "./forge-proto";

export function PrototypeSidebarBrand({ fallback }: { fallback: ReactNode }) {
  const { logo } = useForge();
  if (logo === "current") return fallback;
  return (
    <Link to="/" className="fw-brand" aria-label="The Great Forge Desk">
      <span className="fw-lockup" aria-hidden="true">
        <span className="fw-line">
          <span>The Great</span>
          <i className="fw-rule" />
        </span>
        <span className="fw-word">Forge</span>
        <span className="fw-line fw-end">
          <i className="fw-rule" />
          <span>Desk</span>
        </span>
      </span>
      <span className="fw-mono" aria-hidden="true">
        F
      </span>
    </Link>
  );
}
