'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { formErrors, useApi } from '@/lib/useApi';
import { GST_OPTION_LABELS, prettyDate, type CarrierProfile } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { EmptyState, Skeleton } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { RadioCards } from '@/components/ui/Choice';
import { useToast } from '@/components/ui/Toast';
import { FormError } from './useDrawerForm';
import { LrSeriesCard } from './LrSeriesCard';

type Form = { address: string; gstin: string; pan: string; gstOption: string; tdsDeclared: boolean; bankAccountName: string; bankAccountNo: string; bankIfsc: string };
const fromProfile = (p: CarrierProfile): Form => ({
  address: p.address ?? '', gstin: p.gstin ?? '', pan: p.pan ?? '', gstOption: p.gstOption ?? '', tdsDeclared: p.tdsDeclared,
  bankAccountName: p.bankAccountName ?? '', bankAccountNo: p.bankAccountNo ?? '', bankIfsc: p.bankIfsc ?? '',
});

/** Company profile, tax and bank (carrier spec C3). The owner edits; others view. */
export function ProfileTab({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const res = useApi<{ profile: CarrierProfile }>('/carrier/profile');
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (res.data) setForm(fromProfile(res.data.profile));
  }, [res.data]);

  if (res.loading && !res.data) return <div className="p-5"><Skeleton /></div>;
  if (res.error || !res.data || !form) return <EmptyState title="Couldn't load your profile" action={<Button variant="secondary" onClick={res.reload}>Try again</Button>}>{res.error}</EmptyState>;
  const p = res.data.profile;
  const dirty = JSON.stringify(form) !== JSON.stringify(fromProfile(p));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f!, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const body: Record<string, unknown> = { ...form };
      const out = await api<{ profile: CarrierProfile }>('/carrier/profile', { method: 'PUT', json: body });
      res.setData(out);
      toast({ tone: 'success', title: 'Profile saved.', text: 'Logged with your name and time.' });
    } catch (err) {
      const { fields, message } = formErrors(err);
      setErrors(fields);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <form onSubmit={save} noValidate className="flex flex-col gap-5 p-4 sm:p-5">
      {p.missing.length > 0 && (
        <p role="status" className="rounded-xl bg-tone-action-bg px-4 py-3 text-sm text-[#6B2E08]">
          <strong>Still needed:</strong> {p.missing.join(', ')}. Shippers need these to pay your invoices.
        </p>
      )}
      <FormError message={formError} />
      <fieldset disabled={!canManage} className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-3.5 rounded-xl border border-line p-4">
          <h2 className="text-base font-bold">Company and tax</h2>
          <TextField label="Company name" value={p.name} readOnly help="Ask DigitRell support to change the registered name." />
          <TextField label="Registered address" optional value={form.address} onChange={(e) => set('address', e.target.value)} error={errors.address} />
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <TextField label="GSTIN" optional value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} error={errors.gstin} placeholder="33ABCDE1234F1Z5" />
            <TextField label="PAN" optional value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} error={errors.pan} placeholder="ABCDE1234F" />
          </div>
          <RadioCards label="GST on freight" options={Object.entries(GST_OPTION_LABELS).map(([value, label]) => ({ value, label }))} value={form.gstOption} onChange={(v) => set('gstOption', v)} error={errors.gstOption} />
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line-strong px-3.5 py-3 text-sm">
            <input type="checkbox" checked={form.tdsDeclared} onChange={(e) => set('tdsDeclared', e.target.checked)} className="mt-0.5 h-[18px] w-[18px] accent-brand" />
            <span>
              <strong>We own 10 or fewer goods carriages (TDS declaration, section 194C)</strong>
              <span className="block text-[13px] text-ink-muted">
                With this and your PAN, shippers don't deduct TDS. {p.tdsDeclared && p.tdsDeclaredAt ? `Declared on ${prettyDate(p.tdsDeclaredAt)}.` : 'Renew it every financial year.'}
              </span>
            </span>
          </label>
          {errors.tdsDeclared && <p role="alert" className="text-xs font-semibold text-tone-danger">{errors.tdsDeclared}</p>}
        </section>

        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-3.5 rounded-xl border border-line p-4">
            <h2 className="text-base font-bold">Bank account for payments</h2>
            <TextField label="Account name" optional value={form.bankAccountName} onChange={(e) => set('bankAccountName', e.target.value)} error={errors.bankAccountName} help="Should match the name on your GSTIN." />
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <TextField label="Account number" optional inputMode="numeric" value={form.bankAccountNo} onChange={(e) => set('bankAccountNo', e.target.value.replace(/[^\d]/g, ''))} error={errors.bankAccountNo} />
              <TextField label="IFSC" optional value={form.bankIfsc} onChange={(e) => set('bankIfsc', e.target.value.toUpperCase())} error={errors.bankIfsc} placeholder="HDFC0001234" />
            </div>
          </section>
        </div>
      </fieldset>
      {canManage ? (
        <div className="flex gap-2.5">
          <Button type="submit" loading={busy} disabled={!dirty}>Save profile</Button>
          {dirty && <Button variant="ghost" onClick={() => { setForm(fromProfile(p)); setErrors({}); setFormError(''); }}>Undo changes</Button>}
        </div>
      ) : (
        <p className="text-[13px] text-ink-muted">Only the owner can change the company profile.</p>
      )}
    </form>
    <LrSeriesCard canManage={canManage} />
    </>
  );
}
