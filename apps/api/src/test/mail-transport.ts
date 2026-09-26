/**
 * One `../mail/transport` stub, shared by every test file that needs a mail
 * provider bound (#325).
 *
 * No deployment binds one yet, so the paths that only run once one is — the
 * worker handing a row to `deliver`, and the outbox retry, which refuses
 * outright without a provider — are unreachable through the real module. This
 * stands a provider in: `bound` makes `isMailConfigured()` true, and `deliver`
 * then records what it was handed and answers `accepted`.
 *
 * A module in `src/test/` rather than a factory per file, for the reason
 * `./send-email` gives: it holds **state**, and two copies of a stateful stub
 * are two boxes of which the process-wide registry keeps one, leaving the other
 * file's switch inert. And it **defaults to the real answer** — unbound, both
 * exports delegate to the genuine module — because every file that loads after
 * this one links against it too (testing-api.md).
 *
 * **Reset it in every file that installs it**: set `bound` and clear
 * `delivered` in the same `beforeEach` that calls `resetDb()`, and put
 * `bound = false` back in an `afterEach`, so a file loaded after one that
 * binds a provider never inherits it.
 */
import { mock } from "bun:test";
import type { OutgoingEmail } from "../mail/transport";

export const mailTransportStub = {
  bound: false,
  /** Every email `deliver` was handed while bound, in order. */
  delivered: [] as OutgoingEmail[],
};

let installed = false;

/** Register the stub, at module scope and before the module under test is
 *  imported. Idempotent: the second caller gets the first caller's box. */
export async function stubMailTransport(): Promise<void> {
  if (installed) return;
  installed = true;

  // Spread now, before the mock is registered, or the delegations below would
  // resolve to the wrappers themselves (testing-api.md, "snapshot into a plain
  // object").
  const actual = { ...(await import("../mail/transport")) };

  mock.module("../mail/transport", () => ({
    ...actual,
    isMailConfigured: () =>
      mailTransportStub.bound || actual.isMailConfigured(),
    deliver: async (email: OutgoingEmail) => {
      if (!mailTransportStub.bound) return actual.deliver(email);
      mailTransportStub.delivered.push(email);
      return {
        outcome: actual.MAIL_OUTCOME.accepted,
        providerMessageId: `stub-${mailTransportStub.delivered.length}`,
      };
    },
  }));
}
