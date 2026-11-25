'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/useApi';
import { rupees } from '@/lib/masters';
import { ago } from '@/lib/trips';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { DataTable, td } from '@/components/masters/Table';

interface Item {
  id: string;
  kind: string;
  kindLabel: string;
  tripId: string;
  ref: string;
  summary: string;
  reason: string;
  amount: number;
  quoted?: number;
  asked?: number;
  createdAt: string;
}

export default function ApprovalsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const res = useApi<{ approvals: Item[] }>('/approvals');
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const limit = user?.approvalLimit ?? null;

  const refresh = () => {
    res.reload();
    window.dispatchEvent(new Event('dtms:approvals-changed'));
  };

  const approve = async (a: Item) => {
    setBusy(a.id);
    try {
      await api(`/approvals/${a.id}/approve`, { method: 'POST' });
      if (a.kind === 'EXCEPTION') toast({ tone: 'success', title: `${a.ref}: fix approved.`, text: 'The carrier goes ahead; you get the new ETA.' });
      else if (a.kind === 'PAYMENT') toast({ tone: 'success', title: `Invoice ${a.ref} approved.`, text: 'Record the payment on the trip when it is done.' });
      else toast({ tone: 'success', title: `${a.ref} awarded.`, text: 'Other carriers are told after 10 minutes. Truck details follow.' });
    } catch (err) {
      toast({ tone: 'error', title: err instanceof ApiError ? err.body.message : 'Could not approve.' });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const reject = async (a: Item) => {
    if (!reason.trim()) return setReasonError('Say why. It is logged with the trip.');
    setBusy(a.id);
    try {
      await api(`/approvals/${a.id}/reject`, { method: 'POST', json: { reason } });
      if (a.kind === 'EXCEPTION') toast({ tone: 'success', title: `${a.ref}: fix rejected.`, text: 'The carrier is asked for another option.' });
      else if (a.kind === 'PAYMENT') toast({ tone: 'success', title: `Invoice ${a.ref} queried.`, text: 'The carrier is asked for a corrected invoice.' });
      else toast({ tone: 'success', title: `${a.ref}: quotes rejected.`, text: 'The same carriers are asked again with a new deadline.' });
      setRejecting(null);
      setReason('');
    } catch (err) {
      setReasonError(err instanceof ApiError ? err.body.fields?.reason ?? err.body.message : 'Could not reject.');
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const items = res.data?.approvals ?? [];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Approvals" subtitle="Each item shows the agent's recommendation and the reason. Nothing that costs money happens until you approve." />
      {limit == null && <p className="rounded-xl bg-tone-progress-bg px-4 py-3 text-sm text-[#0B3F60]">Your role can see approvals but not decide them. Your logistics head and approvers get them on WhatsApp too.</p>}
      <Card className="overflow-hidden">
        {res.loading && !res.data ? (
          <div className="p-5"><Skeleton /></div>
        ) : res.error ? (
          <EmptyState title="Couldn't load approvals" action={<Button variant="secondary" onClick={res.reload}>Try again</Button>}>{res.error}</EmptyState>
        ) : items.length === 0 ? (
          <EmptyState title="You're all caught up">New approvals appear here and on WhatsApp.</EmptyState>
        ) : (
          <DataTable label="Approvals" headers={['Type', 'Trip', 'Recommendation and reason', 'Amount', 'Waiting', 'Decision']}>
            {items.map((a) => {
              const overLimit = limit == null || a.amount > limit;
              return (
                <Fragment key={a.id}>
                  <tr>
                    <td className={td}><Chip tone={a.kind === 'PAYMENT' ? 'billing' : a.kind === 'EXCEPTION' ? 'danger' : 'action'}>{a.kindLabel}</Chip></td>
                    <td className={`${td} font-semibold`}><Link href={`/trips/${a.tripId}`} className="hover:underline">{a.ref}</Link></td>
                    <td className={td}>
                      <div className="font-semibold">{a.summary}</div>
                      <div className="text-[13px] text-ink-muted">{a.reason}</div>
                    </td>
                    <td className={`${td} tabular whitespace-nowrap text-right font-bold`}>{rupees(a.amount)}</td>
                    <td className={`${td} whitespace-nowrap text-ink-muted`}>{ago(a.createdAt)}</td>
                    <td className={`${td} text-right`}>
                      <div className="inline-flex gap-1.5">
                        <Button size="sm" onClick={() => approve(a)} loading={busy === a.id} disabled={overLimit} title={overLimit ? (limit == null ? "Your role can't approve" : `Above your limit of ${rupees(limit)}`) : undefined}>Approve</Button>
                        <Button size="sm" variant="secondary" onClick={() => router.push(`/trips/${a.tripId}`)}>Change</Button>
                        <Button size="sm" variant="danger" onClick={() => { setRejecting(a.id); setReason(''); setReasonError(''); }} disabled={limit == null}>{a.kind === 'PAYMENT' ? 'Query' : a.kind === 'EXCEPTION' ? 'Reject fix' : 'Reject'}</Button>
                      </div>
                    </td>
                  </tr>
                  {rejecting === a.id && (
                    <tr>
                      <td colSpan={6} className="border-b border-line-faint bg-brand-soft px-3.5 py-3">
                        <div className="flex flex-wrap items-end gap-2.5">
                          <div className="min-w-[260px] flex-1">
                            <TextField label={a.kind === 'PAYMENT' ? `What is wrong with invoice ${a.ref}?` : a.kind === 'EXCEPTION' ? `Why reject the fix for ${a.ref}?` : `Why reject all quotes for ${a.ref}?`} required value={reason} onChange={(e) => { setReason(e.target.value); setReasonError(''); }} error={reasonError} placeholder={a.kind === 'PAYMENT' ? 'e.g. Detention not agreed' : 'e.g. All quotes above budget'} />
                          </div>
                          <Button size="sm" variant="danger" onClick={() => reject(a)} loading={busy === a.id}>{a.kind === 'PAYMENT' ? 'Send query' : a.kind === 'EXCEPTION' ? 'Reject fix' : 'Reject and ask again'}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </DataTable>
        )}
      </Card>
    </div>
  );
}
