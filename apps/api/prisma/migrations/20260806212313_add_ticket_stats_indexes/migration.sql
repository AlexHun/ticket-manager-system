-- CreateIndex
CREATE INDEX "message_ticketId_direction_createdAt_idx" ON "message"("ticketId", "direction", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_createdAt_idx" ON "ticket"("createdAt");

-- CreateIndex
CREATE INDEX "ticket_status_createdAt_idx" ON "ticket"("status", "createdAt");
