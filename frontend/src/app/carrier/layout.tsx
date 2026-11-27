import type { ReactNode } from 'react';
import { WorkspaceGuard } from '@/components/shell/WorkspaceGuard';

/** Every carrier screen requires a signed-in user of a carrier company; shippers go to their own desk. */
export default function CarrierLayout({ children }: { children: ReactNode }) {
  return <WorkspaceGuard workspace="CARRIER">{children}</WorkspaceGuard>;
}
