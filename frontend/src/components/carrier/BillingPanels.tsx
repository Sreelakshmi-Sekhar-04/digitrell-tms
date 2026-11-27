'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { rupees } from '@/lib/masters';
import { dateShort, dateTimeIST } from '@/lib/trips';
import { hasRole, type LoadDetail } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { ClaimsList, errBox, useCall } from '@/components/carrier/RoadPanels';

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className={`flex items-center justify-between gap-3 py-1.5 text-sm ${strong ? 'border-t border-line-faint pt-2.5 font-bold' : ''}`}><span className={strong ? '' : 'text-ink-muted'}>{label}</span><span className="tabular">{value}</span></div>
);

/** POD received (or an invoice the shipper queried): the invoice draft, computed by fixed rules, and Send. */
export function InvoicePanel({ load, onDone }: { load: LoadDetail; onDone: () => void }) {
  const { user } = useAuth();
  const x = load.execution!;
  const d = x.billing;
  const canBill = hasRole(user, 'OWNER', 'ACCOUNTS');
  const isOwner = hasRole(user, 'OWNER');
  const c = useCall(onDone);
  const [detention, setDetention] = useState(d && d.detention ? String(d.detention) : '');
  if (!d) return null;
  const typed = Number(detention.replace(/[,₹\s]/g, ''));
  const det = Number.isFinite(typed) && typed > 0 ? typed : 0;
  const total = Math.round((d.freight + det - d.claimDeduction) * 100) / 100;
  const needsOwner = d.limit != null && total > d.limit && !isOwner;
  const queried = !!d.queryReason;
  const pending = d.approval?.status === 'PENDING';

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{queried ? `Invoice ${x.invoice?.number} queried: send a corrected one` : `POD accepted · invoice ${rupees(d.total)}`}</h2>
          <p className="mt-1 text-sm text-ink-muted">{queried ? 'Fix what the shipper asked about, then send again. The corrected invoice gets a new number.' : 'The shipper’s POD rule is met. Check the draft and send it.'}</p>
        </div>
        <Chip tone={queried ? 'danger' : 'success'}>{queried ? 'Invoice queried' : 'POD received'}</Chip>
      </div>
      {queried && <p role="alert" className={errBox} data-testid="invoice-query">The shipper says: “{d.queryReason}”</p>}
      <div className="max-w-lg rounded-xl border border-line-faint p-4" data-testid="invoice-draft">
        <Row label="Contract amount (award)" value={rupees(d.freight)} />
        <Row label="Detention" value={det ? `+ ${rupees(det)}` : '₹0'} />
        <Row label={`Accepted claims${x.claims.filter((k) => k.status === 'ACCEPTED').length ? '' : ' (none)'}`} value={d.claimDeduction ? `− ${rupees(d.claimDeduction)}` : '₹0'} />
        <Row label="Invoice total" value={rupees(total)} strong />
        <p className="mt-2 text-xs text-ink-muted">{d.gst.text} Due 15 days after sending. The number comes from your invoice series when you send.</p>
      </div>
      {c.error && <p role="alert" className={`${errBox} mt-3`}>{c.error}</p>}
      {d.approval?.status === 'REJECTED' && <p className={`${errBox} mt-3`}>The owner rejected the last request{d.approval.reason ? `: “${d.approval.reason}”` : ''}. Fix it and send again.</p>}
      {pending && <p className="mt-3 text-sm font-semibold" data-testid="invoice-approval-pending">Waiting for the owner’s approval ({d.approval!.requestedByName} asked on {dateShort(d.approval!.at)}). It goes to the shipper once approved.</p>}
      {d.blocked && <p role="alert" className="mt-3 text-sm font-semibold text-[#7A1616]">{d.blocked.message}</p>}
      {!canBill ? (
        <p className="mt-3 text-sm text-ink-muted">Only the owner or accounts can send invoices.</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-full max-w-[220px]"><TextField label="Detention (₹)" optional inputMode="decimal" value={detention} error={c.fields.detention} onChange={(e) => setDetention(e.target.value)} placeholder="0" /></div>
          <Button loading={c.busy} disabled={!!d.blocked || pending} onClick={() => c.run(`/carrier/loads/${load.id}/invoice`, { detention: detention || undefined }, needsOwner ? 'Sent to the owner for approval.' : 'Invoice sent to the shipper.')}>
            {needsOwner ? 'Request owner approval' : queried ? 'Send corrected invoice' : 'Send invoice'}
          </Button>
          {needsOwner && <p className="w-full text-xs text-ink-muted">Above your invoice limit of {rupees(d.limit)}: the owner approves before it goes out.</p>}
        </div>
      )}
      <ClaimsList load={load} onDone={onDone} />
    </Card>
  );
}

