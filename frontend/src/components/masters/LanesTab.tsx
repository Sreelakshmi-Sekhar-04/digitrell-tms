'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { formErrors, useApi } from '@/lib/useApi';
import { TRUCK_TYPES } from '@/lib/masters';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState, Skeleton } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import { TextField } from '@/components/ui/Field';
import { ChoiceChips } from '@/components/ui/Choice';
import { useToast } from '@/components/ui/Toast';
import { DataTable, td } from './Table';
import type { Address, Carrier, Lane } from './types';

interface Form {
  origin: string;
  destination: string;
  truckType: string;
  awardRule: string;
  carrierIds: string[];
  isActive: boolean;
}
const EMPTY: Form = { origin: '', destination: '', truckType: '', awardRule: 'ASK', carrierIds: [], isActive: true };
const fromLane = (l: Lane): Form => ({
  origin: l.origin, destination: l.destination, truckType: l.truckType,
  awardRule: l.awardRule, carrierIds: l.carriers.map((c) => c.id), isActive: l.isActive,
});

function laneStatus(l: Lane) {
  if (!l.isActive) return <Chip tone="neutral">Inactive</Chip>;
  if (!l.carriers.length) return <Chip tone="action">Needs carriers</Chip>;
  return <Chip tone="success">Active</Chip>;
}

