-- Carrier phase 2: fleet (trucks, drivers), rate cards and carrier profile.

-- AlterTable

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "address" TEXT,
ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNo" TEXT,
ADD COLUMN     "bankIfsc" TEXT,
ADD COLUMN     "gstOption" TEXT,
ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "tdsDeclared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tdsDeclaredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "licenceClass" TEXT,
ADD COLUMN     "pendingUpiById" TEXT,
ADD COLUMN     "pendingUpiId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "upiId" TEXT,
ADD COLUMN     "upiVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RateCard" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "destination" TEXT NOT NULL,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "origin" TEXT NOT NULL,
ADD COLUMN     "tripCost" DECIMAL(12,2),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "validFrom" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "validTo" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "laneId" DROP NOT NULL;

-- AlterTable

-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "capacityKg" DECIMAL(12,2),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "make" TEXT,
ADD COLUMN     "ownerName" TEXT,
ADD COLUMN     "ownerPhone" TEXT,
ADD COLUMN     "ownership" TEXT NOT NULL DEFAULT 'OWN',
ADD COLUMN     "pucExpiry" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "usualDriverId" TEXT;

-- CreateIndex
CREATE INDEX "Driver_carrierId_idx" ON "Driver"("carrierId");

-- CreateIndex
CREATE INDEX "RateCard_carrierId_idx" ON "RateCard"("carrierId");

-- CreateIndex
CREATE INDEX "Truck_carrierId_idx" ON "Truck"("carrierId");

