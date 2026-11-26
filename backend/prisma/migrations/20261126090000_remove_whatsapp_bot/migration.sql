-- WhatsApp bot removed: its message log, the per-user channel choice and the intake agent's setting.
DROP TABLE "MessageLog";

ALTER TABLE "User" DROP COLUMN "channel";

UPDATE "ShipperPolicy" SET "autonomy" = "autonomy" - 'intake' WHERE "autonomy" ? 'intake';
