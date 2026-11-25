-- Trip numbers TR-24101, TR-24102, ... (never reused)
CREATE SEQUENCE IF NOT EXISTS "trip_number_seq" START 24101;

-- AlterTable
ALTER TABLE "Approval" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "quotedAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'REQUESTED',
ALTER COLUMN "amount" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "awardedAmount" DECIMAL(12,2),
ADD COLUMN     "awardedAt" TIMESTAMP(3),
ADD COLUMN     "awardedById" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "dropAddressId" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "number" TEXT NOT NULL DEFAULT 'TR-' || nextval('trip_number_seq'),
ADD COLUMN     "pickupAddressId" TEXT,
ADD COLUMN     "quoteDeadline" TIMESTAMP(3),
ADD COLUMN     "receiverContact" TEXT,
ADD COLUMN     "reference" TEXT;

-- CreateTable
CREATE TABLE "CarrierPerformance" (
    "carrierId" TEXT NOT NULL,
    "trips" INTEGER NOT NULL DEFAULT 0,
    "onTimePct" INTEGER NOT NULL,
    "podDays" DECIMAL(4,1) NOT NULL,
    "acceptPct" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierPerformance_pkey" PRIMARY KEY ("carrierId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_tripId_carrierId_key" ON "Quote"("tripId", "carrierId");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_number_key" ON "Trip"("number");

-- CreateIndex
CREATE INDEX "Trip_shipperId_status_idx" ON "Trip"("shipperId", "status");

-- CreateIndex
CREATE INDEX "Trip_shipperId_createdAt_idx" ON "Trip"("shipperId", "createdAt");

-- AddForeignKey
ALTER TABLE "CarrierPerformance" ADD CONSTRAINT "CarrierPerformance_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_shipperId_fkey" FOREIGN KEY ("shipperId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "Lane"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_pickupAddressId_fkey" FOREIGN KEY ("pickupAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_dropAddressId_fkey" FOREIGN KEY ("dropAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

