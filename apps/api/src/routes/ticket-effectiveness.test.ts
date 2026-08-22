/**
 * Unit tests for `countCategoryOverrides` in `./ticket-effectiveness-override`
 * — the one piece of the effectiveness endpoint expressible as a pure function
 * over seeded `TicketActivity` rows rather than a raw SQL string, and so the
 * one piece a `bun test` file (no database, per `docs/standards/testing.md`)
 * can actually exercise. `ticketEffectivenessHandler` calls this over exactly
 * the rows `prisma.ticketActivity.findMany` would return for `category_changed`
 * activity in the slice — see the comment on the function for why "assistant
 * row + agent row on the same ticket" is the whole rule.
 *
 * Deliberately does not import `./ticket-effectiveness` itself, which pulls in
 * `../db`: that specifier is process-wide `mock.module`d by `automation.test.ts`
 * and `outbound.test.ts` without spreading the real module, so importing
 * anything that reaches `../db` here would bind to whichever of those stubs
 * `bun test` happened to load first — see the "registry is one process wide"
 * note in `docs/standards/testing.md`.
 */

import { describe, expect, test } from "bun:test";
import { TICKET_ACTOR_KIND } from "@ticket/shared";
import { countCategoryOverrides } from "./ticket-effectiveness-override";

describe("countCategoryOverrides", () => {
  test("classifier filed it, an agent later changed it: counted", () => {
    const rows = [
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.assistant },
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent },
    ];
    expect(countCategoryOverrides(rows)).toBe(1);
  });

  test("classifier filed it, nobody touched it since: not counted", () => {
    const rows = [{ ticketId: 1, actorKind: TICKET_ACTOR_KIND.assistant }];
    expect(countCategoryOverrides(rows)).toBe(0);
  });

  test("an agent filed it directly — the classifier never set a category: not counted", () => {
    // No assistant-authored row exists for this ticket, so there is nothing on
    // record for the agent to have overridden.
    const rows = [{ ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent }];
    expect(countCategoryOverrides(rows)).toBe(0);
  });

  test("an agent changed it twice after the classifier: counted once, not twice", () => {
    const rows = [
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.assistant },
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent },
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent },
    ];
    expect(countCategoryOverrides(rows)).toBe(1);
  });

  test("mixed tickets: only the ones with both an assistant and an agent row count", () => {
    const rows = [
      // Ticket 1: overridden.
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.assistant },
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent },
      // Ticket 2: classifier only.
      { ticketId: 2, actorKind: TICKET_ACTOR_KIND.assistant },
      // Ticket 3: agent only — the classifier never reached it.
      { ticketId: 3, actorKind: TICKET_ACTOR_KIND.agent },
      // Ticket 4: overridden too.
      { ticketId: 4, actorKind: TICKET_ACTOR_KIND.assistant },
      { ticketId: 4, actorKind: TICKET_ACTOR_KIND.agent },
    ];
    expect(countCategoryOverrides(rows)).toBe(2);
  });

  test("no rows: zero", () => {
    expect(countCategoryOverrides([])).toBe(0);
  });
});
