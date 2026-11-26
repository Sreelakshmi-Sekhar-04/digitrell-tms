'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { formErrors, useApi } from '@/lib/useApi';
import { prettyPhone } from '@/lib/masters';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState, Skeleton } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { DataTable, td } from './Table';
import type { Carrier } from './types';

type Form = {
  name: string; phone: string; contactName: string; contactPhone: string; email: string;
  city: string; address: string; gstin: string; pan: string; notes: string; isActive: boolean;
};
const EMPTY: Form = { name: '', phone: '', contactName: '', contactPhone: '', email: '', city: '', address: '', gstin: '', pan: '', notes: '', isActive: true };
const fromCarrier = (c: Carrier): Form => ({
  name: c.name, phone: c.phone ? prettyPhone(c.phone) : '', contactName: c.contactName ?? '', contactPhone: c.contactPhone ? prettyPhone(c.contactPhone) : '',
  email: c.email ?? '', city: c.city ?? '', address: c.address ?? '', gstin: c.gstin ?? '', pan: c.pan ?? '', notes: c.notes ?? '', isActive: c.isActive,
});

function carrierStatus(c: Carrier) {
  if (!c.isActive) return <Chip tone="neutral">Not in use</Chip>;
  if (c.status === 'INVITED') return <Chip tone="action">Invited</Chip>;
  return <Chip tone="success">On DigitRell</Chip>;
}

