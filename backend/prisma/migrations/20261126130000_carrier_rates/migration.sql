-- Carrier desk rates get their own table. "RateCard" now belongs to the shipper's master data
-- (rebuilt by 20261126120000_carrier_master_rate_cards), so the carrier's per-lane prices,
-- quote bands and trip cost live in "CarrierRate".

-- CreateTable
CREATE TABLE "CarrierRate" (
    "id" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "shipperId" TEXT,
    "laneId" TEXT,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "truckType" TEXT NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "bandPct" DECIMAL(5,2) NOT NULL,
    "tripCost" DECIMAL(12,2),
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarrierRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarrierRate_carrierId_idx" ON "CarrierRate"("carrierId");
