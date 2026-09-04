# API tests run against a real Postgres, in process

The API suite's test seam moves from the Prisma **client** to the **database**.
Instead of replacing `../db` with an object of hand-written `mock()`s, a test
file replaces it with a real `PrismaClient` bound to
[PGLite](https://pglite.dev) — Postgres compiled to WebAssembly, running inside
the `bun test` process. `apps/api/src/test/pg.ts` owns the whole arrangement:
it replays the repo's own migrations, exports the client, and exports
`resetDb()` for a `beforeEach`.

This reverses the sentence in [testing.md](../standards/testing.md) that said
the database is mocked. That sentence was worth reopening because the standard
itself recorded the cost of it: `mock.module`'s registry is one process wide and
nothing resets it between files, so two files that mock the same specifier are
not independent. The measured consequence is in the standard —
[run 33737874918](https://github.com/AlexHun/ticket-manager-system/actions/runs/33737874918),
210 pass / 2 errors, then 237 pass on a re-run of the same commit — along with
the two workarounds it forces: every `../db` factory must re-export a `Prisma`
namespace it does not use, and `automation.ts` and `routes/automation.ts` had to
be merged into one test file because the registry cannot hold two bindings for
one specifier.

Answered from a working spike ([#152](https://github.com/AlexHun/ticket-manager-system/issues/152)),
not from documentation. `apps/api/src/routes/tickets.test.ts` is converted end
to end and green; everything below was measured on this machine (Windows,
Bun 1.3.13, Prisma 7.9.1) against this repo's 28 migrations.

## Considered Options

**Keep mocking the Prisma client.** Free and fast — the suite runs in ~4s with
no prerequisites. Rejected because the fakes are not a cheaper version of the
database, they are a *different* database, and the difference is where the bugs
live. `routes/tickets.test.ts` before this change re-implemented the conditional
`updateMany` behind "mark the assignment seen" in the test file, so the test
named "no-ops on a ticket already seen" was checking a matcher written twelve
lines above it rather than the route's `where` clause. Its `findMany` fake
returned `{ id, subject }` no matter what the route selected, so an `include`
that leaked the customer's address onto `GET /unread` would have passed. Neither
gap is fixable by writing better fakes; they are what a fake *is*. The claim in
`jobs/auto-reply-ticket.ts` — `New → Processing` in one conditional
`updateMany`, the thing that stops two agents replying to one customer — has no
faithful expression in a mock at all.

**PGLite via the community `pglite-prisma-adapter`** — chosen, see below.

**A real Postgres server for the unit suite**, the way the E2E job already runs
one as a CI service container. Measurably better on every axis except the one
that matters most. Against a local Postgres on the same schema and the same
queries, through the first-party `@prisma/adapter-pg` the app already depends
on:

| | PGLite (in process) | local Postgres |
| --- | --- | --- |
| schema ready | 3.4s (cached) / ~10s cold | 1.4s |
| `SELECT 1` | 4.0ms | 1.5ms |
| `findUnique` | 9.2ms | 3.1ms |
| `findMany`, 50 rows + relation | 15.4ms | 5.3ms |
| conditional `updateMany` | 6.9ms | 3.0ms |
| interactive `$transaction` | 6.6ms | 3.8ms |
| `resetDb()` | 22ms | 40ms |

Rejected anyway, on the dev loop. `bun run --filter @ticket/api test` currently
needs *nothing* — no key, no server, no container — and that is a property
worth about as much as the three-fold latency. Requiring a running Postgres
turns a fresh clone's first test run into a setup task, makes the suite fail
offline, and puts a service container in the one CI job that does not have one.
The gap is ~3ms a query on a suite of a few hundred queries; the setup cost is
paid by every developer on every machine, forever. Kept as the documented
fallback: because everything above `src/test/pg.ts` talks to Prisma and nothing
else, swapping PGLite for `@prisma/adapter-pg` is a change to one module.

**PGLite behind `@electric-sql/pglite-socket`**, so `prisma migrate deploy` and
the Prisma CLI could reach it over the wire protocol. Rejected as a second
moving part bought for one convenience: replaying `migration.sql` in name order
is exactly what `migrate deploy` applies, minus `_prisma_migrations` bookkeeping
nothing in a test reads.

## Consequences

**There is no first-party PGLite adapter.** `@prisma/adapter-pglite` does not
exist on npm; `pglite-prisma-adapter@0.7.2` is one maintainer's MIT package
(`lucasthevenet/pglite-utils`, last published 2026-01-17) declaring
`@prisma/client >= 7.1.0`. It works against 7.9.1 — verified, not assumed:
`where`, `select`, `orderBy`, nested `create`, interactive `$transaction`
rollback, `Prisma.sql` raw queries, and a `P2002` on a unique violation all
behave. This is the single largest risk in the decision and the reason the
previous paragraph names its exit.

**The suite gets slower, by roughly an order of magnitude.** Measured, three
runs each: 4.07s before, 10.0s with one file converted. Of that, ~3.4s is a
fixed cost paid once per run and ~150ms is the marginal cost of a converted
route test (a light test that resets, writes one row and reads it back costs
~40ms). The eleven files still to convert hold 175 tests, which projects the
finished suite at **30–40s**. That is the price, stated plainly; it buys a
suite that cannot go red on Tuesday and green on Wednesday for the same commit.

**The schema is replayed, and the result is cached.** `src/test/pg.ts` reads
every `prisma/migrations/*/migration.sql` in name order and `exec`s it. That
costs ~10s, so the finished data directory is dumped to
`node_modules/.cache/pglite/schema-<hash>.tar` (39.7MB, gitignored via
`node_modules`) keyed by a hash of the SQL — later runs restore it in ~1.5s and
a new migration invalidates it automatically. Gzip was measured and rejected:
4.6MB instead of 39.7MB, but ~300ms slower to restore, and the file is never
committed or transferred. CI has no cache for it today and will pay the ~10s
bake per run until one is added; that is a follow-up, not a blocker.

**One database for the whole run, reset per test.** `bun test` loads every file
into a single process — the same property that makes the mock registry
process-wide — so a per-file instance would pay the boot cost per file and buy
nothing `resetDb()` does not already give. `resetDb()` is `DELETE FROM` every
table plus `ALTER SEQUENCE ... RESTART`, built once from `pg_tables` and
`pg_sequences` so a new model is covered without anyone remembering to add it.
Not `TRUNCATE ... RESTART IDENTITY`, which does the same job at 155ms against
41ms — on tables holding a handful of rows, TRUNCATE's per-table file work is
all cost. Restarting the sequences is what lets a test write ticket 1 and then
read `/1`.

**`mock.module` does not go away, but it stops being a hazard for `../db`.**
A converted file still binds the specifier — it binds it to the one shared real
client, which is what every other converted file wants too, so two of them
sharing a binding is a no-op rather than a stranger's stub. The `Prisma`
re-export rule survives for the same reason it exists (`Prisma.sql` is a value
import in three modules) and `src/test/pg.ts` re-exports it so a factory reads
`{ Prisma, prisma }`. The end state, verified in the spike, is a
`bun test --preload` that registers the binding once before any test file
loads, at which point no test file mocks `../db` at all; it is deliberately
left to the last migration ticket rather than done first, because it only pays
off once every file is converted.

**A mis-registered mock is silent and dangerous.** Registering the binding
under a path that does not match — `new URL("../src/db.ts", import.meta.url).pathname`
yields `/C:/…` on Windows — does not error. The routes link the *real* `../db`,
which connects to whatever `DATABASE_URL` names, and on a developer's machine
that is the dev database. Demonstrated during the spike; nothing was written,
because the requests failed before their writes landed, but that was luck.
Any preload must therefore overwrite `DATABASE_URL` with an unreachable
sentinel before registering anything, so a fallthrough fails loudly instead of
quietly finding a real server.

**Migrations are now executed by the unit suite.** A migration whose SQL
Postgres will not accept fails `bun test`, not just the E2E job. All 28 of this
repo's apply to PGLite unmodified — none use extensions, `CONCURRENTLY`,
materialised views or anything else PGLite does not carry. A future migration
that needs one of those would need this ADR revisited.

**Converting a file finds real defects.** The converted
`routes/tickets.test.ts` gained assertions that were not previously expressible
— that `GET /unread` returns exactly `{ id, subject }`, that the audit-trail
row commits with the update in one transaction, that `ASSIGNABLE_USER` really
refuses a soft-deleted colleague — and the first run of it failed on an audit
`action` value the old fake had never had to produce.
