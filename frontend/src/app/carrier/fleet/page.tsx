'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { hasRole } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { TrucksTab } from '@/components/carrier/TrucksTab';
import { DriversTab } from '@/components/carrier/DriversTab';
import { RateCardsTab } from '@/components/carrier/RateCardsTab';
import { CarrierUsersTab } from '@/components/carrier/CarrierUsersTab';
import { ProfileTab } from '@/components/carrier/ProfileTab';

type TabId = 'trucks' | 'drivers' | 'rates' | 'users' | 'profile';
const TABS: { id: TabId; label: string; add?: string }[] = [
  { id: 'trucks', label: 'Trucks', add: 'truck' },
  { id: 'drivers', label: 'Drivers', add: 'driver' },
  { id: 'rates', label: 'Own price list', add: 'rate' },
  { id: 'users', label: 'Users and roles', add: 'user' },
  { id: 'profile', label: 'Company profile' },
];

/** Fleet and rates (carrier spec C3, C5, C6). Traffic manager: trucks and drivers. Owner: rates, users, profile. */
function FleetInner() {
  const { user } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'trucks') as TabId;
  const [addSignal, setAddSignal] = useState(0);
  const isOwner = hasRole(user, 'OWNER');
  const isTraffic = hasRole(user, 'TRAFFIC_MANAGER');
  const canEdit: Record<TabId, boolean> = { trucks: isTraffic, drivers: isTraffic, rates: isOwner, users: isOwner, profile: isOwner };
  const def = TABS.find((t) => t.id === tab)!;
  const who = tab === 'trucks' || tab === 'drivers' ? 'traffic manager' : 'owner';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Carrier management"
        subtitle={canEdit[tab] ? 'Edit a row to change it. Every change is logged with your name.' : `You can view this tab. Only the ${who} can change it.`}
        actions={def.add && canEdit[tab] ? <Button onClick={() => setAddSignal((n) => n + 1)}>+ Add {def.add}</Button> : undefined}
      />
      <Card className="overflow-hidden">
        <Tabs
          label="Carrier management"
          tabs={TABS}
          value={tab}
          onChange={(id) => {
            setAddSignal(0);
            router.replace(`${pathname}?tab=${id}`, { scroll: false });
          }}
        />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'trucks' && <TrucksTab canManage={canEdit.trucks} addSignal={addSignal} />}
          {tab === 'drivers' && <DriversTab canManage={canEdit.drivers} canApproveUpi={isTraffic || isOwner} canVerifyUpi={hasRole(user, 'TRAFFIC_MANAGER', 'OWNER', 'ACCOUNTS')} addSignal={addSignal} />}
          {tab === 'rates' && <RateCardsTab canManage={canEdit.rates} addSignal={addSignal} />}
          {tab === 'users' && <CarrierUsersTab canManage={canEdit.users} addSignal={addSignal} />}
          {tab === 'profile' && <ProfileTab canManage={canEdit.profile} />}
        </div>
      </Card>
    </div>
  );
}

export default function CarrierFleetPage() {
  return (
    <Suspense fallback={null}>
      <FleetInner />
    </Suspense>
  );
}
