-- AlterTable
ALTER TABLE "Claim" ALTER COLUMN "number" SET DEFAULT 'CL-' || nextval('claim_number_seq');

-- AlterTable
ALTER TABLE "Trip" ALTER COLUMN "number" SET DEFAULT 'TR-' || nextval('trip_number_seq');
