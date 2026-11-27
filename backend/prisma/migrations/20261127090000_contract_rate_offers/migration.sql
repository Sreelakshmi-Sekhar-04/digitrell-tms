-- Contract-rate offers: carriers are offered the load one at a time at their contract rate.
ALTER TABLE "Quote" ADD COLUMN "sequence" INTEGER,
ADD COLUMN "offeredAt" TIMESTAMP(3),
ADD COLUMN "respondBy" TIMESTAMP(3),
ADD COLUMN "rateCardLineId" TEXT,
ADD COLUMN "respondedById" TEXT,
ADD COLUMN "declineReason" TEXT;

-- At most one winning quote per trip.
CREATE UNIQUE INDEX quote_one_winner ON "Quote"("tripId") WHERE "isWinner";

-- Bring trips still open under the old quote flow into the offer flow, so carriers can accept them.
-- Old typed quotes (QUOTED) go back to open offers; old open trips waiting on a shipper award go back to offering.
UPDATE "Approval" SET "status" = 'REJECTED'
WHERE "status" = 'PENDING' AND "kind" IN ('AWARD', 'QUOTE');

UPDATE "Trip" SET "status" = 'QUOTES_REQUESTED', "quotesClosedAt" = NULL
WHERE "status" = 'QUOTES_RECEIVED' AND "carrierId" IS NULL AND "cancelledAt" IS NULL;

UPDATE "Quote" q SET
  "status"    = 'REQUESTED',
  "offeredAt" = COALESCE(q."offeredAt", q."createdAt"),
  "respondBy" = COALESCE(q."respondBy", t."quoteDeadline"),
  "sequence"  = COALESCE(q."sequence", 1)
FROM "Trip" t
WHERE q."tripId" = t."id"
  AND q."status" IN ('REQUESTED', 'QUOTED')
  AND t."status" = 'QUOTES_REQUESTED' AND t."carrierId" IS NULL AND t."cancelledAt" IS NULL;

-- Price those offers from the shipper's contract line for the lane and truck type.
UPDATE "Quote" q SET "amount" = l."rate", "rateCardLineId" = l."id"
FROM "Trip" t
JOIN "Address" pa ON pa."id" = t."pickupAddressId"
JOIN "Address" da ON da."id" = t."dropAddressId"
JOIN "RateCard" rc ON rc."shipperId" = t."shipperId"
JOIN "RateCardLine" l ON l."rateCardId" = rc."id"
  AND lower(l."origin") = lower(pa."city") AND lower(l."destination") = lower(da."city") AND l."truckType" = t."truckType"
WHERE q."tripId" = t."id" AND rc."carrierId" = q."carrierId"
  AND q."status" = 'REQUESTED' AND q."rateCardLineId" IS NULL
  AND t."status" = 'QUOTES_REQUESTED' AND t."carrierId" IS NULL;
