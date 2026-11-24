-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Lane" ADD COLUMN     "awardRule" TEXT NOT NULL DEFAULT 'ASK',
ADD COLUMN     "budget" DECIMAL(12,2),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "approvalLimit" DECIMAL(12,2),
ADD COLUMN     "inviteExpiresAt" TIMESTAMP(3),
ADD COLUMN     "inviteToken" TEXT;

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "hours" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaneCarrier" (
    "laneId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaneCarrier_pkey" PRIMARY KEY ("laneId","carrierId")
);

-- CreateTable
CREATE TABLE "ShipperPolicy" (
    "companyId" TEXT NOT NULL,
    "paymentApprovalAbove" DECIMAL(12,2) NOT NULL DEFAULT 50000,
    "quoteWindowHours" INTEGER NOT NULL DEFAULT 2,
    "podRule" TEXT NOT NULL DEFAULT 'DIGITAL',
    "autonomy" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipperPolicy_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Address_companyId_name_key" ON "Address"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Lane_shipperId_origin_destination_truckType_key" ON "Lane"("shipperId", "origin", "destination", "truckType");

-- CreateIndex
CREATE UNIQUE INDEX "User_inviteToken_key" ON "User"("inviteToken");

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaneCarrier" ADD CONSTRAINT "LaneCarrier_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "Lane"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaneCarrier" ADD CONSTRAINT "LaneCarrier_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipperPolicy" ADD CONSTRAINT "ShipperPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lane" ADD CONSTRAINT "Lane_shipperId_fkey" FOREIGN KEY ("shipperId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

