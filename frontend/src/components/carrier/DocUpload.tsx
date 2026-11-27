'use client';

import { useRef, useState } from 'react';
import { API_URL, ApiError, tokenStore } from '@/lib/api';
import { Button } from '@/components/ui/Button';

export const DOC_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const DOC_FILE_MAX = 5 * 1024 * 1024;

/** Client-side check; the API enforces the same rules. Returns an error message or ''. */
export function checkDocFile(f: File): string {
  if (!DOC_FILE_TYPES.includes(f.type)) return 'Upload a JPG, PNG, WebP or PDF file.';
  if (f.size > DOC_FILE_MAX) return 'That file is over 5 MB. Upload a smaller photo or PDF.';
  return '';
}

const authHeader = (): Record<string, string> => {
  const token = tokenStore.get();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Uploads one paper for a saved truck. Throws ApiError with the server's message. */
export async function uploadTruckDoc(truckId: string, docKey: string, file: File): Promise<{ fileName: string; uploadedAt: string }> {
  const body = new FormData();
  body.append('file', file);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/carrier/trucks/${truckId}/documents/${docKey}`, { method: 'POST', body, headers: authHeader() });
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: "Can't reach DigitRell. Check your connection and try again." });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? { code: 'HTTP_' + res.status, message: 'The upload failed. Please try again.' });
  return data.document;
}

export async function removeTruckDoc(truckId: string, docKey: string) {
  const res = await fetch(`${API_URL}/carrier/trucks/${truckId}/documents/${docKey}`, { method: 'DELETE', headers: authHeader() });
  if (!res.ok) throw new ApiError(res.status, { code: 'HTTP_' + res.status, message: 'The file could not be removed. Please try again.' });
}

/** Opens the stored paper in a new tab (the API needs the session token, so a plain link will not do). */
export async function viewTruckDoc(truckId: string, docKey: string) {
  const win = window.open('', '_blank');
  try {
    const res = await fetch(`${API_URL}/carrier/trucks/${truckId}/documents/${docKey}/file`, { headers: authHeader() });
    if (!res.ok) throw new Error('not available');
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url;
    else window.open(url, '_blank');
  } catch {
    win?.close();
    alert('The file could not be opened. Please try again.');
  }
}

export const PAPERS = [
  { key: 'rcExpiry', label: 'RC' },
  { key: 'insuranceExpiry', label: 'Insurance' },
  { key: 'permitExpiry', label: 'Permit' },
  { key: 'fitnessExpiry', label: 'Fitness' },
  { key: 'pucExpiry', label: 'PUC' },
] as const;
export const ALL_PAPERS = 'ALL';

export interface Pick { id: string; file: File; paper: string }

/**
 * Guesses which paper a file is from its name. This mapping step is what the AI reader will later
 * automate (classify the paper, read the date).
 */
export function guessPaper(name: string): string {
  const n = name.toLowerCase();
  if (/insur|policy/.test(n)) return 'insuranceExpiry';
  if (/permit/.test(n)) return 'permitExpiry';
  if (/puc|pollution/.test(n)) return 'pucExpiry';
  if (/fitness|(^|[^a-z])fc([^a-z]|$)/.test(n)) return 'fitnessExpiry';
  if (/registration|(^|[^a-z])rc([^a-z]|$)/.test(n)) return 'rcExpiry';
  return '';
}

/** The doc keys a pick stands for. */
export const pickKeys = (p: Pick): string[] => (p.paper === ALL_PAPERS ? PAPERS.map((x) => x.key as string) : p.paper ? [p.paper] : []);

/** '' when the picks can be uploaded; otherwise what the carrier must fix. */
export function validatePicks(picks: Pick[]): string {
  if (picks.some((p) => !p.paper)) return 'Choose which paper each file is.';
  const seen = new Set<string>();
  for (const p of picks) {
    for (const k of pickKeys(p)) {
      if (seen.has(k)) return `More than one file is marked as ${PAPERS.find((x) => x.key === k)!.label}. Each paper can have one file.`;
      seen.add(k);
    }
  }
  return '';
}

let seq = 0;

/** Uploads every pick for a saved truck ("all papers" is stored against all five). Returns labels that failed. */
export async function uploadPicks(truckId: string, picks: Pick[]) {
  const done: Record<string, { fileName: string; uploadedAt: string }> = {};
  const failed: string[] = [];
  for (const p of picks) {
    for (const k of pickKeys(p)) {
      try { done[k] = await uploadTruckDoc(truckId, k, p.file); } catch { failed.push(PAPERS.find((x) => x.key === k)!.label); }
    }
  }
  return { done, failed };
}

/** One control for all papers: pick or drop several files, then say which paper each one is. */
export function PapersUpload({
  picks, onChange, canEdit, busy, error, onConfirm,
}: {
  picks: Pick[];
  onChange: (p: Pick[]) => void;
  canEdit: boolean;
  busy: boolean;
  error: string;
  /** Existing truck only: uploads the picks now. A new truck uploads after Save. */
  onConfirm?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [fileError, setFileError] = useState('');
  if (!canEdit) return null;

  const add = (list: FileList | File[]) => {
    const next: Pick[] = [];
    const bad: string[] = [];
    for (const f of Array.from(list)) {
      const e = checkDocFile(f);
      if (e) bad.push(`${f.name}: ${e}`);
      else next.push({ id: `p${++seq}`, file: f, paper: guessPaper(f.name) });
    }
    setFileError(bad.join(' '));
    if (next.length) onChange([...picks, ...next]);
  };
  const problem = error || (picks.length > 0 && picks.every((p) => p.paper) ? validatePicks(picks) : '');

  return (
    <div className="mb-3" data-testid="papers-upload">
      <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" tabIndex={-1} aria-label="Upload papers" data-testid="papers-input" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        className={`flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-3 py-3 text-xs text-ink-muted ${drag ? 'border-brand' : 'border-line'}`}
      >
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>Upload papers</Button>
        <span>Choose several photos or PDFs at once, or drop them here. JPG, PNG, WebP or PDF, up to 5 MB each.</span>
      </div>
      {fileError && <p role="alert" className="mt-1 text-xs font-semibold text-[#7A1616]">{fileError}</p>}
      {picks.length > 0 && (
        <ul className="mt-2 space-y-2" aria-label="Files to upload">
          {picks.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="max-w-[12rem] truncate font-medium text-ink-soft" title={p.file.name}>{p.file.name}</span>
              <select
                aria-label={`Which paper is ${p.file.name}?`}
                value={p.paper}
                disabled={busy}
                onChange={(e) => onChange(picks.map((x) => (x.id === p.id ? { ...x, paper: e.target.value } : x)))}
                className="min-h-[32px] rounded-lg border border-line bg-white px-2 text-xs"
              >
                <option value="">Which paper?</option>
                {PAPERS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                <option value={ALL_PAPERS}>All papers in one file</option>
              </select>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onChange(picks.filter((x) => x.id !== p.id))}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      {problem && <p role="alert" className="mt-1 text-xs font-semibold text-[#7A1616]">{problem}</p>}
      {onConfirm && picks.length > 0 && (
        <Button type="button" size="sm" className="mt-2" loading={busy} onClick={onConfirm}>{`Upload ${picks.length} file${picks.length > 1 ? 's' : ''}`}</Button>
      )}
    </div>
  );
}

/** Compact per-paper status under a date field. */
export function DocStatus({ saved, pendingName, canEdit, busy, onView, onRemove }: {
  saved: { fileName: string } | null; pendingName: string | null; canEdit: boolean; busy: boolean; onView: () => void; onRemove: () => void;
}) {
  if (pendingName) return <div className="mt-1 text-xs text-ink-soft">&#128206; <span className="font-medium">{pendingName}</span> <span className="text-ink-muted">(not uploaded yet)</span></div>;
  if (!saved) return <div className="mt-1 text-xs text-ink-muted">No file</div>;
  const link = 'font-semibold text-brand underline-offset-2 hover:underline disabled:opacity-50';
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-ink-soft">
      <span>&#128206;</span><span className="max-w-[10rem] truncate font-medium" title={saved.fileName}>{saved.fileName}</span>
      <span className="text-ink-muted">·</span>
      <button type="button" className={link} disabled={busy} onClick={onView}>View</button>
      {canEdit && <><span className="text-ink-muted">·</span><button type="button" className={link} disabled={busy} onClick={onRemove}>Remove</button></>}
    </div>
  );
}
