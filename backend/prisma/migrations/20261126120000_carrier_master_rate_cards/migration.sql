-- Carrier master, rate cards, and the budget moving from the lane to the booking.

-- 1. Budget per trip is entered at booking. Existing trips keep the budget their lane had,
--    so quote comparisons and reports for past trips do not change. Lane.budget is retired
--    (no longer read or written) but kept, so no stored value is lost.
ALTER TABLE "Trip" ADD COLUMN "budget" DECIMAL(12,2);
UPDATE "Trip" t SET "budget" = l."budget" FROM "Lane" l WHERE t."laneId" = l."id" AND l."budget" IS NOT NULL;

-- 2. Carrier master: a shipper's own record of each carrier it works with.
CREATE TABLE "ShipperCarrier" (
    "shipperId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "address" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipperCarrier_pkey" PRIMARY KEY ("shipperId","carrierId")
);
CREATE INDEX "ShipperCarrier_carrierId_idx" ON "ShipperCarrier"("carrierId");
ALTER TABLE "ShipperCarrier" ADD CONSTRAINT "ShipperCarrier_shipperId_fkey" FOREIGN KEY ("shipperId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipperCarrier" ADD CONSTRAINT "ShipperCarrier_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every carrier a shipper already uses (approved on a lane, or asked to quote) joins its carrier master.
INSERT INTO "ShipperCarrier" ("shipperId", "carrierId", "updatedAt")
SELECT DISTINCT l."shipperId", lc."carrierId", CURRENT_TIMESTAMP
FROM "LaneCarrier" lc JOIN "Lane" l ON l."id" = lc."laneId"
UNION
SELECT DISTINCT t."shipperId", q."carrierId", CURRENT_TIMESTAMP
FROM "Quote" q JOIN "Trip" t ON t."id" = q."tripId"
ON CONFLICT DO NOTHING;

-- 3. Rate cards. The old RateCard table was never used by the app (no rows), so it is rebuilt:
--    one card per shipper and carrier, with one line per city pair and truck type.
DROP TABLE "RateCard";
CREATE TABLE "RateCard" (
    "id" TEXT NOT NULL,
    "shipperId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "validFrom" DATE,
    "validTo" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RateCard_shipperId_carrierId_key" ON "RateCard"("shipperId", "carrierId");
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_shipperId_fkey" FOREIGN KEY ("shipperId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RateCardLine" (
    "id" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "truckType" TEXT NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "detentionPerDay" DECIMAL(12,2),
    "transitDays" INTEGER,

    CONSTRAINT "RateCardLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RateCardLine_rateCardId_origin_destination_truckType_key" ON "RateCardLine"("rateCardId", "origin", "destination", "truckType");
ALTER TABLE "RateCardLine" ADD CONSTRAINT "RateCardLine_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
