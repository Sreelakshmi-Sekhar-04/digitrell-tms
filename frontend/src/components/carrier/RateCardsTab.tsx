'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useApi } from '@/lib/useApi';
import { TRUCK_TYPES, rupees } from '@/lib/masters';
import { RATE_STATUS_UI, prettyDate, type RateCard } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState, Skeleton } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextField } from '@/components/ui/Field';
import { ChoiceChips, fromRupeeInput, toRupeeInput } from '@/components/ui/Choice';
import { DataTable, td } from '@/components/masters/Table';
import { FormError, useDrawerForm } from './useDrawerForm';

type Form = { shipperId: string; origin: string; destination: string; truckType: string; rate: string; bandPct: string; tripCost: string; validFrom: string; validTo: string };
const todayIso = () => new Date().toISOString().slice(0, 10);
const yearEnd = () => `${new Date().getFullYear() + (new Date().getMonth() >= 2 ? 1 : 0)}-03-31`;
const EMPTY: Form = { shipperId: '', origin: '', destination: '', truckType: '', rate: '', bandPct: '5', tripCost: '', validFrom: '', validTo: '' };
const fromRate = (r: RateCard): Form => ({
  shipperId: r.shipper?.id ?? '', origin: r.origin, destination: r.destination, truckType: r.truckType,
  rate: toRupeeInput(String(r.rate)), bandPct: String(r.bandPct), tripCost: r.tripCost ? toRupeeInput(String(r.tripCost)) : '', validFrom: r.validFrom, validTo: r.validTo,
});

