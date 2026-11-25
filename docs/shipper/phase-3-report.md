# Phase 3 report — Booking, quotes and award

**Objective:** the shipper's core workflow up to the award (BRD §4.1–4.4, §5 steps 1–6): book a
truck, ask the lane's approved carriers for quotes, compare them with a scored recommendation,
and award — with one-tap approvals, limits and an audit trail.

## Features implemented

### New booking (`/bookings/new`)
- Pickup and drop from saved addresses (pickup-only / drop-only addresses are filtered), pickup date (defaults to tomorrow, IST), weight, truck-type chips, material; optional receiver contact, reference and notes behind "+ Receiver contact, reference, notes".
- **Repeat a recent booking**: the last 3 different bookings fill the form in one click.
- **Draft kept on this device** as you type (cleared after confirming).
- **Check and confirm** step built from the server's preview: lane, date, load, the exact carriers who will be asked, budget and award rule, and the close time (window adjustable from 1 to 24 h).
- Clear errors: every missing or invalid field at once; past dates; pickup = drop; wrong address type; weight 0.1–60 t; **no lane with approved carriers** → a banner with a link to Carriers and lanes (head) or "ask your logistics head".
- No addresses yet → an empty state that sends you to add them.

### Tender and quotes
- On confirm: trip number from a database sequence (`TR-24101`, `TR-24102`, …, never reused), status *Quotes requested*, a quote request per approved carrier, and a deadline from the policy's quote window.
- The request closes when every carrier has answered or the deadline passes (checked on every read). With no quotes, the trip moves to *Needs action* with "No quotes: ask again or change carriers".
- The carrier side is played by an **integration endpoint** (`POST /api/integration/quotes`, key-protected) until the carrier module exists.

### Compare and award (trip detail, `/trips/[id]`)
- 7-stage progress bar; one task panel for the current stage.
- **Choose a carrier**: quotes ranked by score, with vs-budget, on-time %, POD days, acceptance and score; the recommended carrier pre-selected; carriers still waiting or who passed shown below. A plain-language reason ("₹700 more than the cheapest quote, but 96% on time… Deccan Freight Carriers is cheapest at ₹41,800, but 84% on time…").
- **Award** any quoted carrier with one click; the button names the carrier and amount. **Undo** for 10 minutes. **Reject all and ask again** with a required reason.
- People who can't approve see why before clicking: booking executives ("Your role can't approve awards") and approvers above their limit.
- Details, documents (placeholders until the truck is confirmed) and an **activity** log with who did what.

### Rules (server-side, BRD §4.4, §6, §7)
- Score = 40% price + 30% on time + 20% POD speed + 10% acceptance (**weights to confirm**, plan §7.2). Carriers without a track record get neutral values and the reason says "no track record yet".
- Nobody approves above their own limit; booking executives can't approve.
- **Automatic award lanes**: the lowest quote within budget is awarded when quotes close, **except** for a first trip with a carrier (needs a person) or when the lowest quote is over budget. Both cases are logged and go to the inbox.
- On award: winner *Awarded*, other quotes *Not chosen*, unanswered requests closed; late quotes are refused.
- Undo within 10 minutes reopens the choice; after that it is refused (**10-minute window to confirm**, plan §7.3).
- Every booking, quote, close, award, undo and rejection is written to the audit log.

### Approvals inbox (`/approvals`) and menu badge
- Pending carrier awards with recommendation, reason, quoted count, amount and how long it has waited.
- **Approve** awards the recommended carrier; **Change** opens the trip to pick another; **Reject** asks for a reason inline and re-requests quotes.
- Approve is disabled, with an explanation, above your limit. A count badge on *Approvals* (desktop and phone) updates after every decision.

### Trips list (`/trips`)
- Tabs with counts (All, Needs action, In transit, Delivered and billed, Closed); search by trip no., city, carrier, reference or material; lane and period filters; 20 per page; filters kept in the URL; empty states for "no trips yet" and "no trips match" (with Clear filters).

## APIs and database changes