export function LanesTab({ canManage, addSignal }: { canManage: boolean; addSignal: number }) {
  const lanes = useApi<{ lanes: Lane[] }>('/lanes');
  const carriers = useApi<{ carriers: Carrier[] }>('/carriers');
  const addresses = useApi<{ addresses: Address[] }>('/addresses');
  const toast = useToast();
  const [editing, setEditing] = useState<Lane | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [initial, setInitial] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCarrier, setNewCarrier] = useState<{ open: boolean; name: string; phone: string; errors: Record<string, string>; busy: boolean }>({ open: false, name: '', phone: '', errors: {}, busy: false });

  const open = (lane: Lane | 'new') => {
    const f = lane === 'new' ? EMPTY : fromLane(lane);
    setForm(f);
    setInitial(f);
    setErrors({});
    setFormError('');
    setNewCarrier({ open: false, name: '', phone: '', errors: {}, busy: false });
    setEditing(lane);
  };

  useEffect(() => {
    if (addSignal > 0 && canManage) open('new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSignal]);

  const cities = useMemo(() => [...new Set((addresses.data?.addresses ?? []).map((a) => a.city))].sort(), [addresses.data]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    const body = form;
    try {
      const isNew = editing === 'new';
      const { lane } = await api<{ lane: Lane }>(isNew ? '/lanes' : `/lanes/${(editing as Lane).id}`, { method: isNew ? 'POST' : 'PATCH', json: body });
      toast({ tone: 'success', title: isNew ? 'Lane added.' : 'Lane saved.', text: lane.carriers.length ? `Quote requests will go to ${lane.carriers.length} carrier${lane.carriers.length > 1 ? 's' : ''}.` : 'Approve carriers before booking on it.' });
      setEditing(null);
      lanes.reload();
      carriers.reload();
    } catch (err) {
      const { fields, message } = formErrors(err);
      setErrors(fields);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  };

  const addCarrier = async () => {
    setNewCarrier((n) => ({ ...n, busy: true, errors: {} }));
    try {
      const { carrier } = await api<{ carrier: Carrier }>('/carriers', { method: 'POST', json: { name: newCarrier.name, phone: newCarrier.phone } });
      await carriers.reload();
      set('carrierIds', [...form.carrierIds, carrier.id]);
      setNewCarrier({ open: false, name: '', phone: '', errors: {}, busy: false });
      toast({ tone: 'success', title: `${carrier.name} added and approved for this lane.`, text: 'It is in your carrier list too; add its rate card there.' });
    } catch (err) {
      setNewCarrier((n) => ({ ...n, busy: false, errors: formErrors(err).fields }));
    }
  };

  if (lanes.loading && !lanes.data) return <div className="p-5"><Skeleton /></div>;
  if (lanes.error) return <EmptyState title="Couldn't load lanes" action={<Button variant="secondary" onClick={lanes.reload}>Try again</Button>}>{lanes.error}</EmptyState>;
  const rows = lanes.data?.lanes ?? [];

  return (
    <>
      {rows.length === 0 ? (
        <EmptyState title="No lanes yet" action={canManage ? <Button onClick={() => open('new')}>Add your first lane</Button> : undefined}>
          A lane is a pickup city, drop city and truck type, with the carriers you trust on it. Offers are priced from the Rate cards, not from this list.
        </EmptyState>
      ) : (
        <DataTable label="Lanes" headers={['Lane', 'Truck type', 'Approved carriers', 'Status', '']}>
          {rows.map((l) => (
            <tr key={l.id} className={l.isActive ? '' : 'text-ink-muted'}>
              <td className={`${td} font-semibold`}>{l.origin} → {l.destination}</td>
              <td className={td}>{l.truckType}</td>
              <td className={td}>{l.carriers.length ? l.carriers.map((c) => c.name).join(', ') : <span className="text-ink-muted">None yet</span>}</td>
              <td className={td}>{laneStatus(l)}</td>
              <td className={`${td} text-right`}>{canManage && <Button size="sm" variant="ghost" onClick={() => open(l)} aria-label={`Edit ${l.origin} to ${l.destination}`}>Edit</Button>}</td>
            </tr>
          ))}
        </DataTable>
      )}

      <Drawer
        open={editing !== null}
        title={editing === 'new' ? 'Add lane' : 'Edit lane'}
        subtitle="Quote requests for this lane go only to the carriers you approve here."
        dirty={dirty}
        onClose={() => setEditing(null)}
        onSubmit={save}
        footer={<Button type="submit" loading={busy}>{editing === 'new' ? 'Save lane' : 'Save changes'}</Button>}
      >
        {formError && <p role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]">{formError}</p>}
        <datalist id="lane-cities">{cities.map((c) => <option key={c} value={c} />)}</datalist>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <TextField label="Pickup city" required list="lane-cities" value={form.origin} onChange={(e) => set('origin', e.target.value)} error={errors.origin} placeholder="e.g. Chennai" />
          <TextField label="Drop city" required list="lane-cities" value={form.destination} onChange={(e) => set('destination', e.target.value)} error={errors.destination} placeholder="e.g. Bengaluru" />
        </div>
        <ChoiceChips label="Truck type" required options={TRUCK_TYPES.map((t) => ({ value: t, label: t }))} value={form.truckType} onChange={(v) => set('truckType', v)} error={errors.truckType} />
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-soft">Approved carriers</legend>
          <div className="flex flex-col gap-1.5">
            {/* Carriers in use from your carrier list, plus any already on this lane. */}
            {(carriers.data?.carriers ?? []).filter((c) => c.isActive || form.carrierIds.includes(c.id)).map((c) => {
              const on = form.carrierIds.includes(c.id);
              return (
                <label key={c.id} className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-btn border px-3 text-sm ${on ? 'border-brand bg-[#F3F8F8]' : 'border-line'}`}>
                  <input type="checkbox" checked={on} onChange={() => set('carrierIds', on ? form.carrierIds.filter((x) => x !== c.id) : [...form.carrierIds, c.id])} className="h-[18px] w-[18px] accent-brand" />
                  <span className="flex-1 font-medium">{c.name}</span>
                  {!c.isActive && <Chip tone="neutral">Not in use</Chip>}
                  {c.status === 'INVITED' && <Chip tone="neutral">Invited</Chip>}
                </label>
              );
            })}
          </div>
          {errors.carrierIds && <p role="alert" className="mt-1.5 text-xs font-semibold text-tone-danger">{errors.carrierIds}</p>}
          {newCarrier.open ? (
            <div className="mt-3 flex flex-col gap-3 rounded-xl bg-brand-soft p-3.5">
              <TextField label="Carrier company name" required value={newCarrier.name} onChange={(e) => setNewCarrier((n) => ({ ...n, name: e.target.value }))} error={newCarrier.errors.name} />
              <TextField label="Owner's mobile" required inputMode="tel" value={newCarrier.phone} onChange={(e) => setNewCarrier((n) => ({ ...n, phone: e.target.value }))} error={newCarrier.errors.phone} help="So the carrier can be reached about this lane." placeholder="98765 43210" />
              <div className="flex gap-2">
                <Button size="sm" onClick={addCarrier} loading={newCarrier.busy}>Add carrier</Button>
                <Button size="sm" variant="ghost" onClick={() => setNewCarrier({ open: false, name: '', phone: '', errors: {}, busy: false })}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setNewCarrier((n) => ({ ...n, open: true }))}>+ Add a new carrier</Button>
          )}
        </fieldset>
        {editing !== 'new' && (
          <label className="flex min-h-[44px] items-center gap-3 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} className="h-[18px] w-[18px] accent-brand" />
            <span><strong>Lane in use</strong><span className="block text-[13px] text-ink-muted">Untick to stop booking on this lane. Past trips are kept.</span></span>
          </label>
        )}
      </Drawer>
    </>
  );
}
