'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/useApi';
import { TRUCK_TYPES, rupees } from '@/lib/masters';
import { timeIST } from '@/lib/trips';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Card';
import { SelectField, TextField } from '@/components/ui/Field';
import { ChoiceChips } from '@/components/ui/Choice';
import { useToast } from '@/components/ui/Toast';
import type { Address } from '@/components/masters/types';

interface Form {
  pickupAddressId: string;
  dropAddressId: string;
  pickupDate: string;
  truckType: string;
  material: string;
  weightTonnes: string;
  receiverContact: string;
  reference: string;
  notes: string;
}
interface Recent {
  pickupAddressId: string;
  dropAddressId: string;
  lane: string;
  pickupName: string;
  dropName: string;
  truckType: string;
  material: string;
  weightTonnes: number | null;
  lastBooked: string;
}
/** A carrier on contract for this lane, in the order it will be offered the load. */
interface OfferCarrier {
  id: string;
  name: string;
  /** Contract rate per trip from the carrier's rate card. */
  rate: number;
  transitDays: number | null;
  sequence: number;
  offeredFirst: boolean;
}
interface Preview {
  carriers: OfferCarrier[];
  offeredFirst: OfferCarrier;
  respondHours: number;
  respondBy: string;
}
interface LaneInfo {
  ready: boolean;
  carriers: OfferCarrier[];
  route?: { origin: string; destination: string; truckType: string };
  noContractRate?: boolean;
  message?: string | null;
}

const DRAFT_KEY = 'dtms.bookingDraft';
const istDate = (offsetDays: number) => new Date(Date.now() + 5.5 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
const EMPTY: Form = { pickupAddressId: '', dropAddressId: '', pickupDate: istDate(1), truckType: '', material: '', weightTonnes: '', receiverContact: '', reference: '', notes: '' };
const prettyDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function loadDraft(): Form | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = { ...EMPTY, ...(JSON.parse(raw) as Partial<Form>) }; // drafts saved before a field existed
    return d.pickupDate < istDate(0) ? { ...d, pickupDate: istDate(1) } : d;
  } catch {
    return null;
  }
}

