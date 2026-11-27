'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formErrors, useApi } from '@/lib/useApi';
import { carrierRoleLabel, hasRole } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Card';
import { SelectField, TextField } from '@/components/ui/Field';
import { fromRupeeInput, toRupeeInput } from '@/components/ui/Choice';
import { useToast } from '@/components/ui/Toast';

type Agent = 'quote' | 'truckAssignment' | 'documents' | 'billing';
interface Policy {
  bandPct: number;
  marginFloorPct: number;
  invoiceApprovalAbove: number;
  backupApproverId: string | null;
  autonomy: Record<Agent, number>;
  approvers: { id: string; name: string; roles: string[] }[];
}
type Form = { bandPct: string; marginFloorPct: string; invoiceApprovalAbove: string; backupApproverId: string; autonomy: Record<Agent, number> };

// From the design (carrier Policies): the four carrier agents and their one-line jobs.
const AGENTS: { id: Agent; name: string; desc: string }[] = [
  { id: 'quote', name: 'Quote', desc: 'Prices quote requests from your rate card' },
  { id: 'truckAssignment', name: 'Truck assignment', desc: 'Proposes a free truck and driver' },
  { id: 'documents', name: 'Documents', desc: 'Issues LR and e-way bill' },
  { id: 'billing', name: 'Billing', desc: 'Prepares invoices after POD' },
];
const LEVELS = ['Suggest only', 'Ask first', 'Act within limits'];
const toForm = (p: Policy): Form => ({
  bandPct: String(p.bandPct), marginFloorPct: String(p.marginFloorPct), invoiceApprovalAbove: toRupeeInput(String(p.invoiceApprovalAbove)),
  backupApproverId: p.backupApproverId ?? '', autonomy: { ...p.autonomy },
});

export default function CarrierPoliciesPage() {
  const { user } = useAuth();
  const canEdit = hasRole(user, 'OWNER');
  const res = useApi<{ policy: Policy }>('/carrier/policies');
  const toast = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (res.data) setForm(toForm(res.data.policy));
  }, [res.data]);

  if (res.loading && !res.data) return <div className="max-w-md"><Skeleton /></div>;
  if (res.error || !res.data || !form) return <Card><EmptyState title="Couldn't load policies" action={<Button variant="secondary" onClick={res.reload}>Try again</Button>}>{res.error}</EmptyState></Card>;
  const policy = res.data.policy;
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(policy));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    setErrors({});
    try {
      const out = await api<{ policy: Policy }>('/carrier/policies', {
        method: 'PUT',
        json: {
          bandPct: form.bandPct, marginFloorPct: form.marginFloorPct, invoiceApprovalAbove: fromRupeeInput(form.invoiceApprovalAbove),
          backupApproverId: form.backupApproverId || null, autonomy: form.autonomy,
        },
      });
      res.setData(out);
      toast({ tone: 'success', title: 'Policies saved.', text: 'Logged with your name and time.' });
    } catch (err) {
      const { fields, message } = formErrors(err);
      setErrors(fields);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-5">
      <PageHeader title="Policies" subtitle={canEdit ? 'Decide what your agents may do alone, and your pricing and approval limits.' : 'Only the owner can change these. You can see them here.'} />
      {formError && <p role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]">{formError}</p>}

      <Card className="p-5">
        <h2 className="text-[17px] font-semibold">What each agent may do</h2>
        <p className="mb-3 mt-1 text-[13px] text-ink-muted">Suggest only = drafts for you. Ask first = acts after your one-tap approval. Act within limits = acts alone inside the limits below.</p>
        {AGENTS.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line-faint py-3 last:border-0">
            <div>
              <div className="font-semibold">{a.name}</div>
              <div className="text-[13px] text-ink-muted">{a.desc}</div>
            </div>
            <div role="radiogroup" aria-label={`${a.name} autonomy`} className="inline-flex flex-wrap overflow-hidden rounded-btn border border-line-strong bg-white">
              {LEVELS.map((label, lvl) => {
                const on = form.autonomy[a.id] === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={!canEdit}
                    onClick={() => setForm({ ...form, autonomy: { ...form.autonomy, [a.id]: lvl } })}
                    className={`min-h-[40px] border-r border-line-strong px-3.5 text-[13px] font-semibold last:border-r-0 disabled:cursor-not-allowed ${on ? 'bg-brand text-white' : 'text-ink-soft'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {errors[`autonomy.${a.id}`] && <p role="alert" className="w-full text-xs font-semibold text-tone-danger">{errors[`autonomy.${a.id}`]}</p>}
          </div>
        ))}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3.5 text-[17px] font-semibold">Pricing and limits</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField label="Rate band around rate card (± %)" required inputMode="decimal" disabled={!canEdit} value={form.bandPct} onChange={(e) => setForm({ ...form, bandPct: e.target.value.replace(/[^\d.]/g, '') })} error={errors.bandPct} help="Default band for new rate cards. Quotes inside the band can go out automatically." />
          <TextField label="Margin floor (%)" required inputMode="decimal" disabled={!canEdit} value={form.marginFloorPct} onChange={(e) => setForm({ ...form, marginFloorPct: e.target.value.replace(/[^\d.]/g, '') })} error={errors.marginFloorPct} help="No quote is sent below this margin." />
          <TextField label="Invoices need approval above (₹)" required inputMode="numeric" disabled={!canEdit} value={form.invoiceApprovalAbove} onChange={(e) => setForm({ ...form, invoiceApprovalAbove: toRupeeInput(e.target.value) })} error={errors.invoiceApprovalAbove} help="Smaller invoices go when the shipper's POD rule is met." />
          <SelectField label="Backup approver" optional disabled={!canEdit} value={form.backupApproverId} onChange={(e) => setForm({ ...form, backupApproverId: e.target.value })} error={errors.backupApproverId} help="Gets reminders when an approval waits more than 2 hours.">
            <option value="">No backup</option>
            {policy.approvers.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.roles.map(carrierRoleLabel).join(', ')}</option>)}
          </SelectField>
        </div>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="submit" loading={busy} disabled={!dirty}>Save changes</Button>
          <Button variant="secondary" disabled={!dirty || busy} onClick={() => { setForm(toForm(policy)); setErrors({}); setFormError(''); }}>Discard</Button>
          {dirty && <span className="text-[13px] text-ink-muted">You have unsaved changes.</span>}
        </div>
      )}
    </form>
  );
}
