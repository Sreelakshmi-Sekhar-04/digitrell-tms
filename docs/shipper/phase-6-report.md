# Phase 6 report — Dashboard, reports, activity log, search and message preferences

**Objective:** the screens that summarise the work and help people find things (BRD §3.1
"Trip visibility", "Reports", §6 logging and messaging): the Home dashboard and first-time setup,
Reports, the activity log, search from anywhere, and each person's message preferences.

## Features implemented

### Home (`/`)
- Greeting and one line on what needs you (*"3 decisions are waiting for you."* / *"Nothing needs you right now."*).
- **Needs your decision**: the 3 oldest approvals (awards, payments, exception fixes), each with **Approve** right there (disabled with the reason above your limit) and **Review**. Shows how long it has waited; *See all N* opens Approvals.
- **This month**:
  - trips booked
  - on-time %, against the ETA given at loading
  - freight awarded vs lane budgets
  - PODs waiting for review
- **Active trips**: the 5 most recently updated open trips with their next step.
- **First-time setup** (no trips yet): five steps (addresses, lanes, approved carriers, approval limits, first booking), each ticked when done or linking to the screen that does it.
- **Repeat last booking** opens New booking with the latest booking filled in.

### Reports (`/reports`)
- Period: this month, last month or last 90 days.
- **KPIs:**
  - freight awarded vs budget
  - on-time delivery
  - average POD time (delivery to accepted POD)
  - trips, awards and claims
- **Freight awarded by lane**: one-colour horizontal bars sorted by amount, with the lane budget as a thin dark tick and the exact values in the same table. No legend is needed for a single series; there's a small key, and a hover/focus tooltip on each bar.
- **Carrier scorecard**: trips, on time, POD days, average vs budget.
- **Export trips (CSV)** for the period (opens in Excel; Indian time; UTF-8).

### Activity log (`/reports/activity`)
- Read-only list of every agent action and human decision for the company, newest first, 50 per page.
- Filters: trip number, who (everyone / people / agents and carriers), action type (decisions, money, cancellations and edits, settings and users), period. Trip numbers link to the trip.
- **Export CSV**. Sign-ins are left out (noise).

### Search from anywhere
- Header search (desktop) goes to Trips with the search applied across all dates. The Trips search box keeps in step with the URL without overwriting what you're typing.

### My messages (`/profile/messages`, header link and phone *More* menu)
- Message language, where messages go, quiet hours, and on/off switches for:
  - truck confirmed
  - tracking and delays
  - delivered and POD
  - daily summary
  - invoices

  Approvals are always on.
- Save is enabled only after a change; Discard restores.

## How the figures are calculated (fixed rules)

| Figure | Rule |
|---|---|
| Freight awarded | Sum of awarded amounts for trips awarded in the period (cancelled excluded) |
| Budget | Sum of lane budgets for those trips |
| On time | Delivered at or before the **promised ETA**: the first ETA given at loading. Later delays move the ETA, not the promise |
| Average POD time | Days from delivery to POD accepted |
| vs budget (carrier) | Average of (awarded − budget) / budget, rounded half away from zero |

## APIs and database changes

| Endpoint | Purpose |
|---|---|
| `GET /api/insights/dashboard` | Setup state, top 3 approvals + count, active trips, month figures |
| `GET /api/insights/reports?period=` · `/reports/trips.csv` | Reports and CSV export |
| `GET /api/activity` · `/activity/export.csv` | Activity log and export, company-scoped |
| `GET/PUT /api/profile/messages` | Message preferences |

Migration `20261125110000_dashboard_prefs`: `Trip.promisedEta`, `User.notifyPrefs`, `User.quietHours`.
After merge: `cd backend && npx prisma migrate deploy`.

*Note:* a first draft of this migration had a syntax error. On the dev database it was recorded as failed with nothing applied, marked rolled back with `prisma migrate resolve`, and the corrected file applied. Fresh databases only see the corrected file.

## Playwright tests

| Suite | Cases |
|---|---|
| `insights.api.spec.ts` (7) | first-time setup state; busy dashboard (top 3, count matches inbox, active trips); reports figures from known trips (on-time 50%, lane spend vs budget, scorecard, POD days); last month empty; trips CSV; activity filtered by trip, people, agents, settings, sign-ins excluded, other shipper sees none; activity CSV; message preferences defaults, validation, save |
| `insights.ui.spec.ts` (7) | first-time checklist with done steps and link; approve from Home with badge update; Repeat last booking fills the form; header search from another page; reports KPIs, tables, CSV download, period change; activity log filters and CSV download; My messages save and persist |
| `insights.phone.spec.ts` (1) | Home, Reports, activity log and My messages fit 390 px |
| Earlier phases (123) | re-run as regression. Two Phase 1 checks updated: the placeholder test now asserts that **no** placeholders remain, and the phone *More* menu now includes *My messages* |

**Result: 138 passed, 0 failed, on two consecutive full runs**. `next build` and backend `tsc` pass.

## Bugs found and fixed during the phase

1. Carrier "vs budget" rounded −7.5% to −7% (JavaScript rounds halves up). It now rounds half away from zero (−8%).
2. The Trips search box didn't follow a search arriving from the header. It now syncs from the URL, but never while you're typing.
3. Test only: the "approve from Home" test read the approval reference from the card's combined text and broke when the first item was an invoice. The reference now has its own test id.

## Remaining issues and dependencies

- Message preferences are **stored and respected by the API**; the messaging module that sends WhatsApp, SMS and email will read them.
- On-time % needs the driver bot to send an ETA at loading; trips without one are left out of the percentage, not counted as late.
- Next is **Phase 7**: full end-to-end regression, responsive and design pass, final report.
