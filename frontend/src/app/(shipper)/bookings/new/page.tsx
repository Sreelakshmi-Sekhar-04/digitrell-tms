import { ComingInPhase } from '@/components/ComingInPhase';

export default function NewBookingPage() {
  return <ComingInPhase title="New booking" subtitle="Six fields. Defaults come from your last booking on this lane." phase={3} what="Booking needs your lanes and addresses (phase 2) and is built in phase 3." />;
}
