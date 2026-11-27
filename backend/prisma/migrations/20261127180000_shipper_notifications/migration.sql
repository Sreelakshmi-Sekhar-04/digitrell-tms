-- Shipper in-app notifications; carrier acceptance now awards directly (no shipper approval).
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "tripId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");
CREATE INDEX "Notification_companyId_createdAt_idx" ON "Notification"("companyId", "createdAt");

-- Open AWARD approvals on offer trips are void: the carrier's acceptance awards directly.
UPDATE "Approval" SET "status" = 'REJECTED', "reason" = 'Carrier acceptance now awards directly', "decidedAt" = NOW()
WHERE "kind" = 'AWARD' AND "status" = 'PENDING'
  AND "tripId" IN (SELECT "id" FROM "Trip" WHERE "carrierId" IS NULL AND "status" IN ('QUOTES_REQUESTED', 'QUOTES_RECEIVED'));

-- A carrier acceptance that was waiting for approval (trip not yet awarded) is awarded now.
UPDATE "Trip" t SET "status" = 'AWARDED', "carrierId" = q."carrierId", "awardedAmount" = q."amount", "awardedAt" = NOW(), "quotesClosedAt" = NOW()
FROM "Quote" q
WHERE q."tripId" = t."id" AND q."status" = 'ACCEPTED' AND t."carrierId" IS NULL AND t."cancelledAt" IS NULL;
UPDATE "Quote" SET "status" = 'AWARDED', "isWinner" = true
WHERE "status" = 'ACCEPTED' AND "tripId" IN (SELECT "id" FROM "Trip" WHERE "carrierId" = "Quote"."carrierId" AND "status" = 'AWARDED');
UPDATE "Quote" SET "status" = 'WITHDRAWN'
WHERE "status" IN ('QUEUED', 'REQUESTED') AND "tripId" IN (SELECT "id" FROM "Trip" WHERE "status" = 'AWARDED');
