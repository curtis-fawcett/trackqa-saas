-- CreateTable
CREATE TABLE "TicketActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    CONSTRAINT "TicketActivity_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TicketActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TicketActivity_ticketId_idx" ON "TicketActivity"("ticketId");

-- CreateIndex
CREATE INDEX "TicketActivity_actorId_idx" ON "TicketActivity"("actorId");

-- CreateIndex
CREATE INDEX "TicketActivity_createdAt_idx" ON "TicketActivity"("createdAt");
