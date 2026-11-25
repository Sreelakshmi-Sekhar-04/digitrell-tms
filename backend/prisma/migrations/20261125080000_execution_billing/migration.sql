-- Claim numbers CL-0001, CL-0002, ... (never reused)
CREATE SEQUENCE IF NOT EXISTS "claim_number_seq" START 1;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "validUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "damagedQty" INTEGER,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryRemarks" TEXT,
ADD COLUMN     "driverName" TEXT,
ADD COLUMN     "driverPhone" TEXT,
ADD COLUMN     "eta" TIMESTAMP(3),
ADD COLUMN     "goodQty" INTEGER,
ADD COLUMN     "lastLocation" TEXT,
ADD COLUMN     "lastUpdateAt" TIMESTAMP(3),
ADD COLUMN     "podAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "podAcceptedById" TEXT,
ADD COLUMN     "podHardCopyAt" TIMESTAMP(3),
ADD COLUMN     "truckNumber" TEXT,
ALTER COLUMN "number" SET DEFAULT 'TR-' || nextval('trip_number_seq');

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT 'CL-' || nextval('claim_number_seq'),
    "tripId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitValue" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RAISED',
    "carrierNote" TEXT,
    "raisedById" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "freight" DECIMAL(12,2) NOT NULL,
    "detention" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "claimDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "queryReason" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentMode" TEXT,
    "paymentRef" TEXT,
    "postedToErp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Claim_number_key" ON "Claim"("number");

-- CreateIndex
CREATE INDEX "Invoice_tripId_idx" ON "Invoice"("tripId");

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

