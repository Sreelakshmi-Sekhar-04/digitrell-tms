'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useApi } from '@/lib/useApi';
import { TRUCK_TYPES, prettyPhone } from '@/lib/masters';
import { DOC_STATE_UI, TRUCK_STATUS_UI, prettyDate, type DocState, type Truck } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState, Skeleton } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import { TextField } from '@/components/ui/Field';
import { ChoiceChips } from '@/components/ui/Choice';
import { DataTable, td } from '@/components/masters/Table';
import { FormError, useDrawerForm } from './useDrawerForm';
import { DocStatus, PapersUpload, pickKeys, removeTruckDoc, uploadPicks, validatePicks, viewTruckDoc, type Pick } from './DocUpload';
import { useToast } from '@/components/ui/Toast';

const DOCS = [
  { key: 'rcExpiry', label: 'RC valid to' },
  { key: 'insuranceExpiry', label: 'Insurance valid to' },
  { key: 'permitExpiry', label: 'Permit valid to' },
  { key: 'fitnessExpiry', label: 'Fitness valid to' },
  { key: 'pucExpiry', label: 'PUC valid to' },
] as const;

type Form = {
  number: string; truckType: string; ownership: string; make: string; capacityKg: string;
  ownerName: string; ownerPhone: string; usualDriverId: string;
  rcExpiry: string; insuranceExpiry: string; permitExpiry: string; fitnessExpiry: string; pucExpiry: string;
};
const EMPTY: Form = { number: '', truckType: '', ownership: '', make: '', capacityKg: '', ownerName: '', ownerPhone: '', usualDriverId: '', rcExpiry: '', insuranceExpiry: '', permitExpiry: '', fitnessExpiry: '', pucExpiry: '' };
const fromTruck = (t: Truck): Form => {
  const doc = (k: string) => t.docs.find((d) => d.key === k)?.expiry ?? '';
  return {
    // The form takes capacity in tonnes; the API stores kg.
    number: t.number, truckType: t.truckType, ownership: t.ownership, make: t.make ?? '', capacityKg: t.capacityKg ? String(t.capacityKg / 1000) : '',
    ownerName: t.ownerName ?? '', ownerPhone: t.ownerPhone ? prettyPhone(t.ownerPhone) : '', usualDriverId: t.usualDriver?.id ?? '',
    rcExpiry: doc('rcExpiry'), insuranceExpiry: doc('insuranceExpiry'), permitExpiry: doc('permitExpiry'), fitnessExpiry: doc('fitnessExpiry'), pucExpiry: doc('pucExpiry'),
  };
};

/** Same rule as the server (shared/carrier.ts docState), for the live preview in the drawer. */
function previewState(iso: string): DocState {
  if (!iso) return 'MISSING';
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  const t = new Date(`${iso}T00:00:00Z`).getTime();
  if (t < today) return 'EXPIRED';
  if (t < today + 15 * 86400_000) return 'EXPIRING';
  return 'VALID';
}

