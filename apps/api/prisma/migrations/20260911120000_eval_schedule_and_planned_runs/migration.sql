-- The nightly's time stops being a constant, and a run can be asked for ahead
-- of time (#236).
--
-- Two tables and they are different things on purpose. `eval_schedule` is the
-- standing arrangement — one row, frozen corpus, paused or not — and
-- `eval_planned_run` is one run somebody asked for at one future moment, which
-- is *not* an `EvalRun` in a waiting state (`docs/adr/0021`): it has measured
-- nothing, and the runs list means measurements that happened.
--
-- **The schedule row is seeded here, with the time in force today.** The whole
-- point of the change is that an admin owns the time rather than a deploy; an
-- empty table would mean the deploy that handed it over also silently stopped
-- the nightly until somebody noticed. 03:47 is what `jobs/eval-nightly.ts` was
-- hard-coded to, and both halves of it were argued there: nightly rather than
-- hourly because a full set costs real money, and a minute nobody else uses
-- because a run holds a worker for minutes.

-- CreateEnum
CREATE TYPE "EvalPlannedRunStatus" AS ENUM ('planned', 'cancelled', 'fired', 'missed');

-- CreateTable
CREATE TABLE "eval_schedule" (
    "id" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "updatedByName" TEXT,

    CONSTRAINT "eval_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_planned_run" (
    "id" SERIAL NOT NULL,
    "corpus" "EvalCorpus" NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" "EvalPlannedRunStatus" NOT NULL DEFAULT 'planned',
    "jobId" TEXT,
    "runId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plannedById" TEXT,
    "plannedByName" TEXT,

    CONSTRAINT "eval_planned_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eval_planned_run_status_runAt_idx" ON "eval_planned_run"("status", "runAt");

-- AddForeignKey
ALTER TABLE "eval_schedule" ADD CONSTRAINT "eval_schedule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_planned_run" ADD CONSTRAINT "eval_planned_run_runId_fkey" FOREIGN KEY ("runId") REFERENCES "eval_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_planned_run" ADD CONSTRAINT "eval_planned_run_plannedById_fkey" FOREIGN KEY ("plannedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the one row, at the time the sweep already fired at. `updatedByName`
-- stays null: nobody changed this, and the panel says so rather than naming
-- whoever ran the migration.
INSERT INTO "eval_schedule" ("id", "hour", "minute", "paused", "updatedAt")
VALUES (1, 3, 47, false, now())
ON CONFLICT ("id") DO NOTHING;
