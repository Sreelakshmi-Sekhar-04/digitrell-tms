'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { formErrors, useApi } from '@/lib/useApi';
import { ADDRESS_KIND_LABELS, prettyPhone } from '@/lib/masters';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState, Skeleton } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import { TextField } from '@/components/ui/Field';
import { ChoiceChips } from '@/components/ui/Choice';
import { useToast } from '@/components/ui/Toast';
import { DataTable, td } from './Table';
import type { Address } from './types';

type Form = { name: string; city: string; line1: string; kind: string; contactName: string; contactPhone: string; hours: string };
const EMPTY: Form = { name: '', city: '', line1: '', kind: '', contactName: '', contactPhone: '', hours: '' };
const fromAddress = (a: Address): Form => ({
  name: a.name, city: a.city, line1: a.line1, kind: a.kind, contactName: a.contactName ?? '', contactPhone: a.contactPhone ? prettyPhone(a.contactPhone) : '', hours: a.hours ?? '',
});

export function AddressesTab({ addSignal }: { addSignal: number }) {
  const [showInactive, setShowInactive] = useState(false);
  const list = useApi<{ addresses: Address[] }>(`/addresses?includeInactive=${showInactive}`);
  const toast = useToast();
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [initial, setInitial] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const open = (a: Address | 'new') => {
    const f = a === 'new' ? EMPTY : fromAddress(a);
    setForm(f);
    setInitial(f);
    setErrors({});
    setFormError('');
    setEditing(a);
  };
  useEffect(() => {
    if (addSignal > 0) open('new');
  }, [addSignal]);

  const set = (k: keyof Form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const submit = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setFormError('');
    try {
      const isNew = editing === 'new';
      await api(isNew ? '/addresses' : `/addresses/${(editing as Address).id}`, { method: isNew ? 'POST' : 'PATCH', json: body });
      toast({ tone: 'success', title: done });
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

  const save = (e: FormEvent) => {
    e.preventDefault();
    submit(form, editing === 'new' ? `${form.name || 'Address'} added.` : 'Address saved.');
  };

  if (list.loading && !list.data) return <div className="p-5"><Skeleton /></div>;
  if (list.error) return <EmptyState title="Couldn't load addresses" action={<Button variant="secondary" onClick={list.reload}>Try again</Button>}>{list.error}</EmptyState>;
  const rows = list.data?.addresses ?? [];
  const current = editing && editing !== 'new' ? editing : null;

  return (
    <>
      <div className="flex justify-end px-4 pt-3">
        <label className="flex min-h-[36px] items-center gap-2 text-[13px] text-ink-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4 accent-brand" />
          Show deactivated
        </label>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No saved addresses" action={<Button onClick={() => open('new')}>Add an address</Button>}>
          Save your pickup and drop points once; bookings then pick them from a list.
        </EmptyState>
      ) : (
        <DataTable label="Addresses" headers={['Name', 'City', 'Type', 'Contact', 'Hours', 'Status', '']}>
          {rows.map((a) => (
            <tr key={a.id} className={a.isActive ? '' : 'text-ink-muted'}>
              <td className={td}><div className="font-semibold">{a.name}</div><div className="text-xs text-ink-muted">{a.line1}</div></td>
              <td className={td}>{a.city}</td>
              <td className={td}>{ADDRESS_KIND_LABELS[a.kind] ?? a.kind}</td>
              <td className={td}>{a.contactName || a.contactPhone ? <>{a.contactName ?? ''}{a.contactName && a.contactPhone ? ' · ' : ''}{a.contactPhone ? prettyPhone(a.contactPhone) : ''}</> : '—'}</td>
              <td className={td}>{a.hours || '—'}</td>
              <td className={td}>{a.isActive ? <Chip tone="success">Active</Chip> : <Chip tone="neutral">Deactivated</Chip>}</td>
              <td className={`${td} text-right`}><Button size="sm" variant="ghost" onClick={() => open(a)} aria-label={`Edit ${a.name}`}>Edit</Button></td>
            </tr>
          ))}
        </DataTable>
      )}

      <Drawer
        open={editing !== null}
        title={editing === 'new' ? 'Add address' : 'Edit address'}
        subtitle="Saved addresses appear as choices when you book."
        dirty={JSON.stringify(form) !== JSON.stringify(initial)}
        onClose={() => setEditing(null)}
        onSubmit={save}
        footer={
          <>
            <Button type="submit" loading={busy}>{editing === 'new' ? 'Save address' : 'Save changes'}</Button>
            {current && (
              <Button variant={current.isActive ? 'danger' : 'secondary'} disabled={busy} onClick={() => submit({ isActive: !current.isActive }, current.isActive ? `${current.name} deactivated.` : `${current.name} reactivated.`)}>
                {current.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            )}
          </>
        }
      >
        {formError && <p role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]">{formError}</p>}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <TextField label="Short name" required value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} placeholder="e.g. Ambattur DC" />
          <TextField label="City" required value={form.city} onChange={(e) => set('city', e.target.value)} error={errors.city} placeholder="e.g. Chennai" />
        </div>
        <TextField label="Street address" required value={form.line1} onChange={(e) => set('line1', e.target.value)} error={errors.line1} placeholder="Plot, street, area" />
        <ChoiceChips label="Used for" required options={Object.entries(ADDRESS_KIND_LABELS).map(([value, label]) => ({ value, label }))} value={form.kind} onChange={(v) => set('kind', v)} error={errors.kind} />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <TextField label="Contact name" optional value={form.contactName} onChange={(e) => set('contactName', e.target.value)} error={errors.contactName} />
          <TextField label="Contact mobile" optional inputMode="tel" value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} error={errors.contactPhone} placeholder="98765 43210" help="Gets the ETA and delivery code." />
        </div>
        <TextField label="Working hours" optional value={form.hours} onChange={(e) => set('hours', e.target.value)} error={errors.hours} placeholder="e.g. 08:00–20:00" />
      </Drawer>
    </>
  );
}
