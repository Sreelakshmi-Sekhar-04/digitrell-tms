-- Carrier phase 4: truck and driver assignment, LR issue and void/reissue.
ALTER TABLE "Document" ADD COLUMN "issuedById" TEXT,
ADD COLUMN "voidReason" TEXT,
ADD COLUMN "voidedById" TEXT,
ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "replacedById" TEXT;

ALTER TABLE "Trip" ADD COLUMN "pickupEta" TIMESTAMP(3);
