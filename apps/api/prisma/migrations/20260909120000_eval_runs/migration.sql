-- CreateEnum
CREATE TYPE "EvalCorpus" AS ENUM ('frozen', 'live');

-- CreateEnum
CREATE TYPE "EvalRunStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "eval_run" (
    "id" SERIAL NOT NULL,
    "corpus" "EvalCorpus" NOT NULL,
    "status" "EvalRunStatus" NOT NULL DEFAULT 'running',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "eval_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_case_result" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseName" TEXT NOT NULL,
    "adversarial" BOOLEAN NOT NULL,
    "expectedOutcome" TEXT NOT NULL,
    "expectedDecline" TEXT,
    "actualOutcome" TEXT NOT NULL,
    "actualDecline" TEXT,
    "matched" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_case_result_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eval_run_startedAt_idx" ON "eval_run"("startedAt");

-- CreateIndex
CREATE INDEX "eval_case_result_runId_idx" ON "eval_case_result"("runId");

-- AddForeignKey
ALTER TABLE "eval_case_result" ADD CONSTRAINT "eval_case_result_runId_fkey" FOREIGN KEY ("runId") REFERENCES "eval_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
