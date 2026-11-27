'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { homeFor, useAuth } from '@/lib/auth';
import { AppShell } from '@/components/shell/AppShell';
import { Skeleton } from '@/components/ui/Card';

/**
 * Every desk screen requires a signed-in user, and each company type has its own workspace:
 * shippers at `/…`, carriers at `/carrier/…`. Opening the other workspace takes you to your own Home.
 */
export function WorkspaceGuard({ workspace, children }: { workspace: 'SHIPPER' | 'CARRIER'; children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const wrongWorkspace = !!user && user.companyType !== workspace;

  useEffect(() => {
    if (status === 'signed-out') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (status === 'signed-in' && user && user.companyType !== workspace) router.replace(homeFor(user));
  }, [status, user, workspace, pathname, router]);

  if (status !== 'signed-in' || !user || wrongWorkspace) {
    return (
      <div className="mx-auto max-w-md p-10">
        <Skeleton lines={3} />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
