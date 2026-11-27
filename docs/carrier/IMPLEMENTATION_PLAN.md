# Carrier module — implementation plan

Scope: the carrier's **web desk** for Release 1, built to the approved UI design
(`docs/design/ui-prototype`, carrier side of `Main.dc.html` plus `Forms`, `CancelVoid`, `Journeys`,
`Mobile`) and the flow spec *"TMS – Shipper and Carrier: Flow, Screens, Access and Checks"*
(24 Nov 2026, steps 1–22, sections 3 and 4).

**Out of scope for this module:** WhatsApp bot flows (carrier, driver, receiver), vendor / truck-owner
sourcing (rate requests to vendors, counter-offers, vendor award, truck-owner advances and balances),
plant gate and loading (shipper's yard system), part loads and multi-drop.

## 1. What exists today

| Area | State |
|---|---|
| Stack | Express 4 + TypeScript + Prisma 5 (PostgreSQL); Next.js 14 App Router + Tailwind; Playwright |
| Shipper module | Phases 1–5 merged (booking, quotes, award, execution, POD, claims, invoices, exceptions). Phases 6–7 pending |
| Carrier side | Nothing. Carrier users are **blocked** at login (`requireShipper`, foundation test "carrier blocked") |
| Carrier data | Seeded carrier companies (Kaveri, NorthStar, Deccan, Sai Ganesh) and `CarrierPerformance`. `Truck`, `Driver`, `RateCard`, `LrSeries` tables exist but are bare and unused |
| Stand-ins | `backend/src/modules/integration` plays the carrier for shipper tests: `/quotes`, `/trips/:n/truck`, `/events`, `/delivered`, `/pod`, `/claims/:n/response`, `/trips/:n/invoice`, `/exceptions…` |
| Reusable | Design tokens, UI kit (`Button`, `Field`, `Chip`, `Card`, `Tabs`, `Drawer`, `Dialog`, `Toast`), `AppShell`, `TripStatusChip`, audit log, approvals table, error format |

## 2. Roles and access

The spec's roles are used (section 3.1). One person may hold several roles, so a user can have more
than one. The design's "Dispatcher" = Traffic Manager; "LR clerk" folds into Traffic Manager.

| Screen / data | Owner / KAM | Traffic Manager | Accounts |
|---|---|---|---|
| Company profile, GST, bank | E | V | V |
| Rate cards, lanes served | E | V | V |
| Users and roles | E | – | – |
| Quote requests and quotes | E (own only) | V | – |
| Accept a trip and confirm truck | E | E | – |
| Assign truck and driver | V | E | – |
| Trucks and documents | V | E | V |
| Drivers (licence, UPI) | V | E (UPI change: maker-checker) | V |
| Breakdowns and truck swaps | A | E | – |
| LR issue / void (carrier-issued; shipper views and prints) | – | – | – |
| Compliance override | A (named, with reason) | – | – |
| Invoices to the shipper | A (above limit) | – | E |
| Policies (band, margin floor, limits, autonomy) | E | V | V |
| Reports and own scorecard | V | V | V (money only) |

**The carrier never sees:** other carriers' quotes, the shipper's budget, the agent's scores of other
carriers. Enforced in the API, not just hidden in the UI.

## 3. Carrier screens (from the design)

Navigation (design order): **Home · Loads · Approvals · Fleet and rates · Reports · Policies**.
Phone: Home, Loads, Approvals as bottom tabs, the rest under *More*.

| Screen | Spec ref | Key functions |
|---|---|---|
| Login | — | Same login; carrier users land on the carrier desk, shipper users on the shipper desk; each is blocked from the other |
| Home | C2 | 4 stats (quote requests open, trucks free tomorrow, unbilled after POD, average margin); *Needs your OK* cards with who prepared them and the rule checked; active loads; *Open quote requests* button |
| Loads | — | Tabs (All / Needs action / In transit / Delivered and billed / Closed), shipper column instead of carrier, search, filters |
| Load detail | C1, C1A, steps 9–19 | Same 7-stage progress as the shipper. Task panels: **Send quote** (rate card, band, lane average, free trucks, pass) · **Accept and confirm truck** (placement deadline, decline with reason) · **Assign truck and driver** (free compliant trucks first, document check) · **Documents** (LR issue, void and reissue, e-way bill no.) · **On the road** (record status, ETA, ask location) · **Breakdown fix** (swap / wait, cost, payer) · **POD** (upload, claim accept/dispute) · **Invoice** (send, reminder) · Closed. Details, documents, activity |
| Approvals | C2 | Quote outside band · exception fix · invoice above limit · compliance override; Approve / Change / Reject; empty state |
| Fleet and rates | C3, C5, C6 | Tabs: **Trucks** (number, type, ownership own/attached, insurance, fitness, status Ready/Expiring/Blocked/On trip) · **Drivers** (mobile, licence class + validity, language, UPI, current trip) · **Rate cards** (shipper or any, lane, truck type, rate, band, validity) · **Users and roles**. Right-side drawer for add/edit (Add truck: fetch details, document list with expiry warnings, ownership, usual driver) |
| Policies | C3 | Rate band (±%), margin floor (%), invoice approval limit, backup approver, autonomy for Quote / Truck assignment / Documents / Billing agents |
| Reports | — | Freight billed, average margin, unbilled after POD, overdue receivables; margin by lane; shipper scorecard (trips, on time, POD days, pays in N days); export |
| Void LR dialog | — | Consequences listed, reason required, number never reused, new LR issued |
| Activity log | — | Read-only, filterable |

## 4. Database changes (by phase)

- **P1** `User.roles` (string array) for carrier roles; `CarrierPolicy` (bandPct, marginFloorPct, invoiceApprovalAbove, backupApproverId, autonomy JSON) with defaults.
- **P2** `Truck`: ownership (OWN / ATTACHED), make/model, capacityKg, pucExpiry, status, usualDriverId, isActive. `Driver`: licenceClass, language, upiId, upiVerifiedAt, status. `RateCard`: validFrom/validTo, isActive, estimated trip cost (for the margin floor), relations. `Company`: gstin, pan, bank details, gstOption, tdsDeclaration. `LrSeries` set-up screen. Pending UPI change (maker-checker).
- **P3** `Quote`: passReason, sentById, approvalId; quote approvals (`Approval.kind = QUOTE`).
- **P4** `Trip`: acceptedAt, acceptedById, declineReason, placementDeadline; `Document` LR with void reason and replacement link; compliance override record (who, reason, document).
- **P5** `TripEvent` writes from the carrier side; exception proposals made by the carrier.
- **P6** invoice series per carrier; invoice draft → approval → sent.
- Every change writes `AuditLog` (who, what, when, old and new value).

## 5. APIs (all under `/api/carrier`, bearer session, carrier users only)

`me` · `home` · `loads` (list, detail) · `quotes` (send, pass) · `loads/:id/accept`, `/decline` ·
`loads/:id/assign` (truck, driver, compliance result) · `documents` (issue LR, void and reissue,
record e-way bill no.) · `loads/:id/events` (reached pickup, loaded, gate-out, reached drop, unloaded) ·
`exceptions` (report, propose, resolve) · `pod` · `claims/:id/respond` · `invoices` (draft, send,
remind) · `approvals` (inbox, decide) · `fleet/trucks`, `fleet/drivers`, `rate-cards`, `users`,
`profile`, `policies` · `reports` · `audit`.

The real carrier endpoints and the existing `integration` endpoints call the **same services**, so the
shipper's Playwright suites keep passing. Integration endpoints are removed only after phase 8, with
lead review.

## 6. Phases

| # | Branch | Delivers |
|---|---|---|
| 1 | `feature/carrier-phase-1-foundation` | Carrier login and access (remove the block for carrier users only), role-based redirect, carrier app shell and nav (desktop + phone), carrier roles, `/api/carrier` skeleton, Playwright fixtures for carrier users, placeholders for every screen |
| 2 | `feature/carrier-phase-2-fleet-rates` | Fleet and rates: trucks (fetch-details stub, document expiry → Ready/Expiring/Blocked), drivers (licence class, UPI with maker-checker), rate cards with band and validity, users and roles, company profile and LR series, policies |
| 3 | `feature/carrier-phase-3-quotes` | Loads list and detail; quote request panel (rate card, band, lane average, free trucks); send inside band; outside band → owner approval; pass; approvals inbox; quote visibility rules. Replaces `integration/quotes` |
| 4 | `feature/carrier-phase-4-accept-assign` | Won load: accept by placement deadline or decline with reason; assign truck and driver; compliance check (expired document or wrong licence class blocks); named override with reason; LR from the carrier series (PDF with QR), void and reissue; e-way bill number. Replaces `integration/truck` |
| 5 | `feature/carrier-phase-5-execution` | Record trip events for the driver; ETA; report breakdown, propose swap / wait with cost and payer, approve, swap re-runs compliance; POD upload; accept or dispute a claim. Replaces the events / delivered / pod / exceptions / claims integration endpoints |
| 6 | `feature/carrier-phase-6-billing` | Invoice when the shipper's POD rule is met; amounts from award, detention, accepted claims (fixed rules, never AI); approval above limit; send; payment reminder; paid status. Replaces `integration/invoice` |
| 7 | `feature/carrier-phase-7-home-reports` | Home dashboard and *Needs your OK* cards, reports, shipper scorecard, activity log, export |
| 8 | `feature/carrier-phase-8-integration` | Shipper ↔ carrier end-to-end regression with no integration endpoints, responsive pass, design check, final report |

Each phase: build → run the app → Playwright (UI + API, positive and negative, both roles where they
touch) → fix → rerun all previous carrier **and shipper** suites → push → PR → review.

## 7. Open questions (need a business decision; a default is used and marked in code)

1. **Design vs 24 Nov spec.** The design was drawn against the 18 Nov BRD. Where they differ, this plan follows the **design for screens** and the **spec for roles, access and checks**. Confirm.
2. **Invoice per trip or monthly freight bill?** The design and the shipper module invoice per trip. The spec (C8, step 19) wants one monthly bill per shipper. Default: per trip in phase 6, with the monthly bill as a later phase. This changes the shipper side too.
3. **Rate contracts and contract allocation** (spec step 3, S8, C1A) are in neither the design nor the shipper build. Default: spot quotes only for now; contract allocation needs a shared decision with the shipper module.
4. **Screens in the spec but not the design:** C4 contacts and message routing, C7 driver advance and settlement. Default: C4 left out (needs the bot); C7 left out until the advance rules are confirmed. Company profile (C3) is added as a tab under *Fleet and rates*.
5. **VAHAN / SARATHI access** needs ULIP registration or a licensed provider. Default: *Fetch details* is a stub; documents and expiry dates are entered by hand and checked by the same rules.
6. **Driver actions without the bot.** Default: the Traffic Manager records reached pickup, loaded, reached drop and the POD photo on the driver's behalf from the load page.
7. **Margin floor** needs a trip cost. Default: an estimated cost per rate-card line; margin = (quote − cost) / quote.
8. **Placement deadline.** Default: reporting time at the plant minus 2 hours; no answer by then = not accepted (recorded on the scorecard).
9. **Award undo window.** The shipper has a 10-minute undo, so the carrier is told about a win only after it ends. Confirm.
10. **GST on freight** (forward charge or reverse charge per carrier) and the invoice number series format.

## Change: LR is carrier-issued (27 Nov 2026, final)

The carrier generates the LR from its own LR series (`LrSeries.carrierId` = carrier company; set in Company profile, owner only, prefix and next number, locked once an LR is issued). Truck assigned is a carrier task ("Issue the LR"): `POST /api/carrier/loads/:id/lr {ewayBill?}` and `/lr/reissue {reason, ewayBill?}` (owner or traffic manager; errors NO_LR_SERIES, WRONG_STATE, fields.ewayBill), `GET /api/carrier/loads/:id/lr` to print; series at `GET/PUT /api/carrier/lr-series`. Void and reissue stays until pickup is recorded; numbers are never reused. The shipper sees "Carrier to issue the LR" and can only view and print the LR (`GET /api/trips/:id/lr`); its LR panels, LR series card and `/api/policies/lr-series` are removed.
