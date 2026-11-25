-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "quotesClosedAt" TIMESTAMP(3),
ALTER COLUMN "number" SET DEFAULT 'TR-' || nextval('trip_number_seq');

