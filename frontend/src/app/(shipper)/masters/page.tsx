'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { CarriersTab } from '@/components/masters/CarriersTab';
import { RateCardsTab } from '@/components/masters/RateCardsTab';
import { LanesTab } from '@/components/masters/LanesTab';
import { AddressesTab } from '@/components/masters/AddressesTab';
import { UsersTab } from '@/components/masters/UsersTab';

// In the order they are set up: carriers, their rates, the lanes they are approved on, then addresses and people.
type TabId = 'carriers' | 'rate-cards' | 'lanes' | 'addresses' | 'users';
const TABS: { id: TabId; label: string; add: string }[] = [
  { id: 'carriers', label: 'Carriers', add: 'carrier' },
  { id: 'rate-cards', label: 'Rate cards', add: 'rate card' },
  { id: 'lanes', label: 'Lanes', add: 'lane' },
  { id: 'addresses', label: 'Addresses', add: 'address' },
  { id: 'users', label: 'Users and roles', add: 'user' },
];

function MastersInner() {
  const { user } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'carriers') as TabId;
  const [addSignal, setAddSignal] = useState(0);
  const [rateCardFor, setRateCardFor] = useState<string | null>(null);
  const isHead = user?.role === 'LOGISTICS_HEAD';
  const go = (id: TabId) => {
    setAddSignal(0);
    router.replace(`${pathname}?tab=${id}`, { scroll: false });
  };
  // Anyone can add an address (they need it to book); carriers, rate cards, lanes and users are the logistics head's.
  const canAdd = tab === 'addresses' || isHead;
  const def = TABS.find((t) => t.id === tab)!;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Master data"
        subtitle={isHead ? 'Carriers, their rate cards, lanes, addresses and users. Edit a row to change it; every change is logged with your name.' : 'You can add and edit addresses. Carriers, rate cards, lanes and users are managed by your logistics head.'}
        actions={canAdd ? <Button onClick={() => setAddSignal((n) => n + 1)}>+ Add {def.add}</Button> : undefined}
      />
      <Card className="overflow-hidden">
        <Tabs
          label="Master data"
          tabs={TABS}
          value={tab}
          onChange={go}
        />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'carriers' && <CarriersTab canManage={isHead} addSignal={addSignal} onOpenRateCard={(id) => { setRateCardFor(id); go('rate-cards'); }} />}
          {tab === 'rate-cards' && <RateCardsTab canManage={isHead} addSignal={addSignal} openCarrierId={rateCardFor} onOpened={() => setRateCardFor(null)} />}
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
