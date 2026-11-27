'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { formErrors, useApi } from '@/lib/useApi';
import { TRUCK_TYPES, rupees } from '@/lib/masters';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState, Skeleton } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextField } from '@/components/ui/Field';
import { fromRupeeInput, toRupeeInput } from '@/components/ui/Choice';
import { useToast } from '@/components/ui/Toast';
import { DataTable, td } from './Table';
import type { Address, Carrier, Lane, RateCard } from './types';

interface LineForm {
  key: number;
  origin: string;
  destination: string;
  truckType: string;
  rate: string;
  detentionPerDay: string;
  transitDays: string;
}
interface Form {
  carrierId: string;
  validFrom: string;
  validTo: string;
  notes: string;
  lines: LineForm[];
}

let nextKey = 1;
const blankLine = (seed: Partial<LineForm> = {}): LineForm => ({ key: nextKey++, origin: '', destination: '', truckType: '', rate: '', detentionPerDay: '', transitDays: '', ...seed });
const fromCard = (c: RateCard): Form => ({
  carrierId: c.carrier.id,
  validFrom: c.validFrom ?? '',
  validTo: c.validTo ?? '',
  notes: c.notes ?? '',
  lines: c.lines.map((l) => blankLine({
    origin: l.origin, destination: l.destination, truckType: l.truckType,
    rate: l.rate != null ? toRupeeInput(String(l.rate)) : '', detentionPerDay: l.detentionPerDay != null ? toRupeeInput(String(l.detentionPerDay)) : '',
    transitDays: l.transitDays != null ? String(l.transitDays) : '',
  })),
});
/** Comparable form state for the unsaved-changes check (ignores the React keys). */
const snapshot = (f: Form) => JSON.stringify({ ...f, lines: f.lines.map(({ key: _key, ...l }) => l) });

const prettyDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
function validityLabel(c: RateCard) {
  if (c.validity === 'EXPIRED') return <Chip tone="danger">Expired {c.validTo && prettyDay(c.validTo)}</Chip>;
  if (c.validity === 'NOT_STARTED') return <Chip tone="neutral">From {c.validFrom && prettyDay(c.validFrom)}</Chip>;
  return <Chip tone="success">{c.validTo ? `Valid till ${prettyDay(c.validTo)}` : 'Current'}</Chip>;
}

/**
 * Rate cards: the freight each carrier has agreed with you, per lane and truck type. Shown as a
 * reference when booking and comparing quotes; nothing is awarded from them automatically.
 */