| Endpoint | Purpose |
|---|---|
| `POST /api/bookings/preview` | Validate and show lane, carriers, close time; creates nothing |
| `POST /api/bookings` | Create the booking and send quote requests |
| `GET /api/bookings/recent` | Last 3 different bookings for Repeat |
| `GET /api/trips` | List with `tab`, `q`, `laneId`, `days`, `page`, plus counts |
| `GET /api/trips/:id` | Detail with scored quotes, recommendation, activity |
| `POST /api/trips/:id/award` · `/undo-award` · `/retender` | Award, undo, reject all and ask again |
| `GET /api/approvals` · `POST /api/approvals/:id/approve` · `/reject` | Inbox |
| `POST /api/integration/quotes` | **Integration point** for the carrier module (header `X-Integration-Key`) |
| `POST /api/integration/trips/:number/expire-quotes` · `/age-award` | Test tools, disabled in production |

`/api/auth/me` and login now also return the user's `approvalLimit`.

Migrations `20261125070000_booking_award` and `20261125071000_quotes_closed`:
- trip-number sequence and `Trip.number`
- trip pickup/drop addresses, receiver contact, reference, notes, quote deadline, quotes-closed time, award fields, creator
- `Quote.status`, nullable amount, `quotedAt`, carrier relation, one quote per carrier per trip
- `Approval.companyId` and trip relation
- new `CarrierPerformance` table (seeded; owned later by the carrier/tracking modules)

The seed adds track records for the 4 carriers and **Priya Nair** (approver up to ₹40,000) for limit tests.
After merge: `cd backend && npx prisma migrate deploy && npm run seed`. Set `INTEGRATION_KEY` in production.

The e2e setup now rebuilds the test database by replaying migrations (`prisma migrate reset`) instead of `db push`, so tests run the same SQL as production, including the sequence.

## Playwright tests

| Suite | Cases |
|---|---|
| `trips.api.spec.ts` (13) | preview and booking with 4 quote requests and sequential numbers; all booking field errors; no-lane message creates nothing; cross-company isolation; scoring, ranking, reason text and inbox item; booking executive and approver-limit refusals; award non-recommended → losers/withdrawn, inbox cleared, late quote refused; approve via inbox, double-approve refused, undo reopens, undo after window refused; reject needs reason then re-requests; deadline with no quotes → Needs action, re-tender; all answered closes early; automatic award (first trip needs a person → awarded automatically next time → over budget needs a person); list search/tabs/lane filter/counts; integration key required |
| `trips.ui.spec.ts` (9) | empty booking errors, full booking with reference and window change → trip page; no-lane banner with link, form kept; draft survives navigation, Repeat fills form, Edit from confirm; compare with recommendation pre-selected, award another, undo, award; reject needs reason → waiting; booking executive blocked with reason; inbox badge, approve, badge decrements, reject with reason; approver above limit sees disabled Approve with reason; list search, tab counts, empty state, Clear filters, row opens trip |
| `trips.phone.spec.ts` (2) | trip detail and quote table fit 390 px; booking form fits |
| Earlier phases (64) | re-run as regression (2 Phase 1 assertions updated for the Approvals count badge and for Trips no longer being a placeholder) |

**Result: 88 passed, 0 failed, on two consecutive full runs.** `next build` and backend `tsc` pass.

## Bugs found and fixed during the phase

1. **Trips list: Clear filters could bring back the old filters.** A delayed search update, and Clear filters' own URL change, both read the URL before it had updated. Now Clear cancels the pending search, and every filter change builds on the last requested filters.
2. Tab names read "All12" for screen readers; there's now a real space ("All 12").
3. Test isolation: Phase 2 tests changed the seeded lanes that Phase 3 relies on. They now use their own lane, or restore the seeded one. The automatic-award test uses its own carriers so "first trip" doesn't depend on test order.
4. Test helper didn't escape "?" in labels; the toast check after a first dev compile was timing-sensitive and was replaced with a check of the trip's activity.

## Remaining issues and dependencies

- **Carrier side is simulated.** Quotes come in through the integration endpoint until the carrier module exists. **Losing carriers aren't messaged yet**; that needs the messaging module.
- **Paste a message / WhatsApp booking** (intake agent, BRD §4.1) is the lead's bot module; the booking page says it is coming.
- Business confirmations needed: score weights (§7.2), the 10-minute undo (§7.3), the approval-limit rule from Phase 2.
- Extending a deadline, cancelling a booking and editing a booking after confirmation come in **Phase 5** (exceptions), as planned. Today you can reject and re-request quotes.
