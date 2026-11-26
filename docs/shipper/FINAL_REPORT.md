# Shipper module — final report

**Result:** the Shipper module of DigitRell TMS Release 1 is complete. A shipper can set up lanes,
carriers, users and policies; book a truck; compare scored quotes and award; follow the trip; handle
problems on the road; review the POD and raise claims; check, approve and pay the carrier's invoice;
and see it all on the Home dashboard, in Reports and in the activity log. Built over 7 phases, each
reviewed and merged through its own pull request, with **148 Playwright tests passing on two
consecutive full runs**.

## 1. Phases

| # | Phase | PR | Tests at merge |
|---|---|---|---|
| 1 | Foundation: design system, app shell, sign-in, API skeleton, test harness | [#1](https://github.com/Sreelakshmi-Sekhar-04/digitrell-tms/pull/1) | 30 |
| 2 | Master data and policies: addresses, lanes, carriers, users and invites, policies | [#2](https://github.com/Sreelakshmi-Sekhar-04/digitrell-tms/pull/2) | 64 |
| 3 | Booking, quotes and award, approvals inbox, trips list | [#3](https://github.com/Sreelakshmi-Sekhar-04/digitrell-tms/pull/3) | 88 |
| 4 | Execution, POD, claims, invoices and payment | [#4](https://github.com/Sreelakshmi-Sekhar-04/digitrell-tms/pull/4) | 103 |
| 5 | Exceptions: cancel, edit, widen quote requests, on-hold fixes | [#5](https://github.com/Sreelakshmi-Sekhar-04/digitrell-tms/pull/5) | 123 |
| 6 | Dashboard, reports, activity log, search, message preferences | [#6](https://github.com/Sreelakshmi-Sekhar-04/digitrell-tms/pull/6) | 138 |
| 7 | Integration and final validation (this phase) | [#7](https://github.com/Sreelakshmi-Sekhar-04/digitrell-tms/pull/7) | 148 |

Phase reports: `phase-1-report.md` … `phase-6-report.md`. API: `API.md`. Plan and open questions: `IMPLEMENTATION_PLAN.md`.

## 2. The shipper workflow, end to end (BRD §5)

| BRD step | What the shipper does or sees | Where |
|---|---|---|
| 1–2 Request and booking | Six-field form, saved addresses, defaults, repeat, draft kept, confirm with the exact carriers | New booking |
| 3–4 Quote requests, carriers quote | Waiting panel with each carrier's state; extend, ask more carriers | Trip |
| 5–6 Compare and award | Scored, ranked quotes with reasons; award any; undo for 10 min; reject all with reason; lane auto-award rules | Trip, Approvals, Home |
| 10–12 Truck and documents | Truck, driver, LR, e-way bill with expiry | Trip |
| 13, 15 In transit, exceptions | ETA, location; delays as notices; on-hold problems with fixes to approve or reject | Trip, Approvals |
| 16–17 Delivered, POD | Receiver's counts; clean POD accepted by rule; otherwise review, claim, accept | Trip |
| 18 Invoice | Lines and automatic checks; approve (or by rule within limits); query | Trip, Approvals |
| 20 Payment, close | Record UPI/bank payment; POD rule enforced; trip closes | Trip |
| — | Cancel (before delivery) and edit (rules by stage) | Trip header |
| — | Dashboard, reports, activity log, search, message preferences | Home, Reports, header, My messages |

The **end-to-end journey test** (`e2e/tests/journey.ui.spec.ts`) runs the whole path above in the
browser, playing the carrier, driver and receiver through the integration endpoints, then checks the
trip in Trips (Closed), the activity log (every step) and Home (no longer active).

## 3. Screens vs the approved design

Screenshots of the key screens are in `screenshots/` (`npm run capture` in `e2e/` refreshes them).

| Design screen | Built | Notes |
|---|---|---|
| Home (decisions, month, active trips, first-time setup) | Yes | Approve and Review inline; reject goes through Review (it needs a reason) |
| Trips list with tabs and filters | Yes | Plus search from the header on desktop |
| Trip detail (progress, task panel, details, documents, activity) | Yes | Phones show quote **cards**, as designed |
| New booking + confirm | Yes | *Paste a message* is not built (it belonged to the WhatsApp bot, which was dropped) |
| Approvals inbox | Yes | Awards, payments, exception fixes |
| Carriers and lanes (tabs) with drawers; invite user | Yes | |
| Policies | Yes | Bid evaluation can't be set to act alone (BRD §7) |
| Reports | Yes | Lane bars with budget ticks; scorecard; CSV |
| Activity log | Yes | |
| Claim and invoice detail | In the trip page's task panel | One fewer click than separate pages; can be split out if preferred |
| Cancel trip dialog | Yes | Void LR is the carrier's (documents module) |
| My messages | Yes | |
| Desk app at phone width | Yes | 4 bottom tabs + More, cards for quotes |
| WhatsApp bot, driver and receiver chats | Dropped | See `docs/whatsapp-bot-removal.md` |

Design tokens (colours, fonts, radii, 44 px targets) are checked by tests. Fonts are self-hosted.

## 4. Test summary (Playwright, Chrome)

| Area | API | Desktop | Phone | Tablet |
|---|---|---|---|---|
| Sign-in, shell, navigation, 404 | 11 | 16 | 3 | |
| Masters, users, invites, policies | 18 | 14 | 2 | |
| Booking, quotes, award, approvals, list | 13 | 9 | 2 | |
| Execution, POD, claims, billing | 8 | 6 | 1 | |
| Exceptions | 11 | 8 | 1 | |
| Dashboard, reports, activity, messages | 7 | 7 | 1 | |
| Phase 7: hardening, journey, failures, keyboard, layout | 4 | 5 | | 1 |

**148 passed, 0 failed, on two consecutive full runs** (`npm test` in `e2e/`). `next build` and backend `tsc` pass.

What the suite covers across phases:
- **Rules and isolation:** every business rule on the server, permissions and approval limits, cross-company isolation.
- **Data entry:** validation that keeps what was typed, duplicates.
- **Flows:** status changes, empty states.
- **Reliability:** network and server failures (recover with Try again; input kept), expired sessions, no browser console errors in any UI test.
- **Use and layout:** keyboard-only use, phone (390 px) and tablet (768 px) layouts.

## 5. Security

- Passwords hashed with scrypt; sessions are random 256-bit bearer tokens, 12 h; deactivating a user ends their sessions.
- **Phase 7:** failed sign-ins throttled (5 per email per 15 min → 429).
- **Phase 7:** `CORS_ORIGIN` restricts which web origins may call the API.
- **Phase 7:** security headers (`nosniff`, `DENY` framing, no referrer); framework banner removed.
- No password hashes or invite tokens in any response (tested).
- Integration endpoints need `INTEGRATION_KEY`; test tools are off in production.
- **Known limits:**
  - The session token is kept in the browser's local storage, so a cross-site-scripting bug could read it. React escapes output, but an HttpOnly cookie is the stronger option before go-live.
  - Sign-in throttling is per API instance; use a shared store (e.g. Redis) if you run several.

## 6. Deployment checklist

1. `backend/.env`: `DATABASE_URL`, `CORS_ORIGIN=https://<web app>`, `INTEGRATION_KEY=<long random>`, `NODE_ENV=production`.
2. `npx prisma migrate deploy` (never `migrate dev` on shared databases).
3. Backend: `npm run build && npm start`. Frontend: `NEXT_PUBLIC_API_URL=https://<api>/api npm run build && npm start`.
4. Create the first company and logistics head (the seed is for development and tests only).

## 7. Open business questions (`IMPLEMENTATION_PLAN.md` §7)

| # | Question | What the code does now |
|---|---|---|
| 1 | Web login: password or phone OTP? | Email + password |
| 2 | Bid score weights | 40 price / 30 on time / 20 POD / 10 acceptance (one constant) |
| 3 | Award undo window | 10 minutes (one constant) |
| 4 | GST on freight invoices | Not calculated; shown as "to confirm" |
| 5 | Claim value per unit | Entered by the shipper |
| 6 | Approval routing above a limit | Goes to someone with a higher limit; nobody grants above their own |
| 7 | Payment | Record-only (UPI/bank reference); Tally flag kept |
| 8 | Cancellation charges | Not calculated; dialog says to follow the carrier agreement |

## 8. Dependencies on other modules

| Needed from | For | Today |
|---|---|---|
| Carrier module | Quotes, truck, LR/e-way bill, claim responses, invoices | Integration endpoints |
| Driver app / tracking | Status, ETA, location, POD photo, problems | Integration endpoints |
| Email notifications | Invites, approvals, updates, honouring My messages | Preferences stored; links shown to copy |
| ERP connector (Tally) | Posting payments | `postedToErp` flag |
| Payments | UPI pay links | Record-only |

## 9. After Release 1: WhatsApp bot removed, demo data added

The WhatsApp bot was dropped. Its placeholders, contract, message log, channel choice, intake agent
and every WhatsApp mention on screen are gone; email is now required for new users. A demo company
with 31 trips can be loaded with `npm run demo:load`. See `docs/whatsapp-bot-removal.md` and
`docs/demo-data.md`.

## 10. Phase 7 changes

- **Tests:**
  - end-to-end journey
  - network/server failure and expired-session tests
  - keyboard-only test
  - tablet layout test
  - security tests
  - screenshot capture
- **Fixed (found by reviewing the screenshots):**
  - phones now show quote cards instead of a sideways-scrolling table
  - Reports lane table no longer cut off (cards stacked full width)
  - "waiting 0 min" → "under 1 min"
  - Quote column header aligned with its amounts
- **Fixed (tooling):**
  - the Playwright config skipped the web app whenever the API project was in the list; it now skips it only for API-only runs
  - the console-error allowance takes a single pattern
- **Security:** sign-in throttling, configurable CORS, security headers.
- **Docs:** README brought up to date, `API.md`, this report, screenshots.
- **Correction:** the Phase 5 and Phase 6 reports and PR descriptions overstated the new API tests by one each. The actual counts are 11 and 7, so 20 and 15 new tests. The totals at each merge (123 and 138) were correct. Fixed in the phase reports.
