-- First ETA at loading, for on-time reporting
ALTER TABLE "Trip" ADD COLUMN "promisedEta" TIMESTAMP(3);

-- Message preferences
ALTER TABLE "User" ADD COLUMN "notifyPrefs" JSONB,
ADD COLUMN "quietHours" TEXT;
