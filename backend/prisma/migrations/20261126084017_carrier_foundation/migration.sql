-- Carrier phase 1: several roles per carrier user, and one policy row per carrier company.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "roles" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CarrierPolicy" (
    "companyId" TEXT NOT NULL,
    "bandPct" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "marginFloorPct" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "invoiceApprovalAbove" DECIMAL(12,2) NOT NULL DEFAULT 25000,
    "backupApproverId" TEXT,
    "autonomy" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierPolicy_pkey" PRIMARY KEY ("companyId")
);

-- AddForeignKey
ALTER TABLE "CarrierPolicy" ADD CONSTRAINT "CarrierPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
