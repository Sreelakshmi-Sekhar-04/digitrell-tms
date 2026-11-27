import { prisma } from '../../lib/prisma';

export const DOC_KEYS = ['rcExpiry', 'insuranceExpiry', 'permitExpiry', 'fitnessExpiry', 'pucExpiry'] as const;
export type DocKey = (typeof DOC_KEYS)[number];

/**
 * AI READER HOOK (not built yet). When the reader exists, set extractStatus to PENDING here, enqueue the
 * job, and have it write the expiry date it finds to extractedJson and set DONE or FAILED. The carrier
 * keeps typing the date meanwhile. Today this does nothing but record NONE. No external calls.
 */
export async function queueExtraction(fileUploadId: string) {
  await prisma.fileUpload.update({ where: { id: fileUploadId }, data: { extractStatus: 'NONE' } });
}

/** Latest live file per doc key for the given trucks: Map<truckId, Map<docKey, file>>. */
export async function liveTruckFiles(truckIds: string[]) {
  const rows = truckIds.length
    ? await prisma.fileUpload.findMany({ where: { ownerType: 'TRUCK', ownerId: { in: truckIds }, replacedAt: null }, orderBy: { createdAt: 'asc' } })
    : [];
  const out = new Map<string, Map<string, { fileName: string; uploadedAt: string }>>();
  for (const r of rows) {
    if (!out.has(r.ownerId)) out.set(r.ownerId, new Map());
    out.get(r.ownerId)!.set(r.docKey, { fileName: r.fileName, uploadedAt: r.createdAt.toISOString() });
  }
  return out;
}
