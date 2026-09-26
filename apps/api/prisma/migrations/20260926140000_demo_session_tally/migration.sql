-- The admin's weekly demo figures (#327, PRD R14): one row per demo session,
-- when it started and whether it opened a ticket. `userId` names the demo
-- identity without a foreign key, so the row outlives the nightly reset that
-- deletes the identity.

-- CreateTable
CREATE TABLE "demo_session_tally" (
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedTicket" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "demo_session_tally_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "demo_session_tally_startedAt_idx" ON "demo_session_tally"("startedAt");
