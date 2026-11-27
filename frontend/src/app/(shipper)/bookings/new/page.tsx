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
import { ChoiceChips, fromRupeeInput, toRupeeInput } from '@/components/ui/Choice';
import { useToast } from '@/components/ui/Toast';
import { BulkUpload } from '@/components/bulk/BulkUpload';
import type { Address } from '@/components/masters/types';

interface Form {
  pickupAddressId: string;
  dropAddressId: string;
  pickupDate: string;
  truckType: string;
  material: string;
  weightTonnes: string;
  budget: string;
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
  budget: number | null;
  lastBooked: string;
}
interface LaneCarrier {
  id: string;
  name: string;
  status: string;
  /** Freight per trip on the carrier's current rate card, if it has one for this lane. */
  rate: number | null;
  transitDays: number | null;
}
interface Preview {
  lane: { origin: string; destination: string; awardRule: string };
  budget: number | null;
  carriers: LaneCarrier[];
  quoteWindowHours: number;
  quotesClose: string;
}
interface LaneInfo {
  lane: { id: string; awardRule: string } | null;
  carriers?: LaneCarrier[];
  lastBudget?: number | null;
}

const DRAFT_KEY = 'dtms.bookingDraft';
const istDate = (offsetDays: number) => new Date(Date.now() + 5.5 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
const EMPTY: Form = { pickupAddressId: '', dropAddressId: '', pickupDate: istDate(1), truckType: '', material: '', weightTonnes: '', budget: '', receiverContact: '', reference: '', notes: '' };
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
  const [formError, setFormError] = useState<{ message: string; noLane?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [windowHours, setWindowHours] = useState<number | null>(null);
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

  // Once pickup, drop and truck type are chosen: the lane's carriers and their agreed rates, as a reference for the budget.
  useEffect(() => {
    const { pickupAddressId: p, dropAddressId: d, truckType: t } = form;
    if (!p || !d || !t) {
      setLaneInfo(null);
      return;
    }
    let live = true;
    api<LaneInfo>(`/bookings/lane-info?${new URLSearchParams({ pickupAddressId: p, dropAddressId: d, truckType: t })}`)
      .then((info) => live && setLaneInfo(info))
      .catch(() => live && setLaneInfo(null)); // a reference only; the review step reports real problems
    return () => {
      live = false;
    };
  }, [form.pickupAddressId, form.dropAddressId, form.truckType]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickups = useMemo(() => (addresses.data?.addresses ?? []).filter((a) => a.kind !== 'DROP'), [addresses.data]);
  const drops = useMemo(() => (addresses.data?.addresses ?? []).filter((a) => a.kind !== 'PICKUP'), [addresses.data]);
  const byId = (id: string) => addresses.data?.addresses.find((a) => a.id === id);

  const set = (k: keyof Form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
    setFormError(null);
  };

  const body = () => ({ ...form, weightTonnes: form.weightTonnes.trim(), budget: fromRupeeInput(form.budget), quoteWindowHours: windowHours ?? undefined });

  const showErrors = (err: unknown) => {
    if (err instanceof ApiError) {
      setErrors(err.body.fields ?? {});
      setFormError({ message: err.body.message, noLane: err.body.code === 'NO_LANE' });
    } else setFormError({ message: 'Something went wrong. Please try again.' });
  };

  const review = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api<Preview>('/bookings/preview', { method: 'POST', json: body() });
      setPreview(p);
      setWindowHours(p.quoteWindowHours);
      window.scrollTo({ top: 0 });
    } catch (err) {
      showErrors(err);
    } finally {
      setBusy(false);
    }
  };

  const changeWindow = async (h: number) => {
    setWindowHours(h);
    try {
      setPreview(await api<Preview>('/bookings/preview', { method: 'POST', json: { ...body(), quoteWindowHours: h } }));
    } catch (err) {
      showErrors(err);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const { trip } = await api<{ trip: { id: string; number: string; quoteDeadline: string; carriersAsked: number } }>('/bookings', { method: 'POST', json: body() });
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      toast({ tone: 'success', title: `${trip.number} booked.`, text: `Quotes requested from ${trip.carriersAsked} carriers; they close at ${timeIST(trip.quoteDeadline)}.` });
      router.push(`/trips/${trip.id}`);
    } catch (err) {
      setPreview(null);
      showErrors(err);
      setBusy(false);
    }
  };

  const repeat = (r: Recent) => {
    setForm((f) => ({ ...f, pickupAddressId: r.pickupAddressId, dropAddressId: r.dropAddressId, truckType: r.truckType, material: r.material, weightTonnes: r.weightTonnes != null ? String(r.weightTonnes) : '', budget: r.budget != null ? toRupeeInput(String(r.budget)) : '' }));
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
  const autoAward = laneInfo?.lane?.awardRule === 'AUTO_LOWEST';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="New booking"
        subtitle={preview ? 'Check the details. Nothing is sent until you confirm.' : 'Six fields and your budget. Pick a recent booking to fill them in one click.'}
        actions={preview ? undefined : <Button variant="secondary" onClick={() => setBulkOpen(true)}>Bulk upload</Button>}
      />
      <BulkUpload
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        base="/bookings/bulk"
        noun="booking"
        title="Bulk upload bookings"
        columns={['pickup', 'drop', 'pickupDate']}
        onImported={() => recent.reload()}
        doneAction={<Link href="/trips" className="inline-flex min-h-[44px] items-center rounded-btn border border-line-strong bg-white px-[18px] text-sm font-semibold text-ink hover:bg-brand-tint">Go to Trips</Link>}
      />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        {preview && pickup && drop ? (
          <Card className="p-6">
            <h2 className="text-lg font-semibold">Check and confirm</h2>
            <p className="mb-4 mt-1 text-sm text-ink-muted">Confirming asks your approved carriers for quotes.</p>
            <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2.5 text-[15px]">
              <dt className="text-ink-muted">Lane</dt>
              <dd className="font-semibold">{pickup.name}, {pickup.city} → {drop.name}, {drop.city}</dd>
              <dt className="text-ink-muted">Pickup date</dt>
              <dd className="font-semibold">{prettyDate(form.pickupDate)}</dd>
              <dt className="text-ink-muted">Load</dt>
              <dd className="font-semibold">{form.material} · {form.weightTonnes} t · {form.truckType}</dd>
              <dt className="text-ink-muted">Quotes from</dt>
              <dd>
                {preview.carriers.length} approved carriers: {preview.carriers.map((c) => (c.rate != null ? `${c.name} (rate card ${rupees(c.rate)})` : c.name)).join(', ')}
              </dd>
              <dt className="text-ink-muted">Budget</dt>
              <dd>
                {preview.budget != null
                  ? <><span className="font-semibold">{rupees(preview.budget)}</span> per trip{preview.lane.awardRule === 'AUTO_LOWEST' ? ' · lowest quote within budget is awarded automatically' : ' · quotes above it are flagged'}</>
                  : <span className="text-ink-muted">Not set. Quotes won&apos;t be compared to a budget.</span>}
              </dd>
              <dt className="text-ink-muted">Quotes close</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span>at {timeIST(preview.quotesClose)}</span>
                <label className="sr-only" htmlFor="qw">Quote window</label>
                <select id="qw" value={windowHours ?? preview.quoteWindowHours} onChange={(e) => changeWindow(Number(e.target.value))} className="min-h-[36px] rounded-lg border border-line-strong bg-white px-2 text-[13px]">
                  {[1, 2, 3, 4, 6, 12, 24].map((h) => <option key={h} value={h}>in {h} hour{h > 1 ? 's' : ''}</option>)}
                </select>
              </dd>
              {(form.reference || form.receiverContact || form.notes) && (
                <>
                  <dt className="text-ink-muted">Extras</dt>
                  <dd>{[form.reference && `Ref ${form.reference}`, form.receiverContact && `Receiver ${form.receiverContact}`, form.notes].filter(Boolean).join(' · ')}</dd>
                </>
              )}
            </dl>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Button onClick={confirm} loading={busy}>Confirm and ask for quotes</Button>
              <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>Edit</Button>
            </div>
          </Card>
        ) : (
          <Card className="p-6">
            <form onSubmit={review} noValidate className="flex flex-col gap-[18px]">
              {formError && (
                <div role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm text-[#7A1616]">
                  <strong>{formError.message}</strong>
                  {formError.noLane && user?.role === 'LOGISTICS_HEAD' && (
                    <> <Link href="/masters?tab=lanes" className="font-semibold underline">Open Master data → Lanes</Link></>
                  )}
                  {formError.noLane && user?.role !== 'LOGISTICS_HEAD' && <> Ask your logistics head to set it up.</>}
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
                <TextField
                  label="Budget per trip (₹)"
                  required={autoAward}
                  optional={!autoAward}
                  inputMode="numeric"
                  value={form.budget}
                  onChange={(e) => set('budget', toRupeeInput(e.target.value))}
                  error={errors.budget}
                  placeholder="e.g. 46,000"
                  help={autoAward ? 'This lane awards the lowest quote within your budget automatically.' : 'Quotes above this are flagged when you compare them.'}
                />
              </div>
              {laneInfo?.lane && <RateReference info={laneInfo} onUse={(n) => set('budget', toRupeeInput(String(n)))} />}
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
                <Button type="submit" loading={busy}>Review and confirm</Button>
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

/**
 * Agreed rates of the lane's carriers, as a reference for the budget. Nothing is filled in or
 * enforced unless the user picks a figure.
 */
function RateReference({ info, onUse }: { info: LaneInfo; onUse: (n: number) => void }) {
  const carriers = info.carriers ?? [];
  const rated = carriers.filter((c) => c.rate != null);
  const lowest = rated.length ? Math.min(...rated.map((c) => c.rate!)) : null;
  return (
    <section aria-label="Rate card reference" className="rounded-xl bg-brand-soft px-4 py-3.5 text-sm">
      <h3 className="mb-1.5 text-[13px] font-semibold text-ink-soft">Rate cards on this lane</h3>
      {rated.length ? (
        <ul className="flex flex-col gap-0.5">
          {rated.map((c) => (
            <li key={c.id} className="flex justify-between gap-3">
              <span>{c.name}{c.transitDays ? <span className="text-ink-muted"> · {c.transitDays} day{c.transitDays > 1 ? 's' : ''}</span> : null}</span>
              <span className="tabular font-semibold">{rupees(c.rate)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted">None of the {carriers.length} approved carriers has a rate card for this lane yet.</p>
      )}
      {rated.length > 0 && rated.length < carriers.length && (
        <p className="mt-1 text-xs text-ink-muted">No rate card: {carriers.filter((c) => c.rate == null).map((c) => c.name).join(', ')}</p>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {lowest != null && <Button size="sm" variant="secondary" onClick={() => onUse(lowest)}>Use lowest rate ({rupees(lowest)})</Button>}
        {info.lastBudget != null && <Button size="sm" variant="ghost" onClick={() => onUse(info.lastBudget!)}>Use last budget ({rupees(info.lastBudget)})</Button>}
      </div>
    </section>
  );
}