/** Carrier master: the carriers this shipper works with, their contacts, and a link to each rate card. */
export function CarriersTab({ canManage, addSignal, onOpenRateCard }: { canManage: boolean; addSignal: number; onOpenRateCard: (carrierId: string) => void }) {
  const list = useApi<{ carriers: Carrier[] }>('/carriers');
  const toast = useToast();
  const [editing, setEditing] = useState<Carrier | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [initial, setInitial] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const open = (c: Carrier | 'new') => {
    const f = c === 'new' ? EMPTY : fromCarrier(c);
    setForm(f);
    setInitial(f);
    setErrors({});
    setFormError('');
    setEditing(c);
  };

  useEffect(() => {
    if (addSignal > 0 && canManage) open('new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSignal]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const current = editing && editing !== 'new' ? editing : null;
  const identityLocked = !!current && !current.canEditIdentity;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    // Send only what changed when editing, so a locked name or mobile is never sent back.
    const body: Record<string, unknown> = editing === 'new'
      ? form
      : Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== initial[k as keyof Form]));
    try {
      const isNew = editing === 'new';
      const res = await api<{ carrier: Carrier; alreadyOnDigitRell?: boolean }>(isNew ? '/carriers' : `/carriers/${current!.id}`, { method: isNew ? 'POST' : 'PATCH', json: body });
      toast(
        isNew
          ? { tone: 'success', title: `${res.carrier.name} added.`, text: res.alreadyOnDigitRell ? 'They are already on DigitRell. Add their rate card and approve them on lanes.' : 'Next: add their rate card and approve them on lanes.' }
          : { tone: 'success', title: 'Carrier saved.' },
      );
      setEditing(null);
      list.reload();
    } catch (err) {
      const { fields, message } = formErrors(err);
      setErrors(fields);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  };

  if (list.loading && !list.data) return <div className="p-5"><Skeleton /></div>;
  if (list.error) return <EmptyState title="Couldn't load carriers" action={<Button variant="secondary" onClick={list.reload}>Try again</Button>}>{list.error}</EmptyState>;
  const rows = list.data?.carriers ?? [];

  return (
    <>
      {rows.length === 0 ? (
        <EmptyState title="No carriers yet" action={canManage ? <Button onClick={() => open('new')}>Add your first carrier</Button> : undefined}>
          Add the transport companies you work with. Then give each one a rate card and approve them on your lanes.
        </EmptyState>
      ) : (
        <DataTable label="Carriers" headers={['Carrier', 'Contact', 'City', 'GSTIN', 'Lanes', 'Rate card', 'Status', '']}>
          {rows.map((c) => (
            <tr key={c.id} className={c.isActive ? '' : 'text-ink-muted'}>
              <td className={td}>
                <span className="block font-semibold">{c.name}</span>
                <span className="block text-xs text-ink-muted">Owner {prettyPhone(c.phone)}</span>
              </td>
              <td className={td}>
                {c.contactName || c.contactPhone ? (
                  <>
                    <span className="block">{c.contactName ?? '—'}</span>
                    {c.contactPhone && <span className="block text-xs text-ink-muted">{prettyPhone(c.contactPhone)}</span>}
                  </>
                ) : <span className="text-ink-muted">—</span>}
              </td>
              <td className={td}>{c.city ?? <span className="text-ink-muted">—</span>}</td>
              <td className={`${td} tabular text-[13px]`}>{c.gstin ?? <span className="text-ink-muted">—</span>}</td>
              <td className={`${td} tabular`}>{c.approvedLanes}</td>
              <td className={td}>
                <button type="button" onClick={() => onOpenRateCard(c.id)} className="text-left font-semibold text-brand underline-offset-2 hover:underline" aria-label={`Rate card for ${c.name}`}>
                  {c.rateCard ? `${c.rateCard.rates} rate${c.rateCard.rates === 1 ? '' : 's'}` : canManage ? 'Add rate card' : 'None'}
                </button>
              </td>
              <td className={td}>{carrierStatus(c)}</td>
              <td className={`${td} text-right`}>{canManage && <Button size="sm" variant="ghost" onClick={() => open(c)} aria-label={`Edit ${c.name}`}>Edit</Button>}</td>
            </tr>
          ))}
        </DataTable>
      )}

      <Drawer
        open={editing !== null}
        title={editing === 'new' ? 'Add carrier' : 'Edit carrier'}
        subtitle={editing === 'new' ? 'If the carrier is already on DigitRell, it is added to your list as is.' : 'Contact details and notes here are yours; other shippers don’t see them.'}
        dirty={dirty}
        onClose={() => setEditing(null)}
        onSubmit={save}
        footer={<Button type="submit" loading={busy}>{editing === 'new' ? 'Save carrier' : 'Save changes'}</Button>}
      >
        {formError && <p role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]">{formError}</p>}
        <TextField label="Carrier company name" required value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} disabled={identityLocked} placeholder="e.g. Kaveri Roadlines" />
        <TextField
          label="Owner's mobile"
          required
          inputMode="tel"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          error={errors.phone}
          disabled={identityLocked}
          placeholder="98765 43210"
          help={identityLocked ? 'Set by the carrier on DigitRell.' : 'Quote requests and trip updates go to this number.'}
        />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <TextField label="Contact person" optional value={form.contactName} onChange={(e) => set('contactName', e.target.value)} error={errors.contactName} placeholder="Who you deal with" />
          <TextField label="Contact mobile" optional inputMode="tel" value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} error={errors.contactPhone} placeholder="98765 43210" />
          <TextField label="Email" optional type="email" value={form.email} onChange={(e) => set('email', e.target.value)} error={errors.email} placeholder="ops@carrier.com" />
          <TextField label="City" optional value={form.city} onChange={(e) => set('city', e.target.value)} error={errors.city} placeholder="e.g. Chennai" />
        </div>
        <TextField label="Office address" optional value={form.address} onChange={(e) => set('address', e.target.value)} error={errors.address} />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <TextField label="GSTIN" optional value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} error={errors.gstin} placeholder="33AABCK1234F1Z5" maxLength={15} help="Checked against their invoices." />
          <TextField label="PAN" optional value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} error={errors.pan} placeholder="AABCK1234F" maxLength={10} />
        </div>
        <TextField label="Notes" optional value={form.notes} onChange={(e) => set('notes', e.target.value)} error={errors.notes} placeholder="e.g. Good on south lanes; slow with PODs" />
        {editing !== 'new' && (
          <div>
            <label className="flex min-h-[44px] items-center gap-3 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} className="h-[18px] w-[18px] accent-brand" />
              <span><strong>Carrier in use</strong><span className="block text-[13px] text-ink-muted">Untick to stop approving them on lanes. Past trips are kept.</span></span>
            </label>
            {errors.isActive && <p role="alert" className="mt-1.5 text-xs font-semibold text-tone-danger">{errors.isActive}</p>}
          </div>
        )}
      </Drawer>
    </>
  );
}
