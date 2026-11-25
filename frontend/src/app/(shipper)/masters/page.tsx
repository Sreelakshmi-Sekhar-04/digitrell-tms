'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { LanesTab } from '@/components/masters/LanesTab';
import { AddressesTab } from '@/components/masters/AddressesTab';
import { UsersTab } from '@/components/masters/UsersTab';

type TabId = 'lanes' | 'addresses' | 'users';
const TABS: { id: TabId; label: string; add: string }[] = [
  { id: 'lanes', label: 'Lanes and carriers', add: 'lane' },
  { id: 'addresses', label: 'Addresses', add: 'address' },
  { id: 'users', label: 'Users and roles', add: 'user' },
];

function MastersInner() {
  const { user } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'lanes') as TabId;
  const [addSignal, setAddSignal] = useState(0);
  const isHead = user?.role === 'LOGISTICS_HEAD';
  // Anyone can add an address (they need it to book); lanes and users are the logistics head's.
  const canAdd = tab === 'addresses' || isHead;
  const def = TABS.find((t) => t.id === tab)!;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Carriers and lanes"
        subtitle={isHead ? 'Edit a row to change it. Every change is logged with your name.' : 'You can add and edit addresses. Lanes and users are managed by your logistics head.'}
        actions={canAdd ? <Button onClick={() => setAddSignal((n) => n + 1)}>+ Add {def.add}</Button> : undefined}
      />
      <Card className="overflow-hidden">
        <Tabs
          label="Master data"
          tabs={TABS}
          value={tab}
          onChange={(id) => {
            setAddSignal(0);
            router.replace(`${pathname}?tab=${id}`, { scroll: false });
          }}
        />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'lanes' && <LanesTab canManage={isHead} addSignal={addSignal} />}
          {tab === 'addresses' && <AddressesTab addSignal={addSignal} />}
          {tab === 'users' && <UsersTab canManage={isHead} addSignal={addSignal} />}
        </div>
      </Card>
    </div>
  );
}

export default function MastersPage() {
  return (
    <Suspense fallback={null}>
      <MastersInner />
    </Suspense>
  );
}