export function RateCardsTab({ canManage, addSignal, openCarrierId, onOpened }: { canManage: boolean; addSignal: number; openCarrierId: string | null; onOpened: () => void }) {
  const cards = useApi<{ rateCards: RateCard[] }>('/rate-cards');
  const carriers = useApi<{ carriers: Carrier[] }>('/carriers');
  const lanes = useApi<{ lanes: Lane[] }>('/lanes');
  const addresses = useApi<{ addresses: Address[] }>('/addresses');
  const toast = useToast();
  const [editing, setEditing] = useState<RateCard | 'new' | null>(null);
  const [form, setForm] = useState<Form>({ carrierId: '', validFrom: '', validTo: '', notes: '', lines: [] });
  const [initial, setInitial] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const allCards = cards.data?.rateCards ?? [];
  const withoutCard = (carriers.data?.carriers ?? []).filter((c) => c.isActive && !allCards.some((rc) => rc.carrier.id === c.id));

  const open = (card: RateCard | 'new', carrierId = '') => {
    // A new card starts with one row per lane the carrier is approved on, so only the freight is left to fill in.
    const approvedOn = (lanes.data?.lanes ?? []).filter((l) => l.isActive && l.carriers.some((c) => c.id === carrierId));
    const f: Form = card === 'new'
      ? { carrierId, validFrom: '', validTo: '', notes: '', lines: approvedOn.length ? approvedOn.map((l) => blankLine({ origin: l.origin, destination: l.destination, truckType: l.truckType })) : [blankLine()] }
      : fromCard(card);
    setForm(f);
    setInitial(snapshot(f));
    setErrors({});
    setFormError('');
    setEditing(card);
  };

  useEffect(() => {
    if (addSignal > 0 && canManage) open('new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSignal]);

  // Opened from the Carriers tab: show that carrier's card, or start one.
  useEffect(() => {
    if (!openCarrierId || !cards.data || !carriers.data || !lanes.data) return;
    const card = cards.data.rateCards.find((c) => c.carrier.id === openCarrierId);
    if (card) open(card);
    else if (canManage) open('new', openCarrierId);
    onOpened();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCarrierId, cards.data, carriers.data, lanes.data]);

  const cities = useMemo(() => {
    const s = new Set<string>();
    (addresses.data?.addresses ?? []).forEach((a) => s.add(a.city));
    (lanes.data?.lanes ?? []).forEach((l) => { s.add(l.origin); s.add(l.destination); });
    return [...s].sort();
  }, [addresses.data, lanes.data]);

  const setField = <K extends keyof Omit<Form, 'lines'>>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const setLine = (i: number, k: keyof Omit<LineForm, 'key'>, v: string) => {
    setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
    setErrors((e) => ({ ...e, [`lines.${i}.${k}`]: '', lines: '' }));
  };
  const removeLine = (i: number) => {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }));
    setErrors({}); // indexes shift; errors come back on the next save
  };

  // Choosing the carrier of a new card fills the rows from its lanes, unless rows were already typed in.
  const pickCarrier = (id: string) => {
    const untouched = form.lines.every((l) => !l.origin && !l.destination && !l.truckType && !l.rate);
    if (untouched) open('new', id);
    else setField('carrierId', id);
  };

  const carrierName = editing === 'new' ? carriers.data?.carriers.find((c) => c.id === form.carrierId)?.name : editing?.carrier.name;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.carrierId) {
      setErrors({ carrierId: 'Choose the carrier this rate card is for.' });
      return;
    }
    setBusy(true);
    setFormError('');
    const body = {
      validFrom: form.validFrom || null,
      validTo: form.validTo || null,
      notes: form.notes,
      lines: form.lines.map((l) => ({
        origin: l.origin, destination: l.destination, truckType: l.truckType, rate: fromRupeeInput(l.rate),
        detentionPerDay: fromRupeeInput(l.detentionPerDay), transitDays: l.transitDays ? Number(l.transitDays) : null,
      })),
    };
    try {
      const { rateCard } = await api<{ rateCard: RateCard }>(`/rate-cards/${form.carrierId}`, { method: 'PUT', json: body });
      toast({ tone: 'success', title: editing === 'new' ? 'Rate card saved.' : 'Rate card updated.', text: `${rateCard.carrier.name}: ${rateCard.lines.length} rate${rateCard.lines.length === 1 ? '' : 's'}. Shown when you book on these lanes.` });
      setEditing(null);
      cards.reload();
      carriers.reload();
    } catch (err) {
      const { fields, message } = formErrors(err);
      setErrors(fields);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (editing === 'new' || !editing) return;
    if (!window.confirm(`Delete ${editing.carrier.name}'s rate card? Past trips are not affected.`)) return;
    setBusy(true);
    try {
      await api(`/rate-cards/${editing.carrier.id}`, { method: 'DELETE' });
      toast({ tone: 'success', title: 'Rate card deleted.' });
      setEditing(null);
      cards.reload();
      carriers.reload();
    } catch (err) {
      setFormError(formErrors(err).message);
    } finally {
      setBusy(false);
    }
  };

  if (cards.loading && !cards.data) return <div className="p-5"><Skeleton /></div>;
  if (cards.error) return <EmptyState title="Couldn't load rate cards" action={<Button variant="secondary" onClick={cards.reload}>Try again</Button>}>{cards.error}</EmptyState>;

  return (
    <>
      {allCards.length === 0 ? (
        <EmptyState title="No rate cards yet" action={canManage && withoutCard.length ? <Button onClick={() => open('new')}>Add a rate card</Button> : undefined}>
          A rate card holds the freight a carrier has agreed with you for each lane and truck type. When you book, the load is offered to the carrier with the lowest valid rate first, at that rate.
        </EmptyState>
      ) : (
        <DataTable label="Rate cards" headers={['Carrier', 'Rates', 'Lowest – highest', 'Validity', '']}>
          {allCards.map((c) => {
            const rates = c.lines.map((l) => l.rate ?? 0);
            return (
              <tr key={c.id} className={c.validity === 'CURRENT' ? '' : 'text-ink-muted'}>
                <td className={`${td} font-semibold`}>{c.carrier.name}</td>
                <td className={td}>
                  <span className="block">{c.lines.length} rate{c.lines.length === 1 ? '' : 's'}</span>
                  <span className="block text-xs text-ink-muted">{c.lines.slice(0, 2).map((l) => `${l.origin} → ${l.destination}, ${l.truckType}`).join(' · ')}{c.lines.length > 2 ? ` · +${c.lines.length - 2} more` : ''}</span>
                </td>
                <td className={`${td} tabular whitespace-nowrap`}>{rates.length ? (Math.min(...rates) === Math.max(...rates) ? rupees(rates[0]) : `${rupees(Math.min(...rates))} – ${rupees(Math.max(...rates))}`) : '—'}</td>
                <td className={td}>{validityLabel(c)}</td>
                <td className={`${td} text-right`}><Button size="sm" variant="ghost" onClick={() => open(c)} aria-label={`${canManage ? 'Edit' : 'View'} rate card for ${c.carrier.name}`}>{canManage ? 'Edit' : 'View'}</Button></td>
              </tr>
            );
          })}
        </DataTable>
      )}
      {allCards.length > 0 && withoutCard.length > 0 && (
        <p className="border-t border-line-faint px-5 py-3 text-[13px] text-ink-muted">
          No rate card yet: {withoutCard.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ', '}
              {canManage ? <button type="button" className="font-semibold text-brand underline-offset-2 hover:underline" onClick={() => open('new', c.id)}>{c.name}</button> : c.name}
            </span>
          ))}
        </p>
      )}

      <Drawer
        open={editing !== null}
        title={editing === 'new' ? 'Add rate card' : canManage ? `Rate card: ${carrierName ?? ''}` : `${carrierName ?? ''} rates`}
        subtitle="Freight per trip agreed with this carrier. Shown as a reference when booking; quotes are never priced from it automatically."
        dirty={canManage && snapshot(form) !== initial}
        onClose={() => setEditing(null)}
        onSubmit={canManage ? save : (e) => e.preventDefault()}
        footer={canManage ? (
          <>
            <Button type="submit" loading={busy}>Save rate card</Button>
            {editing !== 'new' && <Button variant="ghost" onClick={remove} disabled={busy}>Delete</Button>}
          </>
        ) : undefined}
      >
        {formError && <p role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]">{formError}</p>}
        <fieldset disabled={!canManage} className="flex flex-col gap-[18px]">
          {editing === 'new' && (
            <SelectField label="Carrier" required value={form.carrierId} onChange={(e) => pickCarrier(e.target.value)} error={errors.carrierId}>
              <option value="">Choose carrier</option>
              {(carriers.data?.carriers ?? []).filter((c) => c.isActive && !allCards.some((rc) => rc.carrier.id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
          )}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <TextField label="Valid from" optional type="date" value={form.validFrom} onChange={(e) => setField('validFrom', e.target.value)} error={errors.validFrom} />
            <TextField label="Valid till" optional type="date" value={form.validTo} onChange={(e) => setField('validTo', e.target.value)} error={errors.validTo} help="Leave empty if open-ended." />
          </div>

          <datalist id="rate-cities">{cities.map((c) => <option key={c} value={c} />)}</datalist>
          <div>
            <h3 className="mb-1 text-[13px] font-semibold text-ink-soft">Rates</h3>
            {errors.lines && <p role="alert" className="mb-2 text-xs font-semibold text-tone-danger">{errors.lines}</p>}
            <ol className="flex flex-col gap-3">
              {form.lines.map((l, i) => (
                <li key={l.key} className="rounded-xl border border-line p-3.5" aria-label={`Rate ${i + 1}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Rate {i + 1}</span>
                    {canManage && form.lines.length > 1 && <Button size="sm" variant="ghost" onClick={() => removeLine(i)} aria-label={`Remove rate ${i + 1}`}>Remove</Button>}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <TextField label="Pickup city" required list="rate-cities" value={l.origin} onChange={(e) => setLine(i, 'origin', e.target.value)} error={errors[`lines.${i}.origin`]} placeholder="e.g. Chennai" />
                    <TextField label="Drop city" required list="rate-cities" value={l.destination} onChange={(e) => setLine(i, 'destination', e.target.value)} error={errors[`lines.${i}.destination`]} placeholder="e.g. Bengaluru" />
                    <SelectField label="Truck type" required value={l.truckType} onChange={(e) => setLine(i, 'truckType', e.target.value)} error={errors[`lines.${i}.truckType`]}>
                      <option value="">Choose</option>
                      {TRUCK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </SelectField>
                    <TextField label="Freight per trip (₹)" required inputMode="numeric" value={l.rate} onChange={(e) => setLine(i, 'rate', toRupeeInput(e.target.value))} error={errors[`lines.${i}.rate`]} placeholder="e.g. 44,500" />
                    <TextField label="Detention per day (₹)" optional inputMode="numeric" value={l.detentionPerDay} onChange={(e) => setLine(i, 'detentionPerDay', toRupeeInput(e.target.value))} error={errors[`lines.${i}.detentionPerDay`]} placeholder="e.g. 1,500" />
                    <TextField label="Transit days" optional inputMode="numeric" value={l.transitDays} onChange={(e) => setLine(i, 'transitDays', e.target.value.replace(/\D/g, '').slice(0, 2))} error={errors[`lines.${i}.transitDays`]} placeholder="e.g. 2" />
                  </div>
                </li>
              ))}
            </ol>
            {canManage && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}>+ Add another rate</Button>}
          </div>
          <TextField label="Notes" optional value={form.notes} onChange={(e) => setField('notes', e.target.value)} error={errors.notes} placeholder="e.g. Rates include loading; toll extra" />
        </fieldset>
      </Drawer>
    </>
  );
}
