# Shipper module — implementation plan

Scope: the Shipper side of Release 1 (BRD §3.1, §4.1–4.4, §4.8–4.11, §5–7), built to the approved
UI design ("DigitRell TMS UI Design" canvas). Carrier, vendor, driver and admin modules are out of
scope except for the minimal integration points listed under *Dependencies*.

## 1. What exists today

| Area | State |
|---|---|
| Stack | Express 4 + TypeScript + Prisma 5 (PostgreSQL) backend; Next.js 14 App Router + Tailwind frontend |
| Backend | `/health` only. Module folders are empty placeholders |
| Database | First migration applied: Company, User, Lane, Truck, Driver, RateCard, LrSeries, Trip, Quote, Document, Approval, MessageLog, AuditLog |
| Frontend | Starter page only |
| Tests | None. The Tropicana WMS repo has a Playwright setup (own DB `<name>_test`, own ports) that we reuse |

## 2. Shipper screens (from the approved design)

| Screen | Purpose | Key functions |
|---|---|---|
| Login | Web sign-in | Email + password, inline errors, return to the page you came from |
| Home | What needs me now | Decisions with inline Approve/Review/Reject, active trips, 4 month stats, quick actions, first-time setup checklist |
| Trips | All trips | Tabs (All / Needs action / In transit / Delivered and billed / Closed), lane and date filters, search, pagination |
| Trip detail | One trip | 7-stage progress, stage task panel (waiting for quotes, compare and award, awarded + undo, in transit, on hold fix, POD + claim, invoice + pay, closed), details, documents, activity |
| New booking | Create booking | 6 fields with defaults, repeat a recent booking, optional extras, inline validation, confirm step |
| Approvals | Decision inbox | Award, exception fix, claim, payment; Approve / Change / Reject; empty state |
| Carriers and lanes | Masters | Tabs: lanes (+approved carriers, budget, award rule), addresses, users and roles; add/edit drawer; invite user |
| Policies | Rules | Autonomy per agent, approval limits, quote window, POD rule |
| Reports | Insight | Spend vs budget, on-time %, POD time, spend by lane, carrier scorecard, export |
| Claim detail, Invoice detail | Money records | Claim evidence and status; invoice lines checked against award; pay |
| Cancel booking dialog | Irreversible action | Reason required, consequences listed |
| Activity log | Audit | Filterable, read-only |
| My messages | Preferences | Language, channel, quiet hours, message types |

## 3. Database changes (by phase)

- **P1** `User.passwordHash`, `User.isActive`; new `Session` (token, user, expiry).
- **P2** `Address`; `Lane.budget`, `Lane.awardRule`, `Lane` → addresses; `LaneCarrier` (approved carriers per lane); `ShipperPolicy` (limits, quote window, POD rule, autonomy JSON); user approval limit, backup approver.
- **P3** `Booking` fields on `Trip` (pickup/drop address ids, reference, receiver, notes, quote deadline); `Quote` status + carrier stats snapshot; `Award` record; trip number series (`TR-…`).
- **P4** `TripEvent` (status timeline); `Document` kinds LR/EWB/POD; `Claim`; `Invoice`, `InvoiceLine`, `Payment`.
- **P5** cancellation reason, exception (`TripException` with proposed fixes).
- Every status change and decision writes `AuditLog` (BRD §6).

## 4. APIs (all under `/api`, JSON, bearer session token)

`auth` (login, logout, me) · `masters` (addresses, lanes, lane carriers, users, invites) · `policies` ·
`bookings` (create, confirm, repeat, parse-later) · `trips` (list/filter/search, detail, cancel) ·
`quotes` (list per trip, score) · `awards` (approve, change, reject, undo) · `approvals` (inbox, decide) ·
`claims` · `invoices` (detail, pay) · `reports` · `audit`.

Errors: `{ "error": { "code", "message", "fields"? } }` with proper HTTP status.

## 5. Dependencies on other modules and how we handle them

| Shipper needs… | Owned by | Plan for now |
|---|---|---|
| Carrier quotes | Carrier module (quote agent) | Minimal `POST /api/integration/quotes` endpoint (no UI) + seed data. Playwright uses it to play the carrier |
| Truck, LR, e-way bill | Carrier / documents module | Integration endpoint to mark a trip "truck confirmed" with truck/driver/LR; LR series stays carrier-owned |
| Tracking status, POD | Driver bot / tracking module | Integration endpoints for status events and POD upload |
| Carrier invoice | Carrier billing | Integration endpoint to raise an invoice against a trip |
| WhatsApp booking and approvals | Bot layer (lead) | Out of this module. Approvals are stored once, so the bot can reuse them later |
| Payment (UPI) | Payment provider | Record payment with reference; real UPI link later |
| Tally | ERP connector | Out of scope; payment record keeps a `postedToErp` flag |

These endpoints are clearly marked `integration` and will be replaced by the real modules.

## 6. Phases (reordered from the suggested list)

Dashboard summarises trips, approvals and spend, so it is built **after** the data it shows exists.

| # | Branch | Delivers |
|---|---|---|
| 1 | `feature/shipper-phase-1-foundation` | Design tokens, UI components, app shell (sidebar + phone bottom tabs), routing for all shipper screens, login/logout/session, shipper-only access, API skeleton + error format, Playwright harness |
| 2 | `feature/shipper-phase-2-masters` | Addresses, lanes + approved carriers + budgets + award rule, users and roles, invite, policies. Drawers, validation, duplicates |
| 3 | `feature/shipper-phase-3-booking-award` | New booking (defaults, repeat, confirm), trip list, trip detail, tender with deadline, quote comparison and scoring, award / change / reject / undo, approvals inbox |
| 4 | `feature/shipper-phase-4-execution-billing` | Truck confirmed, in transit, delivered, POD rule, claims, invoices, payment, close |
| 5 | `feature/shipper-phase-5-exceptions` | Cancel with reason, edit booking, no-quote deadline options, exception fixes (on hold), draft keeping, error recovery |
| 6 | `feature/shipper-phase-6-dashboard-reports` | Home dashboard, first-time checklist, reports, activity log, search, message preferences |
| 7 | `feature/shipper-phase-7-integration` | Full end-to-end regression, responsive pass, design check, final report |

Each phase: build → run app → Playwright (UI + API, positive and negative) → fix → rerun previous suites → push → PR → wait for review.

## 7. Open questions (need a business decision; marked in code where a default is used)

1. **Web login method.** BRD says "user ID or email". Phase 1 uses email + password. Should it be OTP to the phone instead?
2. **Bid score weights.** BRD names price, on-time, POD speed, acceptance but no weights. Default proposed: 40 / 30 / 20 / 10, configurable.
3. **Award undo window.** The design shows a 10-minute undo, which means losing carriers are told after 10 minutes. Not in the BRD — confirm.
4. **GST on freight invoices.** Rate and forward/reverse charge — confirm with accounts.
5. **Claim value source.** Design uses the shipper's invoice value per carton. Where does that value come from (ERP, manual)?
6. **Approval routing.** If the approver has no limit high enough, who is next — the logistics head only, or a chain?
7. **Payment.** Record-only in Release 1, or a real UPI collect/pay link (which provider)?