export default function NewBookingPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const addresses = useApi<{ addresses: Address[] }>('/addresses');
  const recent = useApi<{ recent: Recent[] }>('/bookings/recent');
  const [form, setForm] = useState<Form>(EMPTY);
  const [showMore, setShowMore] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ message: string; noRate?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [laneInfo, setLaneInfo] = useState<LaneInfo | null>(null);

  // Saving waits until the draft has been read: otherwise the empty first render would overwrite
  // it (React runs mount effects twice in development, so the second read would find it empty).
  const [draftRead, setDraftRead] = useState(false);
  useEffect(() => {
    const d = loadDraft();
    if (d) {
      setForm(d);
      if (d.receiverContact || d.reference || d.notes) setShowMore(true);
    }
    setDraftRead(true);
  }, []);
  useEffect(() => {
    if (!draftRead) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      /* draft is a convenience only */
    }
  }, [form, draftRead]);

  // Once pickup, drop, truck type and date are chosen: the carriers on contract, in the order they will be offered the load.
  useEffect(() => {
    const { pickupAddressId: p, dropAddressId: d, truckType: t, pickupDate: when } = form;
    if (!p || !d || !t) {
      setLaneInfo(null);
      return;
    }
    let live = true;
    api<LaneInfo>(`/bookings/lane-info?${new URLSearchParams({ pickupAddressId: p, dropAddressId: d, truckType: t, pickupDate: when })}`)
      .then((info) => live && setLaneInfo(info))
      .catch(() => live && setLaneInfo(null)); // a reference only; the review step reports real problems
    return () => {
      live = false;
    };
  }, [form.pickupAddressId, form.dropAddressId, form.truckType, form.pickupDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickups = useMemo(() => (addresses.data?.addresses ?? []).filter((a) => a.kind !== 'DROP'), [addresses.data]);
  const drops = useMemo(() => (addresses.data?.addresses ?? []).filter((a) => a.kind !== 'PICKUP'), [addresses.data]);
  const byId = (id: string) => addresses.data?.addresses.find((a) => a.id === id);

  const set = (k: keyof Form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
    setFormError(null);
  };

  const body = () => ({ ...form, weightTonnes: form.weightTonnes.trim() });

  const showErrors = (err: unknown) => {
    if (err instanceof ApiError) {
      setErrors(err.body.fields ?? {});
      setFormError({ message: err.body.message, noRate: err.body.code === 'NO_CONTRACT_RATE' });
    } else setFormError({ message: 'Something went wrong. Please try again.' });
  };

  const review = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api<Preview>('/bookings/preview', { method: 'POST', json: body() });
      setPreview(p);
      window.scrollTo({ top: 0 });
    } catch (err) {
      showErrors(err);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const { trip } = await api<{ trip: { id: string; number: string; quoteDeadline: string; carriersInLine: number; offeredTo: { name: string; rate: number } } }>('/bookings', { method: 'POST', json: body() });
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      toast({ tone: 'success', title: `${trip.number} booked.`, text: `Offered to ${trip.offeredTo.name} at ${rupees(trip.offeredTo.rate)}; it answers by ${timeIST(trip.quoteDeadline)}.` });
      router.push(`/trips/${trip.id}`);
    } catch (err) {
      setPreview(null);
      showErrors(err);
      setBusy(false);
    }
  };

  const repeat = (r: Recent) => {
    setForm((f) => ({ ...f, pickupAddressId: r.pickupAddressId, dropAddressId: r.dropAddressId, truckType: r.truckType, material: r.material, weightTonnes: r.weightTonnes != null ? String(r.weightTonnes) : '' }));
    setErrors({});
    setFormError(null);
    setPreview(null);
  };

  // Home's "Repeat last booking" opens this page with ?repeat=last: fill the form from the latest booking once.
  const repeatedFromLink = useRef(false);
  useEffect(() => {
    const latest = recent.data?.recent[0];
    if (repeatedFromLink.current || !latest) return;
    if (new URLSearchParams(window.location.search).get('repeat') === 'last') {
      repeatedFromLink.current = true;
      repeat(latest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent.data]);

  if (addresses.loading && !addresses.data) return <Skeleton lines={4} />;

  if (!pickups.length || !drops.length) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="New booking" />
        <Card>
          <EmptyState title="Save your addresses first" action={<Link href="/masters?tab=addresses" className="inline-flex min-h-[44px] items-center rounded-btn bg-brand px-[18px] text-sm font-semibold text-white">Add addresses</Link>}>
            Bookings pick the pickup and drop from your saved addresses, so the carrier and driver always get the right location and contact.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const pickup = byId(form.pickupAddressId);
  const drop = byId(form.dropAddressId);
  const blocked = !!laneInfo?.noContractRate;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="New booking" subtitle={preview ? 'Check the details. Nothing is sent until you confirm.' : 'Six fields, no price to type: the load is offered at your contract rates. Pick a recent booking to fill them in one click.'} />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        {preview && pickup && drop ? (
          <Card className="p-6">
            <h2 className="text-lg font-semibold">Check and confirm</h2>
            <p className="mb-4 mt-1 text-sm text-ink-muted">Confirming offers the load to the carrier with the lowest contract rate.</p>
            <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2.5 text-[15px]">
              <dt className="text-ink-muted">Lane</dt>
              <dd className="font-semibold">{pickup.name}, {pickup.city} → {drop.name}, {drop.city}</dd>
              <dt className="text-ink-muted">Pickup date</dt>
              <dd className="font-semibold">{prettyDate(form.pickupDate)}</dd>
              <dt className="text-ink-muted">Load</dt>
              <dd className="font-semibold">{form.material} · {form.weightTonnes} t · {form.truckType}</dd>
              <dt className="text-ink-muted">Offered first to</dt>
              <dd><span className="font-semibold">{preview.offeredFirst.name}</span> at <span className="font-semibold">{rupees(preview.offeredFirst.rate)}</span> (contract rate)</dd>
              <dt className="text-ink-muted">If it passes</dt>
              <dd>
                {preview.carriers.length > 1
                  ? preview.carriers.slice(1).map((c) => `${c.name} (${rupees(c.rate)})`).join(', then ')
                  : <span className="text-ink-muted">No other carrier on contract for this lane.</span>}
              </dd>
              <dt className="text-ink-muted">Answer within</dt>
              <dd>{preview.respondHours} hour{preview.respondHours > 1 ? 's' : ''} per carrier (first one by {timeIST(preview.respondBy)}). Set in Policies.</dd>
              {(form.reference || form.receiverContact || form.notes) && (
                <>
                  <dt className="text-ink-muted">Extras</dt>
                  <dd>{[form.reference && `Ref ${form.reference}`, form.receiverContact && `Receiver ${form.receiverContact}`, form.notes].filter(Boolean).join(' · ')}</dd>
                </>
              )}
            </dl>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Button onClick={confirm} loading={busy}>Confirm and offer the load</Button>
              <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>Edit</Button>
            </div>
          </Card>
        ) : (
          <Card className="p-6">
            <form onSubmit={review} noValidate className="flex flex-col gap-[18px]">
              {formError && (
                <div role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm text-[#7A1616]">
                  <strong>{formError.message}</strong>
                  {formError.noRate && user?.role === 'LOGISTICS_HEAD' && (
                    <> <Link href="/masters?tab=rate-cards" className="font-semibold underline">Open Master data › Rate cards</Link></>
                  )}
                  {formError.noRate && user?.role !== 'LOGISTICS_HEAD' && <> Ask your logistics head to add a rate card.</>}
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SelectField label="Pickup" required value={form.pickupAddressId} onChange={(e) => set('pickupAddressId', e.target.value)} error={errors.pickupAddressId} help={<>Saved addresses. <Link href="/masters?tab=addresses" className="underline">Add one</Link></>}>
                  <option value="">Choose pickup</option>
                  {pickups.map((a) => <option key={a.id} value={a.id}>{a.name}, {a.city}</option>)}
                </SelectField>
                <SelectField label="Drop" required value={form.dropAddressId} onChange={(e) => set('dropAddressId', e.target.value)} error={errors.dropAddressId}>
                  <option value="">Choose drop</option>
                  {drops.map((a) => <option key={a.id} value={a.id}>{a.name}, {a.city}</option>)}
                </SelectField>
                <TextField label="Pickup date" required type="date" min={istDate(0)} value={form.pickupDate} onChange={(e) => set('pickupDate', e.target.value)} error={errors.pickupDate} />
                <TextField label="Weight (tonnes)" required inputMode="decimal" placeholder="e.g. 14" value={form.weightTonnes} onChange={(e) => set('weightTonnes', e.target.value.replace(/[^\d.,]/g, ''))} error={errors.weightTonnes} />
              </div>
              <ChoiceChips label="Truck type" required options={TRUCK_TYPES.map((t) => ({ value: t, label: t }))} value={form.truckType} onChange={(v) => set('truckType', v)} error={errors.truckType} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField label="Material" required value={form.material} onChange={(e) => set('material', e.target.value)} error={errors.material} placeholder="e.g. Biscuits (packed cartons)" />
              </div>
              {laneInfo?.ready && <OfferOrder info={laneInfo} />}
              <Button variant="ghost" size="sm" className="self-start" aria-expanded={showMore} onClick={() => setShowMore((s) => !s)}>
                {showMore ? '− Fewer details' : '+ Receiver contact, reference, notes'}
              </Button>
              {showMore && (
                <div className="grid grid-cols-1 gap-4 border-t border-line-faint pt-4 sm:grid-cols-3">
                  <TextField label="Receiver contact" optional value={form.receiverContact} onChange={(e) => set('receiverContact', e.target.value)} error={errors.receiverContact} placeholder="Name and mobile" help="Gets the ETA and the delivery code." />
                  <TextField label="Your reference" optional value={form.reference} onChange={(e) => set('reference', e.target.value)} error={errors.reference} placeholder="PO or order no." />
                  <TextField label="Notes for carrier" optional value={form.notes} onChange={(e) => set('notes', e.target.value)} error={errors.notes} placeholder="e.g. tarpaulin needed" />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2.5 border-t border-line-faint pt-[18px]">
                <Button type="submit" loading={busy} disabled={blocked}>Review and confirm</Button>
                <Button variant="secondary" onClick={() => { setForm(EMPTY); setErrors({}); setFormError(null); }}>Clear</Button>
                <span className="text-[13px] text-ink-muted">Draft is saved on this device as you type.</span>
              </div>
            </form>
          </Card>
        )}

        <aside className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="mb-2.5 text-base font-semibold">Repeat a recent booking</h2>
            {recent.data && recent.data.recent.length === 0 && <p className="text-sm text-ink-muted">Your last three different bookings will appear here.</p>}
            <div className="flex flex-col gap-2">
              {(recent.data?.recent ?? []).map((r, i) => (
                <button key={i} type="button" onClick={() => repeat(r)} className="min-h-[56px] rounded-btn border border-line px-3 py-2.5 text-left text-sm hover:border-brand hover:bg-brand-soft">
                  <span className="block font-semibold">{r.lane}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{r.truckType} · {r.weightTonnes} t {r.material}</span>
                </button>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** Carriers on contract for this lane in offer order. Only the first is offered the load; the rest wait in line. */
function OfferOrder({ info }: { info: LaneInfo }) {
  if (info.noContractRate) {
    return (
      <section aria-label="Carriers on contract for this lane" role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3.5 text-sm text-[#7A1616]">
        <h3 className="mb-1 text-[13px] font-semibold">Carriers on contract for this lane</h3>
        <p><strong>{info.message}</strong> <Link href="/masters?tab=rate-cards" className="font-semibold underline">Open Master data › Rate cards</Link></p>
      </section>
    );
  }
  return (
    <section aria-label="Carriers on contract for this lane" className="rounded-xl bg-brand-soft px-4 py-3.5 text-sm">
      <h3 className="mb-1.5 text-[13px] font-semibold text-ink-soft">Carriers on contract for this lane</h3>
      <ol className="flex flex-col gap-1">
        {info.carriers.map((c) => (
          <li key={c.id} className="flex flex-wrap justify-between gap-3">
            <span>
              <span className="text-ink-muted">{c.sequence}. </span>
              <span className={c.offeredFirst ? 'font-semibold' : ''}>{c.name}</span>
              {c.offeredFirst && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">Offered first</span>}
              {c.transitDays ? <span className="text-ink-muted"> · {c.transitDays} day{c.transitDays > 1 ? 's' : ''}</span> : null}
            </span>
            <span className="tabular font-semibold">{rupees(c.rate)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-ink-muted">Lowest contract rate first. If a carrier passes or doesn&apos;t answer in time, the next one is offered the load.</p>
    </section>
  );
}
