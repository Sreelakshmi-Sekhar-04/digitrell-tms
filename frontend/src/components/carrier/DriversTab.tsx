'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useApi } from '@/lib/useApi';
import { LANGUAGE_LABELS, prettyPhone } from '@/lib/masters';
import { DOC_STATE_UI, DRIVER_STATUS_UI, LICENCE_CLASS_OPTIONS, prettyDate, type Driver } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState, Skeleton } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextField } from '@/components/ui/Field';
import { DataTable, td } from '@/components/masters/Table';
import { FormError, useDrawerForm } from './useDrawerForm';

type Form = { name: string; phone: string; licenceNumber: string; licenceClass: string; licenceExpiry: string; language: string; upiId: string };
const EMPTY: Form = { name: '', phone: '', licenceNumber: '', licenceClass: '', licenceExpiry: '', language: 'en', upiId: '' };
const fromDriver = (x: Driver): Form => ({
  name: x.name, phone: prettyPhone(x.phone), licenceNumber: x.licenceNumber ?? '', licenceClass: x.licenceClass ?? '',
  licenceExpiry: x.licenceExpiry ?? '', language: x.language, upiId: x.upi.id ?? '',
});

function UpiCell({ x }: { x: Driver }) {
  if (!x.upi.id) return <span className="text-ink-muted">Not added</span>;
  return (
    <div>
      <div className="whitespace-nowrap">{x.upi.id}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {x.upi.verified ? <Chip tone="success">Verified</Chip> : <Chip tone="action">Not verified</Chip>}
        {x.upi.pending && <Chip tone="action">Change waiting</Chip>}
      </div>
    </div>
  );
}

