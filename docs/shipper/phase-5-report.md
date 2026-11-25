# Phase 5 report — Exceptions: cancel, edit, widen and on-hold fixes

**Objective:** the shipper can recover when things don't go to plan (BRD §4.9, §5 "On hold" and
"Cancelled", §6 Bids): cancel or edit a booking, give carriers more time or ask more of them, and
decide on fixes for problems on the road, without losing what was entered.

## Features implemented

### Cancel a booking (trip header → *Cancel booking*)
- A confirm dialog (the design's only kind of confirm) **lists exactly what will happen**:
  - carriers told the request is withdrawn
  - awarded carrier told
  - LR and e-way bill **voided** (numbers never reused)
  - goods on the truck: agree return and charges directly
- Reason required (5 choices); *Other* needs a note. *Keep booking* has focus; Esc closes.
- Allowed from any status before *Delivered* (BRD §5). **Once the goods are on the truck, only the logistics head can cancel.** Others see the button disabled with the reason.
- After cancelling: *Cancelled* panel with reason and time; no progress bar or actions; the trip is under *Closed*; open quotes and approvals are withdrawn; late quotes are refused.

### Edit a booking (trip header → *Edit booking*)
- Before the award: date, weight, material, receiver, reference, notes. **If carriers have already answered, changing date, weight or material asks every carrier to quote again**: the drawer warns before you save, and old quotes and the pending award approval are cleared.
- After the award: only receiver, reference and notes; the load fields are shown locked with the reason.
- Pickup, drop and truck type never change (that's a different lane): cancel and rebook.

### Widen a quote request
- **Give carriers more time** (+1, 2, 4, 8 or 24 h), from *Waiting for quotes*, *Choose a carrier* (while open) and *No quotes by the deadline*. It reopens a closed request; it's refused once everyone has answered.
- **Also ask** carriers approved for the lane after booking.

### Problems on the road (*On hold*)
- **A plain delay is a notice**: the ETA moves and the trip stays on the road, with no approval (BRD §4.9). It's shown under the on-the-road panel.
- **A breakdown, accident or other problem** puts the trip *On hold* with the proposed fix (swap, wait, repair, tranship), its new ETA and extra cost.
  - *Carrier pays*: you're informed; nothing to do.
  - *Billed to you*: **Approve fix** (limits apply) or **Reject fix** with a reason. The carrier then proposes another option; a new proposal replaces the old approval.
- The fix only goes ahead once allowed; when the carrier resolves it the trip is back *on the road*, with a new truck number after a swap.
- **Approvals inbox** lists exception fixes billed to you (approve / reject fix).

## APIs and database changes

| Endpoint | Purpose |
|---|---|
| `POST /api/trips/:id/cancel` | Reason (+ note); refused after delivery; on the road: logistics head only |
| `PATCH /api/trips/:id` | Edit booking (load before award, extras until closed); returns `requoted` |
| `POST /api/trips/:id/extend` · `/carriers` | More time; ask more lane carriers |
| `POST /api/trips/:id/exception/approve` · `/reject` | Decide a fix billed to the shipper |
| **Integration** `POST /api/integration/trips/:number/exceptions`, `/exceptions/:id/proposal`, `/exceptions/:id/resolve` | Driver-bot / exception-agent stand-ins |

`GET /api/trips/:id` now also returns:
- `cancel` (allowed, reason, consequences)
- `edit` (what can change, whether it re-quotes)
- `carriersNotAsked`
- `exception`, `delays` and `cancelled`

Migration `20261125100000_exceptions`: trip cancellation fields and a new `TripException` table.
After merge: `cd backend && npx prisma migrate deploy`.

## Playwright tests

| Suite | Cases |
|---|---|
| `exceptions.api.spec.ts` (11) | cancel before award (preview, reason and note rules, withdrawn quotes, inbox cleared, late quote and second cancel refused); cancel after truck voids LR and e-way bill; on the road: executive refused (403), head allowed; delivered can't cancel; edit re-quotes only after answers, extras don't; load locked after award, field validation; extend reopens no-quote request and is refused when all answered; ask a newly approved lane carrier; delay notice; carrier-paid breakdown → on hold → resolved with new truck; shipper-paid fix: resolve refused before approval, executive refused, reject needs reason, new proposal, approve, resolve; problems only on the road |
| `exceptions.ui.spec.ts` (8) | cancel dialog flow with validation and Cancelled state; Keep booking / Esc; edit weight warns then re-quotes; load fields locked after award; extend from *No quotes*; ask a newly approved carrier; on-hold reject (reason) → new proposal → approve → back on the road; inbox approve fix and executive's disabled cancel with reason |
| `exceptions.phone.spec.ts` (1) | cancel dialog and on-hold panel fit 390 px |
| Earlier phases (103) | re-run as regression, unchanged |

**Result: 123 passed, 0 failed, on two consecutive full runs.** `next build` and backend `tsc` pass.

## Bugs found and fixed during the phase

1. A booking executive cancelling a trip on the road got *409 conflict* instead of *403 not allowed*. Fixed with an explicit role flag instead of matching the message text.

## Remaining issues and dependencies

- **Cancellation charges** aren't calculated; the dialog says to follow the carrier agreement. This needs a business rule (new open question).
- Carriers, drivers and receivers **aren't messaged yet**: the messaging module.
- Exceptions *before loading* (truck doesn't turn up) are handled by the carrier confirming another truck; only trips on the road can go *On hold*.
- Next is **Phase 6** (dashboard, first-time setup, reports, activity log, search, message preferences).
