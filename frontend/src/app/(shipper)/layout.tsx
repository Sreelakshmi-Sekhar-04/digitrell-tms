'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, Skeleton } from '@/components/ui/Card';

/** Every shipper screen requires a signed-in user of a shipper company. */
export default function ShipperLayout({ children }: { children: ReactNode }) {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'signed-out') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, pathname, router]);

  if (status !== 'signed-in' || !user) {
    return (
      <div className="mx-auto max-w-md p-10">
        <Skeleton lines={3} />
      </div>
    );
  }

  if (user.companyType !== 'SHIPPER') {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Card className="p-7 text-center">
          <h1 className="text-2xl font-bold">This workspace is for shippers</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            You are signed in as {user.name} of {user.companyName}, a carrier. The carrier workspace is not available here yet; your quote requests and approvals still reach you on WhatsApp.
          </p>
          <Button
            className="mt-5"
            variant="secondary"
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            Sign out
          </Button>
        </Card>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
