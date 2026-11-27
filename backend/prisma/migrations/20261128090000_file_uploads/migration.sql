-- Carrier phase 7: photos/PDFs of truck papers, with room for a later AI reader.
CREATE TABLE "FileUpload" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "docKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractStatus" TEXT NOT NULL DEFAULT 'NONE',
    "extractedJson" JSONB,
    "replacedAt" TIMESTAMP(3),
    CONSTRAINT "FileUpload_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FileUpload_ownerType_ownerId_docKey_idx" ON "FileUpload"("ownerType", "ownerId", "docKey");
CREATE INDEX "FileUpload_companyId_idx" ON "FileUpload"("companyId");
