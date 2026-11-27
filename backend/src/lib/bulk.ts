import express, { Router, type Request, type Response } from 'express';
import ExcelJS from 'exceljs';
import { HttpError, asyncHandler, badRequest } from './errors';
import { audit } from './audit';
import { requireRole } from '../middleware/auth';
import type { AuthUser } from '../middleware/auth';

/**
 * Bulk upload, shared by every creation screen (carriers, rate cards, lanes, addresses, bookings).
 *
 * Each screen describes its spreadsheet in a `BulkSpec`: the columns, how to check every row (by
 * calling the same validation and rules as the single-record form), and how to save one checked
 * row. This file does the rest, identically for all of them:
 *
 *   GET  …/bulk/template?format=xlsx|csv   blank template (xlsx adds an Instructions and a Lists sheet)
 *   POST …/bulk/check                      the uploaded file (raw body) → every row with its status and errors
 *   POST …/bulk/import                     the same file → rows checked again, valid ones saved one by one
 *   POST …/bulk/report?format=xlsx|csv     JSON { rows } from check or import → the rows with their problems
 *
 * The server keeps no upload state: import re-reads and re-checks the file, so it always works on
 * current data, and rows already saved by an earlier upload come back as duplicates, not copies.
 */

export interface BulkColumn {
  /** Field name, the same as the single-record API body, so the form's Validator messages apply. */
  key: string;
  /** Column heading in the spreadsheet. */
  header: string;
  required?: boolean;
  /** Shown in the Instructions sheet. */
  example: string;
  help: string;
  /** Fixed choices: an Excel drop-down in the template. */
  options?: readonly string[];
}

/** NEW and UPDATE rows are imported; DUPLICATE rows change nothing; INVALID rows need fixing. */
export type RowStatus = 'NEW' | 'UPDATE' | 'DUPLICATE' | 'INVALID';

export interface Checked<D = unknown> {
  status: RowStatus;
  /** Problems by column key (as Validator fields). Non-empty means INVALID. */
  errors: Record<string, string>;
  /** What will happen, e.g. "Adds 2 carriers to the existing lane". */
  note?: string;
  /** The row's natural key; a second row with the same key in one file is refused. */
  key?: string;
  /** Validated data handed to `apply`. */
  data?: D;
}

export interface BulkContext {
  user: AuthUser;
}

export interface BulkSpec<D = unknown> {
  /** File names and the audit log, e.g. "carriers". */
  kind: string;
  /** Sheet name, e.g. "Carriers". */
  title: string;
  /** One row is one … (for messages), e.g. "carrier". */
  noun: string;
  columns: BulkColumn[];
  /** Only these roles may check and import (the template is open to every shipper user). */
  roles?: string[];
  /** Valid values from this shipper's master data, for the template's Lists sheet. */
  lists?: (ctx: BulkContext) => Promise<Record<string, string[]>>;
  /** Checks every row (in file order). Must not write anything. */
  check: (rows: Record<string, string>[], ctx: BulkContext) => Promise<Checked<D>[]>;
  /** Saves one row that `check` passed. Throw an HttpError to fail just this row. */
  apply: (row: Checked<D>, ctx: BulkContext) => Promise<{ ref?: string }>;
}

export const MAX_ROWS = 500;
const MAX_BYTES = 5 * 1024 * 1024;

export interface RowResult {
  /** Row number as the user sees it in the spreadsheet (heading is row 1). */
  row: number;
  values: Record<string, string>;
  status: RowStatus | 'CREATED' | 'UPDATED' | 'FAILED';
  errors: { field: string; column: string; message: string }[];
  note?: string;
  ref?: string;
}

// ---------- reading files ----------

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|\*/g, '').replace(/[^a-z0-9]/g, '');