export function TrucksTab({ canManage, addSignal }: { canManage: boolean; addSignal: number }) {
  const [showInactive, setShowInactive] = useState(false);
  const list = useApi<{ trucks: Truck[]; counts: { total: number; ready: number } }>(`/carrier/trucks?includeInactive=${showInactive}`);
  const d = useDrawerForm<Truck, Form>(EMPTY, fromTruck);
  const toast = useToast();
  // Papers already on the server (by doc key) and files picked for a truck that is not saved yet.
  const [files, setFiles] = useState<Record<string, { fileName: string } | null>>({});
  const [picks, setPicks] = useState<Pick[]>([]);
  const [pickError, setPickError] = useState('');
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    setPicks([]);
    setPickError('');
    setFiles(Object.fromEntries((d.current?.docs ?? []).map((x) => [x.key, x.file])));
  }, [d.editing]);

  useEffect(() => {
    if (addSignal > 0) d.open('new');
  }, [addSignal]);

  /** Existing truck: uploads the chosen files now. */
  const confirmPicks = async () => {
    const bad = validatePicks(picks);
    setPickError(bad);
    if (bad || !d.current) return;
    setUploading(true);
    const { done, failed } = await uploadPicks(d.current.id, picks);
    setUploading(false);
    setFiles((x) => ({ ...x, ...done }));
    setPicks([]);
    if (failed.length) toast({ tone: 'error', title: `These papers did not upload: ${failed.join(', ')}. Try again.` });
    else toast({ tone: 'success', title: 'Papers uploaded.' });
    list.reload();
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const bad = validatePicks(picks);
    setPickError(bad);
    if (bad) return;
    const f = d.form;
    // Ownership and usual driver are no longer asked for: new trucks are saved as own trucks, and an
    // existing truck keeps whatever it had. Capacity is typed in tonnes and sent in kg.
    const { usualDriverId: _ud, ownerName: _on, ownerPhone: _op, ...rest } = f;
    const tonnes = f.capacityKg.replace(/[,\s]/g, '');
    const body = {
      ...rest,
      ownership: f.ownership || 'OWN',
      capacityKg: tonnes === '' ? '' : String(Math.round(Number(tonnes) * 1000)),
      ...(d.isNew ? { ownerName: '', ownerPhone: '' } : {}),
    };
    // Papers picked before the truck existed are uploaded after it is saved, one by one.
    const queued = picks;
    const res = d.isNew
      ? await d.send<{ truck: Truck }>('/carrier/trucks', 'POST', body, `${f.number.toUpperCase()} added.`, queued.length > 0)
      : await d.send<{ truck: Truck }>(`/carrier/trucks/${d.current!.id}`, 'PATCH', body, 'Truck saved.');
    if (res && !d.isNew && queued.length) {
      const { failed } = await uploadPicks(d.current!.id, queued);
      if (failed.length) toast({ tone: 'error', title: `Truck saved, but these papers did not upload: ${failed.join(', ')}.` });
    }
    if (res && d.isNew && queued.length) {
      const { failed } = await uploadPicks(res.truck.id, queued);
      if (failed.length) toast({ tone: 'error', title: `Truck saved, but these papers did not upload: ${failed.join(', ')}. Open the truck and upload them again.` });
      d.close();
    }
    if (res) list.reload();
  };
  const toggleActive = async (t: Truck) => {
    const res = await d.send(`/carrier/trucks/${t.id}`, 'PATCH', { isActive: !t.isActive }, t.isActive ? `${t.number} deactivated.` : `${t.number} reactivated.`);
    if (res) list.reload();
  };

  if (list.loading && !list.data) return <div className="p-5"><Skeleton /></div>;
  if (list.error) return <EmptyState title="Couldn't load trucks" action={<Button variant="secondary" onClick={list.reload}>Try again</Button>}>{list.error}</EmptyState>;
  const rows = list.data?.trucks ?? [];
  const blocked = rows.filter((t) => t.status === 'BLOCKED').length;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
        <p className="text-[13px] text-ink-muted" data-testid="truck-summary">
          {list.data?.counts.total ?? 0} trucks · {list.data?.counts.ready ?? 0} can take a load{blocked ? ` · ${blocked} blocked by documents` : ''}
        </p>
        <label className="flex min-h-[36px] items-center gap-2 text-[13px] text-ink-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4 accent-brand" />
          Show deactivated
        </label>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No trucks yet" action={canManage ? <Button onClick={() => d.open('new')}>Add a truck</Button> : undefined}>
          Add your own and attached trucks. Only trucks with valid documents can be assigned to a load.
        </EmptyState>
      ) : (
        <DataTable label="Trucks" headers={['Truck no.', 'Type', 'Capacity', 'Insurance', 'Fitness', 'Next expiry', 'Status', '']}>
          {rows.map((t) => {
            const doc = (k: string) => t.docs.find((x) => x.key === k)!;
            const docCell = (k: string) => {
              const x = doc(k);
              return <span className={x.state === 'EXPIRED' || x.state === 'EXPIRING' ? 'font-semibold text-tone-action' : ''}>{x.state === 'MISSING' ? 'Missing' : `${x.state === 'EXPIRED' ? 'Expired' : 'Valid to'} ${prettyDate(x.expiry)}`}</span>;
            };
            const ui = TRUCK_STATUS_UI[t.status];
            return (
              <tr key={t.id} className={t.isActive ? '' : 'text-ink-muted'}>
                <td className={td}>
                  <div className="whitespace-nowrap font-semibold tabular">{t.number}</div>
                  <div className="text-xs text-ink-muted">{t.make || '—'}</div>
                </td>
                <td className={`${td} whitespace-nowrap`}>{t.truckType}</td>
                <td className={`${td} whitespace-nowrap tabular`}>{t.capacityKg ? `${t.capacityKg / 1000} t` : '—'}</td>
                <td className={`${td} whitespace-nowrap`}>{docCell('insuranceExpiry')}</td>
                <td className={`${td} whitespace-nowrap`}>{docCell('fitnessExpiry')}</td>
                <td className={`${td} whitespace-nowrap`}>{t.nextExpiry ? `${t.nextExpiry.label} · ${prettyDate(t.nextExpiry.date)}` : '—'}</td>
                <td className={td}>
                  <Chip tone={ui.tone}>{ui.label}</Chip>
                  <div className="mt-1 text-xs text-ink-muted" data-testid="truck-papers">&#128206; {t.docs.filter((x) => x.file).length} of {t.docs.length} papers uploaded</div>
                  {(t.status === 'BLOCKED' || t.status === 'EXPIRING' || t.status === 'ON_TRIP') && <div className="mt-1 text-xs text-ink-muted">{t.note}</div>}
                </td>
                <td className={`${td} text-right`}>{canManage && <Button size="sm" variant="ghost" onClick={() => d.open(t)} aria-label={`Edit ${t.number}`}>Edit</Button>}</td>
              </tr>
            );
          })}
        </DataTable>
      )}

      <Drawer
        open={d.editing !== null}
        title={d.isNew ? 'Add truck' : `Edit ${d.current?.number ?? ''}`}
        subtitle="A truck with any expired or missing document is blocked and can't be assigned."
        dirty={d.dirty}
        onClose={d.close}
        onSubmit={save}
        footer={
          <>
            <Button type="submit" loading={d.busy}>{d.isNew ? 'Save truck' : 'Save changes'}</Button>
            {d.current && (
              <Button variant={d.current.isActive ? 'danger' : 'secondary'} disabled={d.busy} onClick={() => toggleActive(d.current!)}>
                {d.current.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            )}
          </>
        }
      >
        <FormError message={d.formError} />
        <TextField label="Truck number" required value={d.form.number} onChange={(e) => d.set('number', e.target.value.toUpperCase())} error={d.errors.number} placeholder="TN 09 BX 4471" help="As on the RC. Spaces are added for you." autoCapitalize="characters" />
        <ChoiceChips label="Truck type" required options={TRUCK_TYPES.map((t) => ({ value: t, label: t }))} value={d.form.truckType} onChange={(v) => d.set('truckType', v)} error={d.errors.truckType} />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <TextField label="Make and model" optional value={d.form.make} onChange={(e) => d.set('make', e.target.value)} error={d.errors.make} placeholder="e.g. Tata Signa 3518" />
          <TextField label="Capacity (tonnes)" optional inputMode="decimal" value={d.form.capacityKg} onChange={(e) => d.set('capacityKg', e.target.value.replace(/[^\d.]/g, ''))} error={d.errors.capacityKg ? 'Enter the capacity in tonnes, between 0.5 and 60.' : undefined} placeholder="e.g. 18" help="Checked against the load weight." />
        </div>

        <fieldset className="rounded-xl border border-line p-3.5">
          <legend className="px-1 text-[13px] font-semibold text-ink-soft">Documents</legend>
          <p className="mb-3 text-xs text-ink-muted">Enter the expiry dates and upload a photo or PDF of each paper.</p>
          <PapersUpload picks={picks} onChange={(p) => { setPicks(p); setPickError(''); }} canEdit={canManage} busy={d.busy || uploading} error={pickError} onConfirm={d.isNew ? undefined : confirmPicks} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {DOCS.map((doc) => {
              const st = previewState(d.form[doc.key]);
              return (
                <div key={doc.key}>
                  <TextField label={doc.label} required type="date" value={d.form[doc.key]} onChange={(e) => d.set(doc.key, e.target.value)} error={d.errors[doc.key]} />
                  {d.form[doc.key] && !d.errors[doc.key] && <div className="mt-1"><Chip tone={DOC_STATE_UI[st].tone}>{DOC_STATE_UI[st].label}</Chip></div>}
                  <DocStatus
                    saved={files[doc.key] ?? null}
                    pendingName={picks.find((p) => pickKeys(p).includes(doc.key))?.file.name ?? null}
                    canEdit={canManage}
                    busy={d.busy || uploading}
                    onView={() => d.current && viewTruckDoc(d.current.id, doc.key)}
                    onRemove={async () => {
                      if (!d.current) return;
                      try {
                        await removeTruckDoc(d.current.id, doc.key);
                        setFiles((x) => ({ ...x, [doc.key]: null }));
                        list.reload();
                      } catch { toast({ tone: 'error', title: 'The file could not be removed. Please try again.' }); }
                    }}
                  />
                </div>
              );
            })}
          </div>
        </fieldset>

      </Drawer>
    </>
  );
}
