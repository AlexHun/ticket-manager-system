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
 * without anyone remembering to add it here.
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
  return [...tables, ...sequences].join("; ");
})();

export async function resetDb(): Promise<void> {
  await db.exec(RESET_SQL);
}
