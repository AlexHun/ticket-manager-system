-- The demo sessions' daily AI budget (#321, PRD R8): one row per UTC day,
-- holding the estimated spend of every demo polish and summarise that day.
-- Keyed by the day, so the total rolls over at 00:00 UTC with nothing to reset.

-- CreateTable
CREATE TABLE "demo_ai_spend" (
    "day" DATE NOT NULL,
    "usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demo_ai_spend_pkey" PRIMARY KEY ("day")
);
