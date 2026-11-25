'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { CHANNEL_LABELS, LANGUAGE_LABELS } from '@/lib/masters';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';

interface Messages {
  language: string;
  channel: string;
  quietHours: string;
  prefs: Record<string, boolean>;
}
const TYPES = [
  { id: 'truckConfirmed', label: 'Truck and driver confirmed' },
  { id: 'tracking', label: 'Loaded, ETA changes and delays' },
  { id: 'delivered', label: 'Delivered and POD' },
  { id: 'dailySummary', label: 'Daily summary at 19:00' },
  { id: 'invoices', label: 'Invoices and payment reminders' },
];

/** "Profile › My messages" from the design: language, channel, quiet hours and which updates you get. */
export default function MyMessagesPage() {
  const toast = useToast();
  const res = useApi<{ messages: Messages }>('/profile/messages');
  const [form, setForm] = useState<Messages | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (res.data) setForm(res.data.messages);
  }, [res.data]);

  if (res.loading && !form) return <Skeleton lines={4} />;
  if (res.error || !form) return <Card><EmptyState title="Couldn't load your settings" action={<Button variant="secondary" onClick={res.reload}>Try again</Button>}>{res.error}</EmptyState></Card>;
  const dirty = JSON.stringify(form) !== JSON.stringify(res.data?.messages);

  const save = async () => {
    setBusy(true);
    try {
      const out = await api<{ messages: Messages }>('/profile/messages', { method: 'PUT', json: form });
      res.setData(out);
      toast({ tone: 'success', title: 'Message settings saved.' });
    } catch (err) {
      setErrors(err instanceof ApiError ? err.body.fields ?? {} : {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-[900px] flex-col gap-5">
      <PageHeader title="My messages" subtitle="How and when DigitRell messages you. Approvals always come through: they're how work moves." />
      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
        <Card className="flex flex-col gap-4 p-5">
          <SelectField label="Message language" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} error={errors.language} help="Button labels and document cover notes use this language too.">
            {Object.entries(LANGUAGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
          <SelectField label="Send to" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} error={errors.channel}>
            {Object.entries(CHANNEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
          <SelectField label="Quiet hours" value={form.quietHours} onChange={(e) => setForm({ ...form, quietHours: e.target.value })} error={errors.quietHours} help="Messages wait until morning; urgent problems still come through.">
            <option value="">None</option>
            <option value="22:00-07:00">22:00 – 07:00</option>
            <option value="21:00-08:00">21:00 – 08:00</option>
            <option value="23:00-06:00">23:00 – 06:00</option>
          </SelectField>
        </Card>
        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">What you get</h2>
          <div className="mt-2 flex items-center justify-between gap-3 border-b border-line-faint py-3 text-sm"><span>Approvals for me</span><span className="text-[13px] text-ink-muted">Always on</span></div>
          {TYPES.map((t) => {
            const on = !!form.prefs[t.id];
            return (
              <div key={t.id} className="flex items-center justify-between gap-3 border-b border-line-faint py-3 text-sm last:border-0">
                <span id={`lbl-${t.id}`}>{t.label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-labelledby={`lbl-${t.id}`}
                  onClick={() => setForm({ ...form, prefs: { ...form.prefs, [t.id]: !on } })}
                  className={`relative h-[26px] w-11 flex-none rounded-full transition-colors ${on ? 'bg-brand' : 'bg-[#B8C4C0]'}`}
                >
                  <span aria-hidden="true" className={`absolute top-[3px] h-5 w-5 rounded-full bg-white transition-all ${on ? 'right-[3px]' : 'left-[3px]'}`} />
                </button>
              </div>
            );
          })}
        </Card>
      </div>
      <div className="flex gap-2.5">
        <Button onClick={save} loading={busy} disabled={!dirty}>Save</Button>
        <Button variant="secondary" disabled={!dirty || busy} onClick={() => { setForm(res.data!.messages); setErrors({}); }}>Discard</Button>
      </div>
    </div>
  );
}
