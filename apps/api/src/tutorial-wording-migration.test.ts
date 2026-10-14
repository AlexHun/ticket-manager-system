import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TUTORIAL_PAGE_KEYS,
  type TutorialPageKey,
  type TutorialStep,
} from "@ticket/shared";
import { execSql, prisma, Prisma, resetDb } from "./test/pg";
import {
  TUTORIAL_STARTER_CONTENT,
  type TutorialStarterPage,
} from "./tutorial-starter-content";

/**
 * #489: the tutorials' starter copy was reworded to the copy standard, and a
 * deployment seeded before that keeps the old text — the seed skips any page
 * that already has a row. The migration rewrites each reworded field only
 * where it still holds the old seeded text, so an admin's own edit survives.
 *
 * Every migration has already run against an empty database by the time this
 * file loads, so the file is replayed here against rows seeded with the old
 * copy (`execSql`).
 */
const MIGRATION = readFileSync(
  join(
    import.meta.dir,
    "..",
    "prisma",
    "migrations",
    "20261014120000_tutorial_wording",
    "migration.sql",
  ),
  "utf8",
);

type Reworded = {
  pageKey: TutorialPageKey;
  /** A step's index in the starter copy, or absent for the page title. */
  step?: number;
  field: "title" | "body";
  old: string;
};

/** The text each reworded field held in the starter copy before #489. */
const REWORDED: Reworded[] = [
  {
    pageKey: "tickets",
    step: 0,
    field: "body",
    old: "Search, status, category and assignee — combine them, or use the Mine/Unassigned shortcuts for your own queue.",
  },
  {
    pageKey: "ticketDetail",
    step: 1,
    field: "body",
    old: "Generate a fresh read of the ticket and its thread — sentiment, key points, and a suggested next step. Every click re-reads the conversation, so regenerate after a new reply comes in.",
  },
  {
    pageKey: "ticketDetail",
    step: 2,
    field: "title",
    old: "The conversation",
  },
  {
    pageKey: "pipeline",
    step: 2,
    field: "body",
    old: "Send a test email through the pipeline and watch it move through the rail in real time.",
  },
  {
    pageKey: "users",
    step: 1,
    field: "body",
    old: "Invite a new admin or agent — they'll get an email to set their password.",
  },
  {
    pageKey: "outbox",
    field: "title",
    old: "Every email the desk sent",
  },
];

type Content = TutorialStarterPage;

function starter(pageKey: TutorialPageKey): Content {
  return structuredClone(TUTORIAL_STARTER_CONTENT[pageKey]);
}

/** A page's copy as a deployment seeded before #489 holds it. */
function seededBefore(pageKey: TutorialPageKey): Content {
  const content = starter(pageKey);
  for (const r of REWORDED.filter((r) => r.pageKey === pageKey)) {
    if (r.step === undefined) {
      content.title = r.old;
    } else {
      content.steps[r.step]![r.field] = r.old;
    }
  }
  return content;
}

async function seed(pageKey: TutorialPageKey, content: Content) {
  await prisma.tutorialContent.create({
    data: {
      pageKey,
      title: content.title,
      // `TutorialStep` is an interface, which carries no index signature, so
      // it is not assignable to Prisma's JSON input type as it stands.
      steps: content.steps as unknown as Prisma.InputJsonValue,
      updatedByName: "Seed script",
    },
  });
}

async function stored(pageKey: TutorialPageKey): Promise<Content> {
  const row = await prisma.tutorialContent.findUniqueOrThrow({
    where: { pageKey },
    select: { title: true, steps: true },
  });
  return { title: row.title, steps: row.steps as unknown as TutorialStep[] };
}

beforeEach(async () => {
  await resetDb();
});

describe("the #489 tutorial wording migration", () => {
  test("the starter copy no longer holds any of the old wording", () => {
    const text = JSON.stringify(TUTORIAL_STARTER_CONTENT);
    for (const r of REWORDED) {
      expect(text).not.toContain(JSON.stringify(r.old));
    }
  });

  test("rewrites an unedited deployment to exactly the starter copy", async () => {
    for (const pageKey of TUTORIAL_PAGE_KEYS) {
      await seed(pageKey, seededBefore(pageKey));
    }

    await execSql(MIGRATION);

    for (const pageKey of TUTORIAL_PAGE_KEYS) {
      expect(await stored(pageKey)).toEqual(starter(pageKey));
    }
  });

  test("leaves a step an admin edited alone, and rewrites the rest of the page", async () => {
    const before = seededBefore("ticketDetail");
    before.steps[1]!.body = "Our own words about the summary.";
    await seed("ticketDetail", before);

    await execSql(MIGRATION);

    const after = await stored("ticketDetail");
    expect(after.steps[1]!.body).toBe("Our own words about the summary.");
    expect(after.steps[2]!.title).toBe(starter("ticketDetail").steps[2]!.title);
  });

  test("finds an old step by its text, not by where the seed put it", async () => {
    const before = seededBefore("pipeline");
    before.steps.unshift({ title: "Added by an admin", body: "First, this." });
    await seed("pipeline", before);

    await execSql(MIGRATION);

    const after = await stored("pipeline");
    expect(after.steps[0]).toEqual({
      title: "Added by an admin",
      body: "First, this.",
    });
    expect(after.steps.slice(1)).toEqual(starter("pipeline").steps);
  });

  test("leaves a page title an admin edited alone", async () => {
    const before = seededBefore("outbox");
    before.title = "Sent and unsent mail";
    await seed("outbox", before);

    await execSql(MIGRATION);

    expect((await stored("outbox")).title).toBe("Sent and unsent mail");
  });

  test("running it twice changes nothing the first run did not", async () => {
    for (const pageKey of TUTORIAL_PAGE_KEYS) {
      await seed(pageKey, seededBefore(pageKey));
    }

    await execSql(MIGRATION);
    await execSql(MIGRATION);

    for (const pageKey of TUTORIAL_PAGE_KEYS) {
      expect(await stored(pageKey)).toEqual(starter(pageKey));
    }
  });
});