/** Spreadsheet cell → text. Dates become YYYY-MM-DD; formulas give their result. */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'string' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    if ('error' in v) return '';
  }
  return String(v);
}

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF). Comma or semicolon, whichever the heading uses. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function readGrid(buf: Buffer): Promise<string[][]> {
  if (!buf.length) throw badRequest('The file is empty.');
  // .xlsx is a zip ("PK"); the old binary .xls starts with D0 CF 11 E0.
  if (buf[0] === 0xd0 && buf[1] === 0xcf) throw badRequest('This is an old .xls file. In Excel, use File → Save As → Excel Workbook (.xlsx), or CSV, and upload that.');
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw badRequest("This Excel file couldn't be read. Save it again as .xlsx or CSV and upload it.");
    }
    // The first sheet holds the data (the template's Instructions and Lists sheets come after it).
    const ws = wb.worksheets.find((w) => w.state !== 'hidden' && !['Instructions', 'Lists', 'Choices'].includes(w.name)) ?? wb.worksheets[0];
    if (!ws) throw badRequest('The Excel file has no sheets.');
    const grid: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (r, n) => {
      const vals = Array.isArray(r.values) ? r.values.slice(1) : [];
      grid[n - 1] = vals.map((v) => cellText(v as ExcelJS.CellValue).trim());
    });
    return Array.from(grid, (r) => r ?? []);
  }
  const text = buf.toString('utf8');
  if (text.includes('\u0000')) throw badRequest('Upload an Excel (.xlsx) or CSV file.');
  return parseCsv(text).map((r) => r.map((c) => c.trim()));
}

/** File → one object per data row, keyed by column key, with its spreadsheet row number. */
export async function readRows(buf: Buffer, columns: BulkColumn[]) {
  const grid = await readGrid(buf);
  const headerAt = grid.findIndex((r) => r.some((c) => c !== ''));
  if (headerAt < 0) throw badRequest('The file has no rows. Add the column headings from the template and one row per record.');
  const heading = grid[headerAt];
  const index = new Map<string, number>();
  heading.forEach((h, i) => {
    const col = columns.find((c) => norm(c.header) === norm(h) || norm(c.key) === norm(h));
    if (col && !index.has(col.key)) index.set(col.key, i);
  });
  const missing = columns.filter((c) => c.required && !index.has(c.key)).map((c) => c.header);
  if (missing.length) {
    throw new HttpError(400, 'BAD_TEMPLATE', `The file is missing ${missing.length > 1 ? 'these columns' : 'a column'}: ${missing.join(', ')}. Download the template and keep its headings.`);
  }
  const rows: { row: number; values: Record<string, string> }[] = [];
  for (let i = headerAt + 1; i < grid.length; i++) {
    const values: Record<string, string> = {};
    for (const c of columns) values[c.key] = index.has(c.key) ? (grid[i][index.get(c.key)!] ?? '').trim() : '';
    if (Object.values(values).every((v) => v === '')) continue; // blank line
    rows.push({ row: i + 1, values });
  }
  if (!rows.length) throw badRequest('The file has the headings but no records. Add one row per record below the headings.');
  if (rows.length > MAX_ROWS) throw badRequest(`The file has ${rows.length} records. Upload at most ${MAX_ROWS} at a time.`);
  return rows;
}

// ---------- checking ----------

/** Runs the spec's checks and refuses a second row with the same key in one file. */
async function checkFile<D>(spec: BulkSpec<D>, buf: Buffer, ctx: BulkContext) {
  const rows = await readRows(buf, spec.columns);
  const checked = await spec.check(rows.map((r) => r.values), ctx);
  const firstByKey = new Map<string, number>();
  checked.forEach((c, i) => {
    if (!c.key || c.status === 'INVALID') return;
    const k = c.key.toLowerCase();
    const first = firstByKey.get(k);
    if (first !== undefined) {
      checked[i] = { ...c, status: 'INVALID', errors: { ...c.errors, [spec.columns[0].key]: `Same ${spec.noun} as row ${first}. Keep one of them.` } };
    } else firstByKey.set(k, rows[i].row);
  });
  return rows.map((r, i) => ({ ...r, checked: checked[i] }));
}

function toResult(spec: BulkSpec, r: { row: number; values: Record<string, string> }, c: Checked, status?: RowResult['status']): RowResult {
  const header = (k: string) => spec.columns.find((col) => col.key === k)?.header ?? (k === '_row' ? 'Row' : k);
  return {
    row: r.row,
    values: r.values,
    status: status ?? (Object.keys(c.errors).length ? 'INVALID' : c.status),
    errors: Object.entries(c.errors).filter(([, m]) => m).map(([field, message]) => ({ field, column: header(field), message })),
    note: c.note,
  };
}

const countBy = (rows: RowResult[]) =>
  rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});

// ---------- files out ----------

const STATUS_TEXT: Record<RowResult['status'], string> = {
  NEW: 'Ready to add', UPDATE: 'Ready to update', DUPLICATE: 'Already exists, skipped', INVALID: 'Needs fixing',
  CREATED: 'Added', UPDATED: 'Updated', FAILED: 'Not imported',
};

