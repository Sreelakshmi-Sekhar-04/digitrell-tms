'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { ApiError, download, downloadPost, upload } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Drawer } from '@/components/ui/Drawer';
import { DataTable, td } from '@/components/masters/Table';

type Status = 'NEW' | 'UPDATE' | 'DUPLICATE' | 'INVALID' | 'CREATED' | 'UPDATED' | 'FAILED';
export interface BulkRow {
  row: number;
  values: Record<string, string>;
  status: Status;
  errors: { field: string; column: string; message: string }[];
  note?: string;
  ref?: string;
}
export interface CheckResult {
  kind: string;
  total: number;
  counts: Partial<Record<'NEW' | 'UPDATE' | 'DUPLICATE' | 'INVALID', number>>;
  rows: BulkRow[];
}
export interface ImportResult {
  kind: string;
  total: number;
  summary: { created: number; updated: number; skipped: number; failed: number };
  rows: BulkRow[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** API base, e.g. '/carriers/bulk'. */
  base: string;
  title: string;
  /** Singular, e.g. 'carrier'. */
  noun: string;
  /** 2-3 column keys to show in the preview. */
  columns: string[];
  onImported: (result: ImportResult) => void;
  doneAction?: ReactNode;
}

const STATUS_UI: Record<Status, { label: string; tone: 'success' | 'progress' | 'neutral' | 'danger' }> = {
  NEW: { label: 'Ready to add', tone: 'success' },
  UPDATE: { label: 'Ready to update', tone: 'progress' },
  DUPLICATE: { label: 'Already exists, skipped', tone: 'neutral' },
  INVALID: { label: 'Needs fixing', tone: 'danger' },
  CREATED: { label: 'Added', tone: 'success' },
  UPDATED: { label: 'Updated', tone: 'progress' },
  FAILED: { label: 'Not imported', tone: 'danger' },
};
const heading = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const bad = (r: BulkRow) => r.status === 'INVALID' || r.status === 'FAILED';
const nouns = (noun: string) => (noun.endsWith('s') ? `${noun}es` : `${noun}s`);
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

function RowsTable({ rows, columns }: { rows: BulkRow[]; columns: string[] }) {
  return (
    <DataTable label="Rows in your file" headers={['Row', ...columns.map(heading), 'Status', 'Problems']}>
      {rows.map((r) => (
        <tr key={r.row}>
          <td className={`${td} tabular text-ink-muted`}>{r.row}</td>
          {columns.map((c) => <td key={c} className={td}>{r.values[c] || <span className="text-ink-muted">-</span>}</td>)}
          <td className={td}><Chip tone={STATUS_UI[r.status].tone}>{STATUS_UI[r.status].label}</Chip></td>
          <td className={`${td} min-w-[220px] text-[13px]`}>
            {r.errors.length
              ? r.errors.map((e, i) => <div key={i} className="text-tone-danger">{e.column}: {e.message}</div>)
              : <span className="text-ink-muted">{r.note ?? ''}</span>}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}

/** One drawer for the whole bulk upload: choose file, check, preview, import, summary. */
export function BulkUpload({ open, onClose, base, title, noun, columns, onImported, doneAction }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | 'report' | null>(null);
  const [onlyBad, setOnlyBad] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) return;
    setFile(null); setCheck(null); setResult(null); setError(null); setBusy(null); setOnlyBad(false);
  }, [open]);

  const fail = (err: unknown) => setError(err instanceof ApiError ? err.body.message : 'Something went wrong. Please try again.');

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setBusy('check');
    try {
      const res = await upload<CheckResult>(`${base}/check`, f);
      setFile(f);
      setCheck(res);
      setOnlyBad(false);
    } catch (err) {
      fail(err); // keep the picker (and any earlier preview)
    } finally {
      setBusy(null);
    }
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // so choosing the same corrected file again still fires
    void choose(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void choose(e.dataTransfer.files?.[0]);
  };

  const run = async (kind: 'report' | 'import', fn: () => Promise<void>) => {
    setError(null);
    setBusy(kind);
    try { await fn(); } catch (err) { fail(err); } finally { setBusy(null); }
  };

  const importRows = () => run('import', async () => {
    if (!file) return;
    const res = await upload<ImportResult>(`${base}/import`, file);
    setResult(res);
    onImported(res);
  });
  const report = (rows: BulkRow[]) => run('report', () => downloadPost(`${base}/report?format=xlsx`, { rows }, `digitrell-${noun}-problems.xlsx`));
  const template = async (format: 'xlsx' | 'csv') => {
    setError(null);
    try { await download(`${base}/template?format=${format}`, `digitrell-${noun}-template.${format}`); } catch (err) { fail(err); }
  };
  const again = () => { setFile(null); setCheck(null); setResult(null); setError(null); setOnlyBad(false); };

  const ready = (check?.counts.NEW ?? 0) + (check?.counts.UPDATE ?? 0);
  const invalid = check?.rows.filter(bad) ?? [];
  const stage: 'pick' | 'preview' | 'done' = result ? 'done' : check ? 'preview' : 'pick';
  const busyAny = busy !== null;

  let footer: ReactNode = null;
  if (stage === 'preview') {
    footer = (
      <>
        <Button onClick={importRows} loading={busy === 'import'} disabled={ready === 0 || busyAny}>Import {plural(ready, 'row')}</Button>
        {invalid.length > 0 && <Button variant="secondary" onClick={() => report(invalid)} loading={busy === 'report'} disabled={busyAny}>Download problems</Button>}
        <Button variant="secondary" onClick={() => input.current?.click()} loading={busy === 'check'} disabled={busyAny}>Choose a corrected file</Button>
      </>
    );
  } else if (stage === 'done' && result) {
    const notImported = result.rows.filter(bad);
    footer = (
      <>
        <Button onClick={onClose}>Done</Button>
        {doneAction}
        {notImported.length > 0 && <Button variant="secondary" onClick={() => report(notImported)} loading={busy === 'report'} disabled={busyAny}>Download rows not imported</Button>}
        <Button variant="secondary" onClick={again}>Upload another file</Button>
      </>
    );
  }

  const shown = check ? (onlyBad ? invalid : check.rows) : [];

  return (
    <Drawer open={open} onClose={onClose} title={title} wide dirty={busy === 'import'} footer={footer}>
      <input
        ref={input}
        id="bulk-file"
        type="file"
        accept=".xlsx,.csv"
        onChange={onPick}
        className="sr-only"
        tabIndex={stage === 'pick' ? 0 : -1}
        aria-label={stage === 'pick' ? undefined : 'Choose a file'}
      />

      {error && <div role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm text-[#7A1616]"><strong>{error}</strong></div>}

      {stage === 'pick' && (
        <>
          <div className="text-sm text-ink-soft">
            <p>Add many {nouns(noun)} at once from a spreadsheet. Download the template, fill in one {noun} per row, then choose the file. We check it first and save nothing until you say so.</p>
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold">Download template:</span>
              <button type="button" onClick={() => template('xlsx')} className="font-semibold text-brand underline">Excel</button>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={() => template('csv')} className="font-semibold text-brand underline">CSV</button>
            </p>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center ${dragging ? 'border-brand bg-brand-soft' : 'border-line-strong'}`}
          >
            <label htmlFor="bulk-file" className="inline-flex min-h-[44px] cursor-pointer items-center rounded-btn bg-brand px-[18px] text-sm font-semibold text-white">
              Choose a file
            </label>
            <p className="text-[13px] text-ink-muted" role="status">{busy === 'check' ? 'Checking your file...' : 'or drop an Excel (.xlsx) or CSV file here. Up to 500 rows.'}</p>
          </div>
        </>
      )}

      {stage === 'preview' && check && (
        <>
          <div role="status" className="flex flex-col gap-3">
            <p className="text-sm text-ink-soft">{file?.name}: {plural(check.total, 'row')} checked. Nothing has been saved yet.</p>
            <div className="flex flex-wrap gap-2">
              <Chip tone="success">Ready to add: {check.counts.NEW ?? 0}</Chip>
              <Chip tone="progress">Ready to update: {check.counts.UPDATE ?? 0}</Chip>
              <Chip tone="neutral">Already exist, skipped: {check.counts.DUPLICATE ?? 0}</Chip>
              <Chip tone="danger">Need fixing: {check.counts.INVALID ?? 0}</Chip>
            </div>
            {invalid.length > 0 && <p className="text-sm text-ink-muted">Rows that need fixing are left out. Fix them in your file and choose it again, or import the rest now.</p>}
          </div>
          {invalid.length > 0 && (
            <label className="flex min-h-[44px] items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} className="h-4 w-4" />
              Only rows that need fixing
            </label>
          )}
          <div className="rounded-xl border border-line">
            <RowsTable rows={shown} columns={columns} />
          </div>
        </>
      )}

      {stage === 'done' && result && (
        <>
          <div role="status" className="flex flex-col gap-3">
            <p className="text-sm font-semibold">Import finished.</p>
            <div className="flex flex-wrap gap-2">
              <Chip tone="success">Added: {result.summary.created}</Chip>
              <Chip tone="progress">Updated: {result.summary.updated}</Chip>
              <Chip tone="neutral">Skipped (already existed): {result.summary.skipped}</Chip>
              <Chip tone={result.summary.failed ? 'danger' : 'neutral'}>Not imported: {result.summary.failed}</Chip>
            </div>
          </div>
          {result.rows.some(bad) && (
            <>
              <h3 className="text-sm font-semibold">Rows not imported</h3>
              <div className="rounded-xl border border-line">
                <RowsTable rows={result.rows.filter(bad)} columns={columns} />
              </div>
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
