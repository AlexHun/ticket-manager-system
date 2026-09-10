/**
 * Unit tests for `ticketEffectivenessHandler`'s facts scan — the raw SQL half of
 * `apps/api/src/routes/ticket-effectiveness.ts`.
 *
 * A second file rather than an extension of `ticket-effectiveness.test.ts`,
 * which says so itself: that one is about the two pure functions over plain rows
 * and deliberately imports neither `../db` nor the handler. This one is the
 * opposite half — a `COUNT(*) FILTER` against a real Postgres (`../test/pg`,
 * ADR-0014), which is the only seam that can tell a `WHERE` clause apart from an
 * assertion about the string it was written into.
 *
 * What it is here for is `decline.count` and the rate over it. Both used to read
 * `autoReplyDecline IS NOT NULL`, which folded outages in with verdicts and
 * **inflated a published number** — the one an admin reads to decide whether the
 * knowledge base needs work (`docs/adr/0019`). The aggregate now counts
 * `DECLINE_OUTCOME`'s nine verdicts and the per-reason breakdown beside it still
 * counts all ten, because a reason is what the column honestly holds; a test
 * that only watched the first would let the second quietly follow it.
 *
 * The router is stood up around the bare handler rather than importing
 * `./tickets`, which mounts it behind `requireAuth`: the guard is not what is
 * under test, and reaching for it would pull `../auth` and the
 * `../middleware/auth` stub every other route test owns a copy of.
 */

import { Router } from "express";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  TICKET_CATEGORY,
  TICKET_STATUS,
  type AssistantEffectivenessResponse,
  type AutoReplyDecline,
} from "@ticket/shared";
import { resetDb } from "../test/pg";
import { seedTicket } from "../test/fixtures";
import { serveRouter } from "../test/route-app";

const { ticketEffectivenessHandler } = await import("./ticket-effectiveness");

const router = Router();
router.get("/effectiveness", ticketEffectivenessHandler);
const url = serveRouter("/api/tickets", router);

beforeEach(async () => {
  await resetDb();
});

/**
 * A classified ticket the auto-reply handed back with one reason.
 *
 * **`createdAt` is pinned an hour back, and that is not decoration.** The
 * handler slices on `createdAt < to`, where `to` is a JS `Date` — millisecond
 * precision — while the column is stamped by Postgres `now()`, which keeps
 * microseconds. A row seeded in the *same millisecond* the request is served in
 * therefore sorts *after* `to` and drops out of the slice: measured on CI, where
 * a two-ticket test seeded and read inside one millisecond and the newer ticket
 * came back missing from the per-reason breakdown while the older one did not.
 * Every row this file asserts on has to be unambiguously inside the window, so
 * none of them may be `now`.
 */
const SEEDED_AT = new Date(Date.now() - 60 * 60 * 1000);

function seedDeclined(decline: AutoReplyDecline) {
  return seedTicket({
    status: TICKET_STATUS.Open,
    category: TICKET_CATEGORY.Technical,
    createdAt: SEEDED_AT,
    classifiedAt: SEEDED_AT,
    autoReplyDecline: decline,
    autoReplyDeclinedAt: SEEDED_AT,
  });
}

async function read(): Promise<AssistantEffectivenessResponse> {
  const res = await fetch(url("/effectiveness"));
  expect(res.status).toBe(200);
  return (await res.json()) as AssistantEffectivenessResponse;
}

describe("GET /api/tickets/effectiveness — the decline aggregate", () => {
  test("counts the verdicts and leaves the outage out", async () => {
    await seedDeclined(AUTO_REPLY_DECLINE.notCovered);
    await seedDeclined(AUTO_REPLY_DECLINE.unbackedReference);
    await seedDeclined(AUTO_REPLY_DECLINE.unavailable);

    const body = await read();

    expect(body.classified).toBe(3);
    expect(body.decline.count).toBe(2);
    // The published rate, and the whole point of the change: three classified
    // tickets, two of which the knowledge base was actually consulted about.
    expect(body.decline.rate).toBeCloseTo(2 / 3);
  });

  test("an outage on its own is not a decline at any rate", async () => {
    await seedDeclined(AUTO_REPLY_DECLINE.unavailable);

    const body = await read();

    expect(body.decline.count).toBe(0);
    expect(body.decline.rate).toBe(0);
  });

  test("the per-reason breakdown still reports it under its own key", async () => {
    await seedDeclined(AUTO_REPLY_DECLINE.unavailable);
    await seedDeclined(AUTO_REPLY_DECLINE.notCovered);

    const body = await read();

    // Unchanged, deliberately: this breaks the column down by reason, and every
    // reason including the zeroes is information — same as on `/pipeline`.
    expect(body.decline.reasons[AUTO_REPLY_DECLINE.unavailable]).toBe(1);
    expect(body.decline.reasons[AUTO_REPLY_DECLINE.notCovered]).toBe(1);
    expect(body.decline.reasons[AUTO_REPLY_DECLINE.tooLong]).toBe(0);
  });

  test("every verdict reason counts, not just the one the model reached", async () => {
    // Nine of the ten are verdicts, and the filter is built from
    // `DECLINE_OUTCOME` rather than written out — so a gate reason and an output
    // check both belong in this number.
    await seedDeclined(AUTO_REPLY_DECLINE.category);
    await seedDeclined(AUTO_REPLY_DECLINE.answered);
    await seedDeclined(AUTO_REPLY_DECLINE.noText);
    await seedDeclined(AUTO_REPLY_DECLINE.followUp);
    await seedDeclined(AUTO_REPLY_DECLINE.notCovered);
    await seedDeclined(AUTO_REPLY_DECLINE.noCitation);
    await seedDeclined(AUTO_REPLY_DECLINE.unbackedCommitment);
    await seedDeclined(AUTO_REPLY_DECLINE.unbackedReference);
    await seedDeclined(AUTO_REPLY_DECLINE.tooLong);
    await seedDeclined(AUTO_REPLY_DECLINE.unavailable);

    const body = await read();

    expect(body.decline.count).toBe(9);
    expect(body.classified).toBe(10);
  });

  test("nothing classified is a null rate, not a zero", async () => {
    const body = await read();

    expect(body.decline.count).toBe(0);
    expect(body.decline.rate).toBeNull();
  });
});
