'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formErrors, useApi } from '@/lib/useApi';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { RadioCards, fromRupeeInput, toRupeeInput } from '@/components/ui/Choice';
import { useToast } from '@/components/ui/Toast';

type Agent = 'intake' | 'tender' | 'bidEvaluation' | 'billing';
interface Policy {
  paymentApprovalAbove: number;
  quoteWindowHours: number;
  podRule: string;
  autonomy: Record<Agent, number>;
  maxAutonomy: Record<Agent, number>;
}
type Form = { paymentApprovalAbove: string; quoteWindowHours: string; podRule: string; autonomy: Record<Agent, number> };

const AGENTS: { id: Agent; name: string; desc: string }[] = [
  { id: 'intake', name: 'Intake', desc: 'Reads bookings from WhatsApp, email and voice notes' },
  { id: 'tender', name: 'Tender', desc: 'Sends quote requests to approved carriers' },
  { id: 'bidEvaluation', name: 'Bid evaluation', desc: 'Recommends and records the award' },
  { id: 'billing', name: 'Billing', desc: 'Prepares payments of carrier invoices' },
];
const LEVELS = ['Suggest only', 'Ask first', 'Act within limits'];
const toForm = (p: Policy): Form => ({ paymentApprovalAbove: toRupeeInput(String(p.paymentApprovalAbove)), quoteWindowHours: String(p.quoteWindowHours), podRule: p.podRule, autonomy: { ...p.autonomy } });

export default function PoliciesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'LOGISTICS_HEAD';
  const res = useApi<{ policy: Policy }>('/policies');
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
      const out = await api<{ policy: Policy }>('/policies', {
        method: 'PUT',
        json: { paymentApprovalAbove: fromRupeeInput(form.paymentApprovalAbove), quoteWindowHours: Number(form.quoteWindowHours), podRule: form.podRule, autonomy: form.autonomy },
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
      <PageHeader title="Policies and approvals" subtitle={canEdit ? 'Decide what agents may do alone. Changes apply to new bookings.' : 'Only the logistics head can change these. You can see them here.'} />
      {formError && <p role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]">{formError}</p>}

      <Card className="p-5">
        <h2 className="text-[17px] font-semibold">What each agent may do</h2>
        <p className="mb-3 mt-1 text-[13px] text-ink-muted">Suggest only = drafts for you. Ask first = acts after your one-tap approval. Act within limits = acts alone below the limits below.</p>
        {AGENTS.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line-faint py-3 last:border-0">
            <div>
              <div className="font-semibold">{a.name}</div>
              <div className="text-[13px] text-ink-muted">{a.desc}</div>
            </div>
            <div role="radiogroup" aria-label={`${a.name} autonomy`} className="inline-flex overflow-hidden rounded-btn border border-line-strong bg-white">
              {LEVELS.map((label, lvl) => {
                const on = form.autonomy[a.id] === lvl;
                const locked = lvl > policy.maxAutonomy[a.id];
                return (
                  <button
                    key={lvl}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={!canEdit || locked}
                    title={locked ? 'In this release this agent always asks before it acts.' : undefined}
                    onClick={() => setForm({ ...form, autonomy: { ...form.autonomy, [a.id]: lvl } })}
                    className={`min-h-[40px] border-r border-line-strong px-3.5 text-[13px] font-semibold last:border-r-0 disabled:cursor-not-allowed ${on ? 'bg-brand text-white' : 'text-ink-soft'} ${locked ? 'opacity-40' : ''}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {errors[`autonomy.${a.id}`] && <p role="alert" className="w-full text-xs font-semibold text-tone-danger">{errors[`autonomy.${a.id}`]}</p>}
          </div>
        ))}
        <p className="mt-3 text-[13px] text-ink-muted">Awards are always approved by a person in this release, except on lanes you set to automatic award.</p>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3.5 text-[17px] font-semibold">Limits</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField label="Payments need approval above (₹)" required inputMode="numeric" disabled={!canEdit} value={form.paymentApprovalAbove} onChange={(e) => setForm({ ...form, paymentApprovalAbove: toRupeeInput(e.target.value) })} error={errors.paymentApprovalAbove} help="Smaller invoices are paid when the POD is accepted, if Billing may act within limits." />
          <TextField label="Quote window (hours)" required inputMode="numeric" disabled={!canEdit} value={form.quoteWindowHours} onChange={(e) => setForm({ ...form, quoteWindowHours: e.target.value.replace(/[^\d]/g, '').slice(0, 2) })} error={errors.quoteWindowHours} help="How long carriers have to quote. You can change it on each booking." />
        </div>
        <div className="mt-4">
          <RadioCards
            label="Proof of delivery (POD) rule"
            options={[
              { value: 'DIGITAL', label: 'Digital photo accepted', help: 'Bill as soon as the signed LR photo is accepted.', disabled: !canEdit },
              { value: 'HARD_COPY', label: 'Hard copy required', help: 'Bill only after the original LR reaches you by courier.', disabled: !canEdit },
              { value: 'BOTH', label: 'Both', help: 'Photo to start billing checks; hard copy before payment.', disabled: !canEdit },
            ]}
            value={form.podRule}
            onChange={(v) => setForm({ ...form, podRule: v })}
            error={errors.podRule}
          />
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
