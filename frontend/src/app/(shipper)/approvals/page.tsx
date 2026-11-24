import { ComingInPhase } from '@/components/ComingInPhase';

export default function ApprovalsPage() {
  return <ComingInPhase title="Approvals" subtitle="Each item shows the agent's recommendation and the reason. Nothing that costs money happens until you approve." phase={3} what="Award approvals arrive in phase 3; claims and payments in phase 4." />;
}
