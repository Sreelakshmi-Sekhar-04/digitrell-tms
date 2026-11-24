'use client';

import { useAuth } from '@/lib/auth';
import { ComingInPhase } from '@/components/ComingInPhase';

export default function HomePage() {
  const { user } = useAuth();
  const first = user?.name.split(' ')[0] ?? '';
  return (
    <ComingInPhase
      title={`Good ${greeting()}, ${first}`}
      subtitle="Your decisions, active trips and month at a glance."
      phase={6}
      what="The home dashboard summarises trips, approvals and spend, so it is built after those exist (phases 3–5). Use the menu to see what's available."
    />
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
