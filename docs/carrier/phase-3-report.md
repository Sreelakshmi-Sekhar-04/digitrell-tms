# Carrier phase 3 report — Loads, quotes, approvals and Home

**Objective:** quote requests from shippers reach the carrier desk; the carrier quotes or passes;
quotes outside the rate band go to the owner; the carrier sees every load it is part of, and Home
shows what needs attention (carrier spec C1, C2; flow steps 4–5, 8–9).

## Features implemented

### Loads (`/carrier/loads`)
- Every trip this carrier was asked to quote on, or won. Tabs **All / Needs action / In transit /
  Delivered and billed / Closed** with counts, search by load, shipper or city. Needs action first.
- Status in the carrier's words: Quote requested · Waiting for owner · Quote sent · Won · Ready for pickup ·
  In transit · On hold · Delivered · POD received · Invoiced · Closed · Passed · Not awarded · Request closed · Cancelled.

### Load page (`/carrier/loads/:id`)
- Same 7-stage progress bar as the shipper. Details, documents and an activity list.
- **Quote request panel (design):** your rate card and band in rupees, *your own* average on the lane
  (last 30 days), trucks of that type free on the pickup date with valid documents, time left.
  Amount pre-filled from the rate card. **Pass** with an optional reason.
- **Rules (fixed, not AI):** inside the band and above the margin floor → sent straight to the shipper.
  Outside the band, below the margin floor, or no rate card →
  - a **traffic manager** must give a reason, and it goes to the **owner's Approvals**; nothing is sent yet;
  - an **owner** sends it directly (their quote is the approval). The reasons are shown and logged.
- Panels for won, ready, in transit (truck, driver, ETA, last location), on hold (problem and proposed fix),
  delivered, POD received, invoiced and closed. Actions on those arrive in phases 4–6 (the panels say so).

### Approvals (`/carrier/approvals`)
- Quote-outside-band cards: who asked, why, the band, the deadline. **Approve**, **Change amount**
  (pre-filled with the nearest in-band amount) or **Reject** (optional reason). Owner only; others see
  the cards read-only. The sidebar badge counts them.

### Home (`/carrier`)
- Stats: quote requests open (and when the first closes), trucks free tomorrow, unbilled after POD,
  average margin vs floor (from the rate card's trip cost).
- **Needs your OK** cards (approve straight from Home), invoices waiting for payment, active loads.

### What the carrier never sees (spec §3.2, enforced in the API)
The shipper's budget, other carriers' names, quotes or scores, the winner of a load it lost, the drop
street address before it wins. Activity shows only events about this carrier.

## APIs

| Endpoint | Purpose |
|---|---|
| `GET /api/carrier/loads?group=&q=` | Loads with carrier status and counts |
| `GET /api/carrier/loads/:id` | Load page: quote info (rate card, band, lane average, free trucks), execution, activity |
| `POST /api/carrier/loads/:id/quote` | Send a quote, or ask the owner (202) when outside the rules |
| `POST /api/carrier/loads/:id/pass` | Pass, with a reason |
| `GET /api/carrier/approvals` · `POST /approvals/:id/decide` | Quote approvals: APPROVE / CHANGE / REJECT |
| `GET /api/carrier/home` | Stats, top decisions, active loads |

Quotes go through the same `receiveQuote` service the integration stand-in uses, so the shipper's
comparison, scoring and award work unchanged. No database migration in this phase.

## Demo data

`npm run seed:demo` (in `backend`) books 12 trips as Sunrise Foods and moves them through the real
services: 3 quote requests (one waiting for the owner, one on a lane with no rate card), a quote sent,
won, ready for pickup, in transit, on hold (breakdown), POD received, invoiced, paid and one not awarded.
Re-running rebuilds them. It is **not** part of the Playwright seed, so tests start from an empty trip list.

## Tests

| Suite | Count | Covers |
|---|---|---|
| `carrier.loads.api.spec.ts` | 12 | request priced from rate card; no budget / other quotes leak; in-band quote sent; out-of-band needs reason → owner changes → sent; one pending at a time; reject keeps it open; owner direct; pass; accounts refused; closed request refused; another carrier never sees your quote; won → ready with LR; not awarded hides winner; Home stats; shipper refused |
| `carrier.loads.ui.spec.ts` | 9 | list, tab, search, open; in-band quote; out-of-band → owner changes in Approvals in another session; pass; accounts read-only; no leak on page; won panel and activity; Home stats and approve from Home; traffic manager read-only approvals |

**Full run:** 204 / 204 passed (81 carrier + 123 shipper regression).

Changed: `carrier.foundation.ui.spec.ts` placeholder test now covers Reports only; the badge test
compares with the inbox count.

## Decisions taken (please confirm)

- **Traffic manager may quote inside the band.** The spec gives quotes to the owner only, but the design
  shows a dispatcher's out-of-band quote going to the owner. Default: traffic manager quotes inside the
  band; outside it, the owner approves.
- **Lane average** uses only this carrier's own recent trips, never other carriers' prices.
- Lists show the most recent 300 loads.
