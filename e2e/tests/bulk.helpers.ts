import ExcelJS from 'exceljs';

/** Column headings exactly as the templates give them. */
export const HEAD = {
  carriers: ['Carrier name', "Owner's mobile", 'Contact person', 'Contact mobile', 'Email', 'City', 'Office address', 'GSTIN', 'PAN', 'Notes'],
  rateCards: ['Carrier', 'Pickup city', 'Drop city', 'Truck type', 'Freight per trip (₹)', 'Detention per day (₹)', 'Transit days', 'Valid from', 'Valid till'],
  lanes: ['Pickup city', 'Drop city', 'Truck type', 'Award rule', 'Approved carriers'],
  addresses: ['Short name', 'City', 'Street address', 'Type', 'Contact name', 'Contact mobile', 'Working hours'],
  bookings: ['Your reference', 'Pickup address', 'Drop address', 'Pickup date', 'Truck type', 'Material', 'Weight (tonnes)', 'Budget per trip (₹)', 'Receiver contact', 'Notes for carrier', 'Quote window (hours)'],
};

export type Cell = string | number | null | undefined;

export async function xlsxFile(headers: string[], rows: Cell[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r.map((c) => (c == null ? null : c)));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function csvFile(headers: string[], rows: Cell[][]): Buffer {
  const esc = (v: Cell) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return Buffer.from([headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n', 'utf8');
}

/** A unique valid Indian mobile. */
let seq = Math.floor(Math.random() * 1e6);
export const mobile = () => `9${String(Date.now() % 1e5).padStart(5, '0')}${String(seq++ % 1e4).padStart(4, '0')}`;

/** Reads every sheet of an xlsx buffer as arrays of text rows. */
export async function readXlsx(buf: Buffer | Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets: Record<string, string[][]> = {};
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => rows.push((r.values as unknown[]).slice(1).map((v) => (v == null ? '' : String(v)))));
    sheets[ws.name] = rows;
  });
  return { wb, sheets };
}

export interface RowRes { row: number; values: Record<string, string>; status: string; errors: { field: string; column: string; message: string }[]; note?: string; ref?: string }
