-- Carrier phase 6: each carrier numbers its own invoices (PREFIX/FY/0001).
CREATE TABLE "CarrierInvoiceSeries" (
    "companyId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CarrierInvoiceSeries_pkey" PRIMARY KEY ("companyId")
);
ALTER TABLE "CarrierInvoiceSeries" ADD CONSTRAINT "CarrierInvoiceSeries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
