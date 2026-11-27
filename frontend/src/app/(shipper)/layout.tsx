import type { ReactNode } from 'react';
import { WorkspaceGuard } from '@/components/shell/WorkspaceGuard';

/** Every shipper screen requires a signed-in user of a shipper company; carriers go to their own desk. */
export default function ShipperLayout({ children }: { children: ReactNode }) {
  return <WorkspaceGuard workspace="SHIPPER">{children}</WorkspaceGuard>;
}