/** Invoiced (sent, not queried): status, due date, payment reminder after the due date. */
export function InvoicedPanel({ load, onDone }: { load: LoadDetail; onDone: () => void }) {
  const { user } = useAuth();
  const inv = load.execution!.invoice;
  const canBill = hasRole(user, 'OWNER', 'ACCOUNTS');
  const c = useCall(onDone);
  if (!inv) return null;
  const reminded = inv.lastReminderAt && Date.now() - new Date(inv.lastReminderAt).getTime() < 24 * 3600_000;
  return (
    <Card className="p-5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-bold">Invoice {inv.number} · {rupees(inv.total)}</h2>
        <Chip tone={inv.overdue ? 'danger' : 'billing'}>{inv.overdue ? 'Overdue' : 'Invoiced'}</Chip>
      </div>
      <div className="max-w-lg text-sm">
        <Row label="Freight" value={rupees(inv.freight)} />
        {inv.detention > 0 && <Row label="Detention" value={`+ ${rupees(inv.detention)}`} />}
        {inv.claimDeduction > 0 && <Row label="Accepted claims" value={`− ${rupees(inv.claimDeduction)}`} />}
      </div>
      <p className="mt-2 text-sm text-ink-muted">Sent with LR and POD. Due {dateShort(inv.dueDate)}{inv.status === 'APPROVED' ? '; the shipper has approved it and will pay' : '; waiting for the shipper to approve'}.</p>
      {inv.lastReminderAt && <p className="mt-1 text-xs text-ink-muted">Last reminder sent {dateTimeIST(inv.lastReminderAt)}.</p>}
      {c.error && <p role="alert" className={`${errBox} mt-3`}>{c.error}</p>}
      {canBill && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="secondary" loading={c.busy} disabled={!inv.overdue || !!reminded} onClick={() => c.run(`/carrier/loads/${load.id}/invoice/remind`, undefined, 'Reminder sent. The shipper is notified.')}>Send payment reminder</Button>
          {!inv.overdue && <span className="text-xs text-ink-muted">Available after the due date, {dateShort(inv.dueDate)}.</span>}
          {inv.overdue && reminded && <span className="text-xs text-ink-muted">A reminder went out in the last 24 hours.</span>}
        </div>
      )}
      <ClaimsList load={load} onDone={onDone} />
    </Card>
  );
}

/** Closed: paid, with the date and how. */
export function ClosedPanel({ load }: { load: LoadDetail }) {
  const inv = load.execution?.invoice;
  return (
    <Card className="p-5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-bold">Closed · paid {dateShort(inv?.paidAt ?? null)}</h2>
        <Chip tone="success">Closed</Chip>
      </div>
      <p className="text-sm text-ink-muted">Payment of {inv ? rupees(inv.total) : '—'} received{inv?.paymentMode ? ` by ${inv.paymentMode === 'UPI' ? 'UPI' : 'bank transfer'}` : ''}{inv?.paymentRef ? `, ref ${inv.paymentRef}` : ''}. Invoice {inv?.number}. All documents are below.</p>
    </Card>
  );
}
