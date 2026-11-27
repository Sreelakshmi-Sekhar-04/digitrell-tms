'use client';

import { useApi } from '@/lib/useApi';
import { type CarrierApproval } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Card';
import { ApprovalCard } from '@/components/carrier/ApprovalCard';

/** Carrier approvals inbox. Load offers are accepted or passed on the load itself; invoices above your limit appear here; fixes and overrides join later. */
export default function CarrierApprovalsPage() {
  const res = useApi<{ count: number; items: CarrierApproval[] }>('/carrier/approvals');
  const items = res.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Approvals"
        subtitle="Decisions waiting for the owner appear here."
      />
      {res.loading && !res.data ? (
        <Skeleton />
      ) : res.error ? (
        <Card><EmptyState title="Couldn't load approvals" action={<Button variant="secondary" onClick={res.reload}>Try again</Button>}>{res.error}</EmptyState></Card>
      ) : items.length === 0 ? (
        <Card><EmptyState title="Nothing waiting for you">Invoices above your limit appear here when someone else prepares them.</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((a) => <ApprovalCard key={a.id} a={a} onDecided={res.reload} />)}
        </div>
      )}
    </div>
  );
}