function csv(rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

async function templateXlsx(spec: BulkSpec, lists: Record<string, string[]>) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DigitRell TMS';
  const ws = wb.addWorksheet(spec.title, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = spec.columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 4) }));
  // Fixed choices live on a hidden sheet: a literal Excel list can't hold a value with a comma in it.
  const optionCols = spec.columns.filter((c) => c.options?.length);
  const choices = optionCols.length ? wb.addWorksheet('Choices', { state: 'hidden' }) : null;
  optionCols.forEach((c, j) => {
    choices!.getCell(1, j + 1).value = c.header;
    c.options!.forEach((o, k) => { choices!.getCell(k + 2, j + 1).value = o; });
  });
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  spec.columns.forEach((c, i) => {
    head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? 'FF0F5C5C' : 'FF5B6B78' } };
    head.getCell(i + 1).note = `${c.required ? 'Required. ' : 'Optional. '}${c.help}`;
    if (c.options?.length) {
      // Drop-down of the allowed values on 500 data rows.
      const col = ws.getColumn(i + 1).letter;
      const src = choices!.getColumn(optionCols.indexOf(c) + 1).letter;
      const range = `Choices!$${src}$2:$${src}$${c.options.length + 1}`;
      for (let r = 2; r <= MAX_ROWS + 1; r++) {
        ws.getCell(`${col}${r}`).dataValidation = {
          type: 'list', allowBlank: !c.required, formulae: [range],
          showErrorMessage: true, errorTitle: c.header, error: `Choose one of: ${c.options.join(', ')}`,
        };
      }
    }
  });

  const info = wb.addWorksheet('Instructions');
  info.columns = [{ header: 'Column', width: 26 }, { header: 'Required', width: 10 }, { header: 'Example', width: 30 }, { header: 'What to enter', width: 80 }];
  info.getRow(1).font = { bold: true };
  for (const c of spec.columns) info.addRow([c.header, c.required ? 'Yes' : 'No', c.example, c.help + (c.options ? ` Allowed: ${c.options.join(', ')}.` : '')]);
  info.addRow([]);
  info.addRow([`Enter one ${spec.noun} per row on the "${spec.title}" sheet, below the headings. Keep the headings as they are.`]);
  info.addRow([`Up to ${MAX_ROWS} rows per file. Rows that already exist are skipped, so uploading the same file twice creates nothing new.`]);

  const listNames = Object.keys(lists);
  if (listNames.length) {
    const ls = wb.addWorksheet('Lists');
    ls.columns = listNames.map((n) => ({ header: n, width: Math.max(20, n.length + 4) }));
    ls.getRow(1).font = { bold: true };
    const longest = Math.max(...listNames.map((n) => lists[n].length));
    for (let i = 0; i < longest; i++) ls.addRow(listNames.map((n) => lists[n][i] ?? ''));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function reportXlsx(spec: BulkSpec, rows: RowResult[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(spec.title);
  ws.columns = [
    ...spec.columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 4) })),
    { header: 'Row in your file', key: '_row', width: 14 },
    { header: 'Status', key: '_status', width: 22 },
    { header: 'Problems', key: '_problems', width: 70 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow({ ...r.values, _row: r.row, _status: STATUS_TEXT[r.status], _problems: problems(r) });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const problems = (r: RowResult) => r.errors.map((e) => `${e.column}: ${e.message}`).join(' | ');

function send(res: Response, name: string, format: string, body: Buffer | string) {
  const xlsx = format !== 'csv';
  res.setHeader('Content-Type', xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.${xlsx ? 'xlsx' : 'csv'}"`);
  res.send(body);
}

// ---------- routes ----------

const rawFile = express.raw({ type: () => true, limit: MAX_BYTES });
const ctxOf = (req: Request): BulkContext => ({ user: req.user! });

/** The four bulk routes for one creation screen; mount at `<resource>/bulk`. */
export function bulkRouter<D>(spec: BulkSpec<D>) {
  const r = Router();
  const guard = spec.roles?.length ? [requireRole(...spec.roles)] : [];

  r.get(
    '/template',
    asyncHandler(async (req, res) => {
      const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
      const name = `digitrell-${spec.kind}-template`;
      if (format === 'csv') return send(res, name, 'csv', csv([spec.columns.map((c) => c.header)]));
      const lists = spec.lists ? await spec.lists(ctxOf(req)) : {};
      send(res, name, 'xlsx', await templateXlsx(spec as BulkSpec, lists));
    }),
  );

  r.post(
    '/check',
    ...guard,
    rawFile,
    asyncHandler(async (req, res) => {
      const rows = await checkFile(spec, toBuffer(req.body), ctxOf(req));
      const out = rows.map((x) => toResult(spec as BulkSpec, x, x.checked));
      res.json({ kind: spec.kind, total: out.length, counts: countBy(out), rows: out });
    }),
  );

  r.post(
    '/import',
    ...guard,
    rawFile,
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      const rows = await checkFile(spec, toBuffer(req.body), ctx);
      const out: RowResult[] = [];
      // One row at a time, each saved on its own: a row that fails doesn't undo or block the others.
      for (const x of rows) {
        const c = x.checked;
        if (c.status !== 'NEW' && c.status !== 'UPDATE') {
          out.push(toResult(spec as BulkSpec, x, c));
          continue;
        }
        try {
          const done = await spec.apply(c, ctx);
          out.push({ ...toResult(spec as BulkSpec, x, c, c.status === 'NEW' ? 'CREATED' : 'UPDATED'), ref: done.ref });
        } catch (err) {
          const message = err instanceof HttpError ? err.message : 'This row could not be saved. Try it again.';
          if (!(err instanceof HttpError)) console.error(`[bulk ${spec.kind}] row ${x.row}`, err);
          const fields = err instanceof HttpError && err.fields ? err.fields : { [spec.columns[0].key]: message };
          out.push(toResult(spec as BulkSpec, x, { ...c, errors: fields }, 'FAILED'));
        }
      }
      const counts = countBy(out);
      const summary = { created: counts.CREATED ?? 0, updated: counts.UPDATED ?? 0, skipped: counts.DUPLICATE ?? 0, failed: (counts.INVALID ?? 0) + (counts.FAILED ?? 0) };
      await audit(ctx.user.id, 'BULK_IMPORT', { kind: spec.kind, rows: out.length, ...summary });
      res.json({ kind: spec.kind, total: out.length, summary, rows: out });
    }),
  );

  r.post(
    '/report',
    express.json({ limit: '5mb' }),
    asyncHandler(async (req, res) => {
      const rows = Array.isArray(req.body?.rows) ? (req.body.rows as RowResult[]).slice(0, MAX_ROWS) : [];
      const clean = rows.map((x) => ({
        row: Number(x.row) || 0,
        values: Object.fromEntries(spec.columns.map((c) => [c.key, String(x.values?.[c.key] ?? '')])),
        status: (x.status in STATUS_TEXT ? x.status : 'INVALID') as RowResult['status'],
        errors: Array.isArray(x.errors) ? x.errors.map((e) => ({ field: String(e.field), column: String(e.column), message: String(e.message) })) : [],
      }));
      const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
      const name = `digitrell-${spec.kind}-problems`;
      if (format === 'csv') {
        return send(res, name, 'csv', csv([
          [...spec.columns.map((c) => c.header), 'Row in your file', 'Status', 'Problems'],
          ...clean.map((x) => [...spec.columns.map((c) => x.values[c.key]), x.row, STATUS_TEXT[x.status], problems(x)]),
        ]));
      }
      send(res, name, 'xlsx', await reportXlsx(spec as BulkSpec, clean));
    }),
  );
  return r;
}

function toBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body;
  throw badRequest('Upload an Excel (.xlsx) or CSV file.');
}

// ---------- helpers for specs ----------

/** Runs a single-record validator on a row; returns its field errors instead of throwing. */
export async function fieldsOf<T>(fn: () => T | Promise<T>): Promise<{ value?: T; errors: Record<string, string> }> {
  try {
    return { value: await fn(), errors: {} };
  } catch (err) {
    if (err instanceof HttpError && err.fields) return { errors: err.fields };
    if (err instanceof HttpError) return { errors: { _row: err.message } };
    throw err;
  }
}

/** Case- and space-insensitive lookup by name. */
export const byName = <T extends { name: string }>(items: T[]) => {
  const m = new Map(items.map((i) => [i.name.trim().toLowerCase().replace(/\s+/g, ' '), i]));
  return (name: string) => m.get(name.trim().toLowerCase().replace(/\s+/g, ' '));
};

/** Splits "A; B, C" lists (carrier names in one cell). */
export const splitList = (s: string) => s.split(/[;,\n]/).map((x) => x.trim()).filter(Boolean);
