-- AlterTable
ALTER TABLE "Claim" ALTER COLUMN "number" SET DEFAULT 'CL-' || nextval('claim_number_seq');

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ALTER COLUMN "number" SET DEFAULT 'TR-' || nextval('trip_number_seq');

-- CreateTable
CREATE TABLE "TripException" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "proposal" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "decidedById" TEXT,
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripException_tripId_idx" ON "TripException"("tripId");

-- AddForeignKey
ALTER TABLE "TripException" ADD CONSTRAINT "TripException_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

