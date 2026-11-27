-- Driver licence classes move to goods-vehicle classes: LGV, MGV, HGV, EHV.
UPDATE "Driver" SET "licenceClass" = 'LGV' WHERE "licenceClass" = 'LMV';
UPDATE "Driver" SET "licenceClass" = 'HGV' WHERE "licenceClass" IN ('HMV', 'HGMV');
UPDATE "Driver" SET "licenceClass" = 'EHV' WHERE "licenceClass" = 'HTV';
