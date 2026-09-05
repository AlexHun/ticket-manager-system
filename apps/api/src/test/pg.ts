/**
 * An in-process Postgres for `bun test`, spiked for #152.
 *
 * The API suite's test seam is the Prisma *client*: eleven files replace `../db`
 * with an object of `mock()`s, so what the tests exercise is a hand-written
 * re-implementation of whichever slice of Prisma the route happened to call.
 * This module offers the other seam — a real Prisma client on a real Postgres
 * (PGLite, compiled to WASM and run inside this process), so `where`, `select`,
 * `orderBy`, transactions, unique constraints and a conditional `updateMany`
 * all mean what Postgres means by them.
 *
 * ## Shape
 *
 * One database for the whole `bun test` process, not one per file. `bun test`
 * loads every test file into a single process — the same property that makes
 * `mock.module`'s registry process-wide — so a per-file instance would pay the
 * boot cost once per file for no isolation the per-test reset does not already
 * give. `resetDb()` in a `beforeEach` is what keeps files independent.
 *
 * ## Schema
 *
 * The migrations are replayed, not `prisma migrate deploy`-ed: PGLite speaks no
 * wire protocol, so the CLI cannot reach it. `migration.sql` in name order is
 * exactly what `migrate deploy` would apply, minus the `_prisma_migrations`
 * bookkeeping that nothing here reads.
 *
 * That replay costs ~10s, so the result is cached as a data-directory dump
 * keyed by a hash of the migration SQL — first run bakes it, later runs restore
 * it in ~1.5s, and adding a migration invalidates it automatically. The cache
 * lives under `node_modules/.cache`, already gitignored, and is safe to delete.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "../generated/prisma/client";

// Re-exported so a test file's `mock.module("../db", …)` factory can hand the
// module under test the same `Prisma` namespace the real `../db` exports — it
// is a *value* export (`Prisma.sql`), see `docs/standards/testing.md`.
export { Prisma } from "../generated/prisma/client";

const MIGRATIONS = join(import.meta.dir, "..", "..", "prisma", "migrations");
const CACHE_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "node_modules",
  ".cache",
  "pglite",
);

function migrationSql(): string[] {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) =>
      readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"),
    );
}

async function openDatabase(): Promise<PGlite> {
  const sql = migrationSql();
  const key = createHash("sha256").update(sql.join("\n")).digest("hex").slice(0, 16);
  const cached = join(CACHE_DIR, `schema-${key}.tar`);

  if (existsSync(cached)) {
    return PGlite.create({ loadDataDir: new Blob([readFileSync(cached)]) });
  }

  const db = new PGlite();
  await db.waitReady;
  for (const statement of sql) {
    await db.exec(statement);
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const dump = await db.dumpDataDir("none");
  writeFileSync(cached, Buffer.from(await dump.arrayBuffer()));

  return db;
}

const db = await openDatabase();

export const prisma = new PrismaClient({
  adapter: new PrismaPGlite(db),
  log: ["error"],
});

/**
 * `DELETE FROM` every table and restart every sequence, in one round trip.
 *
 * Not `TRUNCATE ... RESTART IDENTITY`, which does the same job: measured on
 * this schema, TRUNCATE costs ~155ms a call and this costs ~41ms. On tables
 * holding a handful of test rows, TRUNCATE's per-table file work and locking
 * is all cost and no benefit.
 *
 * The sequences are restarted rather than left running because tests read far
 * better asserting on ticket 1 than on whatever number the previous file
 * happened to leave behind.
 *
 * Built once, from the live catalogue, so a new model in the schema is covered
 * without anyone remembering to add it here — and in whatever order the
 * catalogue lists them, which is where `session_replication_role` comes in.
 *
 * **The deletes run with referential triggers off.** `pg_tables` has no idea
 * which table points at which, so this list is in no particular order, and one
 * foreign key in this schema cares: `KnowledgeArticleRevision.article` is
 * `onDelete: Restrict` (ADR-0006, which is what makes an article undeletable
 * through the ORM). Delete the articles before their revisions and Postgres
 * refuses the statement — so a single test that leaves a revision behind
 * poisons `resetDb` for every file that runs after it, and the failures land
 * anywhere but the test that caused them. Setting the role to `replica` for the
 * duration is the standard way to say "this is a wipe, not an edit". Sorting the
 * tables topologically would work too, and would have to be re-derived every
 * time somebody added a relation.
 *
 * Two things to be exact about, because "restored immediately" would be doing a
 * lot of unexamined work. The flag is off for the **deletes only** — the
 * `origin` statement is inside the same `db.exec` batch, before the sequence
 * resets — so no test ever runs against a database with its constraints
 * disabled. But `session_replication_role` suppresses *every* referential and
 * user trigger, not only the `Restrict` that motivated it; that is the price of
 * not maintaining a topological order by hand, and it is why this is scoped to
 * the wipe and nothing else. And the restore is a statement rather than a
 * `finally`: `db.exec` runs the batch in one implicit transaction, so a failed
 * `DELETE` rolls the `SET` back with everything else rather than leaking it into
 * the next test. A `resetDb` that throws is a broken suite either way — what
 * matters is that it cannot leave the session quietly permissive.
 */
const RESET_SQL = await (async () => {
  const tables = (
    await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    )
  ).rows.map((row) => `DELETE FROM "${row.tablename}"`);
  const sequences = (
    await db.query<{ sequencename: string }>(
      `SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'`,
    )
  ).rows.map((row) => `ALTER SEQUENCE "${row.sequencename}" RESTART WITH 1`);
  return [
    `SET session_replication_role = 'replica'`,
    ...tables,
    `SET session_replication_role = 'origin'`,
    ...sequences,
  ].join("; ");
})();

export async function resetDb(): Promise<void> {
  await db.exec(RESET_SQL);
}
