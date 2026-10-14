import {
  AUTO_REPLY_DECLINE,
  TICKET_ACTIVITY_ACTION,
  TICKET_ACTOR_KIND,
  type TicketActivity,
} from "@ticket/shared";
import { ACTIVITY_PHRASING } from "./activity-labels";

function declined(toValue: string | null): TicketActivity {
  return {
    id: 1,
    action: TICKET_ACTIVITY_ACTION.auto_declined,
    actorKind: TICKET_ACTOR_KIND.assistant,
    actorName: "Assistant",
    fromValue: null,
    toValue,
    createdAt: "2026-10-09T09:00:00Z",
  };
}

describe("auto_declined phrasing", () => {
  const phrase = ACTIVITY_PHRASING[TICKET_ACTIVITY_ACTION.auto_declined];

  test("says it was left for a person, with the reason lower case mid-sentence", () => {
    expect(phrase(declined(AUTO_REPLY_DECLINE.notCovered))).toBe(
      "left this for a person — not covered by the knowledge base",
    );
  });

  test("reads without a reason when the stored one is unknown", () => {
    expect(phrase(declined("renamed_since"))).toBe("left this for a person");
  });
});
