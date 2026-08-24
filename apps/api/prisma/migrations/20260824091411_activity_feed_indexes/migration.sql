-- CreateIndex
CREATE INDEX "message_direction_createdAt_idx" ON "message"("direction", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_activity_createdAt_idx" ON "ticket_activity"("createdAt");
