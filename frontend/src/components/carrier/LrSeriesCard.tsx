'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formErrors, useApi } from '@/lib/useApi';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';

type Series = { prefix: string; nextNumber: number; preview: string; inUse: boolean } | null;

/** The carrier's LR series: prefix and next number. Locked once an LR has been issued (numbers are never reused). */
export function LrSeriesCard({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const res = useApi<{ lrSeries: Series }>('/carrier/lr-series');
  const [prefix, setPrefix] = useState('');
  const [next, setNext] = useState('1');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const series = res.data?.lrSeries ?? null;

  useEffect(() => {
    if (res.data) {
      setPrefix(res.data.lrSeries?.prefix ?? '');
      setNext(String(res.data.lrSeries?.nextNumber ?? 1));
    }
  }, [res.data]);

  if (res.loading && !res.data) return <div className="p-5"><Skeleton /></div>;
  const locked = !!series?.inUse;
  const dirty = !series || prefix !== series.prefix || Number(next) !== series.nextNumber;

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const out = await api<{ lrSeries: Series }>('/carrier/lr-series', { method: 'PUT', json: { prefix, nextNumber: next ? Number(next) : undefined } });
      res.setData(out);
      toast({ tone: 'success', title: 'LR series saved.' });
    } catch (err) {
      setErrors(formErrors(err).fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="lr-series" className="mx-4 mb-5 flex flex-col gap-3.5 rounded-xl border border-line p-4 sm:mx-5">
      <h2 className="text-base font-bold">LR series</h2>
      {!series && <p role="status" className="rounded-xl bg-tone-action-bg px-4 py-3 text-sm text-[#6B2E08]">Set your LR series before issuing an LR.</p>}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <TextField label="Prefix" value={prefix} disabled={!canManage || locked} onChange={(e) => { setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)); setErrors({}); }} error={errors.prefix} placeholder="KR" help="2 to 6 letters or digits." />
        <TextField label="Next number" inputMode="numeric" value={next} disabled={!canManage || locked} onChange={(e) => { setNext(e.target.value.replace(/\D/g, '').slice(0, 6)); setErrors({}); }} error={errors.nextNumber} help={series ? `Next LR: ${series.preview}` : undefined} />
      </div>
      {locked && <p className="text-[13px] text-ink-muted">LRs have been issued, so the series is locked. Numbers are never reused.</p>}
      {canManage ? (!locked && <div><Button loading={busy} disabled={!dirty || !prefix} onClick={save}>Save LR series</Button></div>) : <p className="text-[13px] text-ink-muted">Only the owner can change the LR series.</p>}
    </section>
  );
}
