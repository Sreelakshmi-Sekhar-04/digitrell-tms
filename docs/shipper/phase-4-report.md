# Phase 4 report — Execution, POD, claims and billing

**Objective:** the shipper's side of the trip after the award (BRD §4.7–4.11, §5 steps 10–20):
see the truck, documents and progress; review the POD; raise claims; check, approve and pay the
carrier's invoice under the shipper's POD rule and limits; close the trip.

## Features implemented (trip detail task panels)

| Stage | What the shipper sees and does |
|---|---|
| **Truck confirmed** (Ready for pickup) | Truck number, driver and mobile, LR number, e-way bill with expiry |
| **In transit** | ETA, last location and update time, truck and driver |
| **Delivered, waiting for POD** | Quantities the receiver confirmed; "the driver has been asked for a photo" |
| **Delivered, POD needs a look** (remarks, damage or no QR match) | POD photo/link, what the receiver and POD agent reported, **raise a claim** (damage/shortage, units pre-filled from the receiver, value per unit, description; the amount is calculated live), **Accept POD** |
| **POD accepted** | The POD rule in plain words; **Mark hard copy received** when the rule needs it |
| **Invoiced** | Lines (freight, detention, claims deducted, total), the **billing agent's checks** (freight vs award, detention, claims, POD), **Approve**, **Query invoice** (reason), then **Record payment** (UPI or bank, reference) |
| **Closed** | Payment date, mode and reference |

Plus: a **Claims** card (status, carrier note, withdraw while open or disputed), a real **Documents** card (LR, e-way bill expiry, POD, hard copy), and truck and amount in Details.

**Approvals inbox:** now also lists **payments**, with the failed checks spelled out. *Approve* approves the invoice; *Query* sends it back with a reason.

## Business rules (server-side)

- **POD rule** (from Policies, BRD §6):
  - *Digital*: billing starts when the photo is accepted.
  - *Hard copy required*: the carrier **can't invoice** until the original LR is marked received.
  - *Both*: invoice on the photo; **payment waits** for the hard copy.
- **A clean POD is accepted by rule** (QR matches the LR, no remarks, nothing damaged). Anything else waits for a person.
- **Invoice checks:**
  - freight equals the award
  - no unexplained detention
  - claims deducted equal the claims the carrier accepted
  - no claim still waiting for the carrier
  - POD accepted
- **Approval by rule:** when *Billing* may act within limits and the invoice is at or below the payment threshold with every check passing, it is approved by rule. Otherwise it goes to Approvals.
- **Limits:** nobody approves or records a payment above their approval limit; booking executives can do neither.
- **Order is enforced:** steps out of order (loading before the truck, POD before delivery, invoice before POD) are refused with a clear message.
- A queried invoice is replaced when the carrier sends a corrected one.
- Every step, by agent or person, is in the trip's activity log.

## APIs and database changes

| Endpoint | Purpose |
|---|---|
| `POST /api/trips/:id/pod/accept` · `/pod/hard-copy` | Accept a POD needing review; mark the original received |
| `POST /api/trips/:id/claims` · `/claims/:claimId/withdraw` | Raise and withdraw claims |
| `POST /api/trips/:id/invoice/approve` · `/query` · `/pay` | Approve, query, record payment (closes the trip) |
| `POST /api/approvals/:id/approve` · `/reject` | Now also for payments |
| **Integration** `POST /api/integration/trips/:number/truck` · `/events` · `/delivered` · `/pod` · `/invoice`, `POST /api/integration/claims/:number/response` | Stand-ins for the carrier, driver-bot, receiver and documents modules (key-protected) |

`GET /api/trips/:id` now also returns truck, ETA and location, delivery, POD state, documents, claims and the invoice with its checks.

Migration `20261125080000_execution_billing`:
- trip execution and POD fields
- `Document.validUntil`
- new `Claim` table, numbered `CL-1`, `CL-2`, … from a sequence
- new `Invoice` table

After merge: `cd backend && npx prisma migrate deploy`.

## Playwright tests

| Suite | Cases |
|---|---|
| `execution.api.spec.ts` (8) | full happy path to closed, with activity text; out-of-order steps refused; damaged POD → claim (validation) → accept → invoice flagged while claim open → query → carrier accepts → corrected invoice deducts it, checks pass; mismatched freight and detention flagged, disputed claim withdrawn; *hard copy required* blocks invoicing; *both* blocks payment; approval by rule within limits vs above limit; who may approve and pay (booking executive, approver limit, other company) |
| `execution.ui.spec.ts` (6) | truck/LR/e-way panel and documents → on the road with location; damaged POD → claim validation → claim raised → accept POD; invoice checks → approve → payment needs reference → bank payment → closed, all stages done; mismatched invoice queried from Approvals → shown on the trip; *both* rule shows Mark hard copy received before Pay; booking executive sees why they can't approve |
| `execution.phone.spec.ts` (1) | POD review and invoice panels fit 390 px |
| Earlier phases (88) | re-run as regression; one Phase 3 assertion updated to include the new *Ready for pickup* status |

**Result: 103 passed, 0 failed, on two consecutive full runs.** `next build` and backend `tsc` pass.

## Bugs found and fixed during the phase

1. **Fonts were loaded from Google at runtime.** The full run hit `net::ERR_CONNECTION_RESET` on `fonts.googleapis.com` twice, in unrelated tests. Fonts are now self-hosted with `next/font`: no external request from users' browsers, and no failures when Google is slow.
2. The approvals inbox reason text moved to the server (award and payment); the screen shows it as is.

## Remaining issues and dependencies

- Carrier, driver, receiver and documents steps are **integration stand-ins** until those modules exist. Nothing is messaged to carriers yet.
- **Payment is record-only** (UPI/bank reference). A real UPI payment link is open question §7.7. **Tally posting** is flagged (`postedToErp: false`) for the ERP connector.
- **Claim value per unit is entered by the shipper**, since its source is open question §7.5. **GST** on invoices is still open (§7.4).
- The design's separate claim and invoice detail pages are folded into the trip page's task panel, which saves a click. A dedicated page can be added if stakeholders prefer it.
- Next is **Phase 5** (exceptions): cancel and edit a booking, extend a quote deadline, on-hold exception fixes.