export function DriversTab({ canManage, canApproveUpi, canVerifyUpi, addSignal }: { canManage: boolean; canApproveUpi: boolean; canVerifyUpi: boolean; addSignal: number }) {
  const [showInactive, setShowInactive] = useState(false);
  const list = useApi<{ drivers: Driver[] }>(`/carrier/drivers?includeInactive=${showInactive}`);
  const d = useDrawerForm<Driver, Form>(EMPTY, fromDriver);
  const [reference, setReference] = useState('');

  useEffect(() => {
    if (addSignal > 0) d.open('new');
  }, [addSignal]);
  useEffect(() => setReference(''), [d.editing]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const res = d.isNew
      ? await d.send('/carrier/drivers', 'POST', d.form, `${d.form.name || 'Driver'} added.`)
      : await d.send<{ driver: Driver }>(`/carrier/drivers/${d.current!.id}`, 'PATCH', d.form, 'Driver saved.');
    if (res) list.reload();
  };
  const action = async (path: string, body: unknown, done: string) => {
    if (await d.send(path, 'POST', body, done)) list.reload();
  };

  if (list.loading && !list.data) return <div className="p-5"><Skeleton /></div>;
  if (list.error) return <EmptyState title="Couldn't load drivers" action={<Button variant="secondary" onClick={list.reload}>Try again</Button>}>{list.error}</EmptyState>;
  const rows = list.data?.drivers ?? [];
  const cur = d.current;
  const upiChanged = !!cur?.upi.id && d.form.upiId.trim().toLowerCase() !== cur.upi.id;

  return (
    <>
      <div className="flex justify-end px-4 pt-3">
        <label className="flex min-h-[36px] items-center gap-2 text-[13px] text-ink-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4 accent-brand" />
          Show deactivated
        </label>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No drivers yet" action={canManage ? <Button onClick={() => d.open('new')}>Add a driver</Button> : undefined}>
          Drivers get the trip, LR and status buttons on WhatsApp. They need no app or login.
        </EmptyState>
      ) : (
        <DataTable label="Drivers" headers={['Name', 'Mobile', 'Licence', 'Language', 'UPI for advances', 'Current trip', 'Status', '']}>
          {rows.map((x) => {
            const ui = DRIVER_STATUS_UI[x.status];
            return (
              <tr key={x.id} className={x.isActive ? '' : 'text-ink-muted'}>
                <td className={`${td} font-semibold`}>{x.name}</td>
                <td className={`${td} whitespace-nowrap`}>{prettyPhone(x.phone)}</td>
                <td className={`${td} whitespace-nowrap`}>
                  <div>{x.licenceClass ?? '—'} · {x.licenceState === 'EXPIRED' ? 'Expired' : 'Valid to'} {prettyDate(x.licenceExpiry)}</div>
                  <div className="text-xs text-ink-muted tabular">{x.licenceNumber ?? 'Number missing'}</div>
                </td>
                <td className={td}>{LANGUAGE_LABELS[x.language] ?? x.language}</td>
                <td className={td}><UpiCell x={x} /></td>
                <td className={td}>{x.currentTrip ?? '—'}</td>
                <td className={td}>
                  <Chip tone={ui.tone}>{ui.label}</Chip>
                  {x.status === 'BLOCKED' && <div className="mt-1 text-xs text-ink-muted">{x.note}</div>}
                </td>
                <td className={`${td} text-right`}>
                  {(canManage || canApproveUpi || canVerifyUpi) && <Button size="sm" variant="ghost" onClick={() => d.open(x)} aria-label={`Open ${x.name}`}>{canManage ? 'Edit' : 'Open'}</Button>}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}

      <Drawer
        open={d.editing !== null}
        title={d.isNew ? 'Add driver' : cur?.name ?? ''}
        subtitle="A licence that is expired or missing blocks the driver from new trips."
        dirty={d.dirty}
        onClose={d.close}
        onSubmit={save}
        footer={
          canManage ? (
            <>
              <Button type="submit" loading={d.busy}>{d.isNew ? 'Save driver' : upiChanged ? 'Save and ask for approval' : 'Save changes'}</Button>
              {cur && (
                <Button
                  variant={cur.isActive ? 'danger' : 'secondary'}
                  disabled={d.busy}
                  onClick={async () => {
                    if (await d.send(`/carrier/drivers/${cur.id}`, 'PATCH', { isActive: !cur.isActive }, cur.isActive ? `${cur.name} deactivated.` : `${cur.name} reactivated.`)) list.reload();
                  }}
                >
                  {cur.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        <FormError message={d.formError} />

        {cur?.upi.pending && (
          <div role="status" className="rounded-xl border border-[#F2D3A8] bg-tone-action-bg px-4 py-3 text-sm text-[#6B2E08]">
            <strong>UPI change waiting for a second person.</strong> {cur.upi.pending.byName} asked to change {cur.upi.id} to <strong>{cur.upi.pending.upiId}</strong>.
            {cur.upi.pending.byMe ? (
              <p className="mt-1">You asked for this change, so someone else must approve it.</p>
            ) : canApproveUpi ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button size="sm" disabled={d.busy} onClick={() => action(`/carrier/drivers/${cur.id}/upi/approve`, {}, 'UPI change approved. Verify the new ID before the next advance.')}>Approve change</Button>
                <Button size="sm" variant="secondary" disabled={d.busy} onClick={() => action(`/carrier/drivers/${cur.id}/upi/reject`, {}, 'UPI change rejected.')}>Reject</Button>
              </div>
            ) : null}
          </div>
        )}

        {cur?.upi.id && !cur.upi.verified && !cur.upi.pending && canVerifyUpi && (
          <div className="rounded-xl bg-brand-soft p-3.5 text-sm">
            <strong>Verify {cur.upi.id} before the first advance.</strong>
            <p className="mb-2.5 mt-1 text-[13px] text-ink-muted">Send ₹1 to this UPI ID from your bank app and enter the UPI reference here. Payments from DigitRell come once a payment provider is connected.</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <TextField label="UPI reference of the ₹1 payment" value={reference} onChange={(e) => setReference(e.target.value.replace(/\s/g, ''))} error={d.errors.reference} placeholder="e.g. 432198765012" />
              </div>
              <Button variant="secondary" disabled={d.busy} onClick={() => action(`/carrier/drivers/${cur.id}/upi/verify`, { reference }, 'UPI ID verified.')}>Mark verified</Button>
            </div>
          </div>
        )}

        <fieldset disabled={!canManage} className="flex flex-col gap-[18px]">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <TextField label="Name" required value={d.form.name} onChange={(e) => d.set('name', e.target.value)} error={d.errors.name} />
            <TextField label="Mobile (WhatsApp)" required inputMode="tel" value={d.form.phone} onChange={(e) => d.set('phone', e.target.value)} error={d.errors.phone} placeholder="98765 43210" help="Trip details and status buttons go here." />
          </div>
          <TextField label="Licence number" required value={d.form.licenceNumber} onChange={(e) => d.set('licenceNumber', e.target.value.toUpperCase())} error={d.errors.licenceNumber} placeholder="TN09 2019 0012345" />
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <SelectField label="Vehicle class" required value={d.form.licenceClass} onChange={(e) => d.set('licenceClass', e.target.value)} error={d.errors.licenceClass}>
              <option value="">Choose the vehicle class</option>
              {LICENCE_CLASS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SelectField>
            <div>
              <TextField label="Licence valid to" required type="date" value={d.form.licenceExpiry} onChange={(e) => d.set('licenceExpiry', e.target.value)} error={d.errors.licenceExpiry} />
              {cur && !d.dirty && <div className="mt-1"><Chip tone={DOC_STATE_UI[cur.licenceState].tone}>{DOC_STATE_UI[cur.licenceState].label}</Chip></div>}
            </div>
          </div>
          <SelectField label="Message language" value={d.form.language} onChange={(e) => d.set('language', e.target.value)} error={d.errors.language}>
            {Object.entries(LANGUAGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
          <TextField
            label="UPI ID for advances"
            optional
            value={d.form.upiId}
            onChange={(e) => d.set('upiId', e.target.value.trim())}
            error={d.errors.upiId}
            placeholder="name@okaxis"
            help={upiChanged ? 'Changing a UPI ID needs a second person to approve it.' : 'Advances are paid only to a verified UPI ID.'}
          />
        </fieldset>
      </Drawer>
    </>
  );
}