export function RateCardsTab({ canManage, addSignal }: { canManage: boolean; addSignal: number }) {
  const [showInactive, setShowInactive] = useState(false);
  const list = useApi<{ rateCards: RateCard[] }>(`/carrier/rate-cards?includeInactive=${showInactive}`);
  const shippers = useApi<{ shippers: { id: string; name: string }[] }>('/carrier/shippers');
  const d = useDrawerForm<RateCard, Form>(EMPTY, fromRate);

  useEffect(() => {
    if (addSignal > 0) d.open('new', { validFrom: todayIso(), validTo: yearEnd() });
  }, [addSignal]);

  const body = () => ({
    ...d.form,
    shipperId: d.form.shipperId || null,
    rate: fromRupeeInput(d.form.rate),
    tripCost: fromRupeeInput(d.form.tripCost),
  });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const lane = `${d.form.origin} → ${d.form.destination}`;
    const res = d.isNew
      ? await d.send('/carrier/rate-cards', 'POST', body(), `Rate for ${lane} added.`)
      : await d.send(`/carrier/rate-cards/${d.current!.id}`, 'PATCH', body(), 'Rate saved.');
    if (res) list.reload();
  };

  if (list.loading && !list.data) return <div className="p-5"><Skeleton /></div>;
  if (list.error) return <EmptyState title="Couldn't load your price list" action={<Button variant="secondary" onClick={list.reload}>Try again</Button>}>{list.error}</EmptyState>;
  const rows = list.data?.rateCards ?? [];
  const rate = fromRupeeInput(d.form.rate) ?? 0;
  const band = Number(d.form.bandPct) || 0;
  const cost = fromRupeeInput(d.form.tripCost);
  const margin = rate && cost != null && cost < rate ? Math.round(((rate - cost) / rate) * 1000) / 10 : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
        <p className="text-[13px] text-ink-muted">Your own price list and trip cost, kept for your reference and margins. Load offers are priced from the contract rates your shippers set, not from this list.</p>
        <label className="flex min-h-[36px] items-center gap-2 text-[13px] text-ink-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4 accent-brand" />
          Show deactivated
        </label>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No price list yet" action={canManage ? <Button onClick={() => d.open('new', { validFrom: todayIso(), validTo: yearEnd() })}>Add a rate</Button> : undefined}>
          Add your own price and trip cost per lane and truck type. This is a reference for margins, not used for load offers.
        </EmptyState>
      ) : (
        <DataTable label="Own price list" headers={['Shipper', 'Lane', 'Truck type', 'Rate per trip', 'Band', 'Margin', 'Valid', 'Status', '']}>
          {rows.map((r) => {
            const ui = RATE_STATUS_UI[r.status];
            return (
              <tr key={r.id} className={r.status === 'ACTIVE' || r.status === 'UPCOMING' ? '' : 'text-ink-muted'}>
                <td className={td}>{r.shipper?.name ?? 'Any shipper'}</td>
                <td className={`${td} whitespace-nowrap font-semibold`}>{r.origin} → {r.destination}</td>
                <td className={`${td} whitespace-nowrap`}>{r.truckType}</td>
                <td className={`${td} tabular font-semibold`}>{rupees(r.rate)}</td>
                <td className={`${td} whitespace-nowrap`}>±{r.bandPct}%<div className="text-xs text-ink-muted tabular">{rupees(r.bandLow)} – {rupees(r.bandHigh)}</div></td>
                <td className={td}>{r.marginPct != null ? `${r.marginPct}%` : '—'}</td>
                <td className={`${td} whitespace-nowrap`}>{prettyDate(r.validFrom)} – {prettyDate(r.validTo)}</td>
                <td className={td}><Chip tone={ui.tone}>{ui.label}</Chip></td>
                <td className={`${td} text-right`}>{canManage && <Button size="sm" variant="ghost" onClick={() => d.open(r)} aria-label={`Edit rate ${r.origin} to ${r.destination}`}>Edit</Button>}</td>
              </tr>
            );
          })}
        </DataTable>
      )}

      <Drawer
        open={d.editing !== null}
        title={d.isNew ? 'Add rate' : `${d.current?.origin} → ${d.current?.destination}`}
        subtitle="Only the owner can change rates. Every change is logged with your name."
        dirty={d.dirty}
        onClose={d.close}
        onSubmit={save}
        footer={
          <>
            <Button type="submit" loading={d.busy}>{d.isNew ? 'Save rate' : 'Save changes'}</Button>
            {d.current && (
              <Button
                variant={d.current.isActive ? 'danger' : 'secondary'}
                disabled={d.busy}
                onClick={async () => {
                  if (await d.send(`/carrier/rate-cards/${d.current!.id}`, 'PATCH', { isActive: !d.current!.isActive }, d.current!.isActive ? 'Rate deactivated.' : 'Rate reactivated.')) list.reload();
                }}
              >
                {d.current.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            )}
          </>
        }
      >
        <FormError message={d.formError} />
        <SelectField label="Shipper" value={d.form.shipperId} onChange={(e) => d.set('shipperId', e.target.value)} error={d.errors.shipperId} help="A rate for one shipper is used before an “any shipper” rate.">
          <option value="">Any shipper</option>
          {(shippers.data?.shippers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </SelectField>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <TextField label="From city" required value={d.form.origin} onChange={(e) => d.set('origin', e.target.value)} error={d.errors.origin} placeholder="e.g. Chennai" />
          <TextField label="To city" required value={d.form.destination} onChange={(e) => d.set('destination', e.target.value)} error={d.errors.destination} placeholder="e.g. Bengaluru" />
        </div>
        <ChoiceChips label="Truck type" required options={TRUCK_TYPES.map((t) => ({ value: t, label: t }))} value={d.form.truckType} onChange={(v) => d.set('truckType', v)} error={d.errors.truckType} />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <TextField label="Rate per trip (₹)" required inputMode="numeric" value={d.form.rate} onChange={(e) => d.set('rate', toRupeeInput(e.target.value))} error={d.errors.rate} placeholder="e.g. 42,500" />
          <TextField label="Band (± %)" required inputMode="decimal" value={d.form.bandPct} onChange={(e) => d.set('bandPct', e.target.value.replace(/[^\d.]/g, ''))} error={d.errors.bandPct} help={rate ? `Quotes from ${rupees(Math.round(rate * (1 - band / 100)))} to ${rupees(Math.round(rate * (1 + band / 100)))} go without you.` : 'Quotes inside the band go without the owner.'} />
        </div>
        <TextField label="Trip cost (₹)" optional inputMode="numeric" value={d.form.tripCost} onChange={(e) => d.set('tripCost', toRupeeInput(e.target.value))} error={d.errors.tripCost} placeholder="Diesel, tolls, driver" help={margin != null ? `Margin at this rate: ${margin}%. Your margin floor is checked against this cost.` : 'Your margin floor is checked against this cost.'} />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <TextField label="Valid from" required type="date" value={d.form.validFrom} onChange={(e) => d.set('validFrom', e.target.value)} error={d.errors.validFrom} />
          <TextField label="Valid to" required type="date" value={d.form.validTo} onChange={(e) => d.set('validTo', e.target.value)} error={d.errors.validTo} />
        </div>
      </Drawer>
    </>
  );
}
