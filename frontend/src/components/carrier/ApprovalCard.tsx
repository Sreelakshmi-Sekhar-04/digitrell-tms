'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { formErrors } from '@/lib/useApi';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import type { CarrierApproval } from '@/lib/carrier';

/** A decision waiting for the owner. Invoices above the limit can be approved (and go out) or rejected with a reason. */
export function ApprovalCard({ a, onDecided }: { a: CarrierApproval; onDecided?: () => void }) {
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const decide = async (approve: boolean) => {
    setBusy(true);
    setError('');
    try {
      await api(`/carrier/approvals/${a.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', json: approve ? undefined : { reason } });
      toast({ tone: 'success', title: approve ? 'Approved. The invoice went to the shipper.' : 'Rejected. The sender can fix it and send again.' });
      onDecided?.();
    } catch (err) {
      setError(formErrors(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-4 sm:p-5" data-testid="approval-card">
      <div className="text-[13px] font-semibold text-ink-muted">{a.kindLabel} · {a.ref}</div>
      <div className="mt-1 font-semibold">{a.summary}</div>
      <div className="mt-1 text-sm text-ink-muted">{a.reason}</div>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-[#7A1616]">{error}</p>}
      {a.kind === 'INVOICE' && onDecided && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {rejecting ? (
            <>
              <div className="w-full max-w-sm"><TextField label="Why are you rejecting it" required value={reason} onChange={(e) => setReason(e.target.value)} /></div>
              <Button variant="danger" loading={busy} onClick={() => decide(false)}>Reject</Button>
              <Button variant="ghost" onClick={() => setRejecting(false)}>Back</Button>
            </>
          ) : (
            <>
              <Button loading={busy} onClick={() => decide(true)}>Approve and send</Button>
              <Button variant="secondary" onClick={() => setRejecting(true)}>Reject</Button>
              {a.tripId && <Link href={`/carrier/loads/${a.tripId}`} className="text-sm font-semibold text-brand-dark underline">Open load</Link>}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
