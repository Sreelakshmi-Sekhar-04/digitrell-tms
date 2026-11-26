# Shipper module — API reference

All endpoints are under `/api`, take and return JSON, and (except where marked) need a signed-in
**shipper** user: `Authorization: Bearer <token>` from `POST /api/auth/login`. Every record is
scoped to the user's company; another company's record answers 404.

**Errors** always look like `{ "error": { "code", "message", "fields"? } }`:

| Status | Meaning |
|---|---|
| 400 | Validation failed: `fields` holds one message per field |
| 401 | Not signed in or session ended |
| 403 | Your role or approval limit doesn't allow it |
| 404 | Not found (or not your company's) |
| 409 | Duplicate, or the record is in the wrong state for this action |
| 429 | Too many failed sign-ins for this email |

Money is in rupees (numbers). Dates are ISO 8601 (UTC); the web app shows India time.

## Sign-in and profile

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → `{ token, user }`. **Public.** 5 failures in 15 min → 429 |
| GET | `/auth/me` | Current user incl. `approvalLimit` |
| POST | `/auth/logout` | Ends the session |
| GET / POST | `/invites/:token` | **Public.** Read invite; `{ password }` sets it and signs in |
| GET / PUT | `/profile/messages` | Email updates: `{ language, quietHours, prefs }` |

## Master data and policies

| Method | Path | Who may write |
|---|---|---|
| GET, POST / PATCH `/:id` | `/addresses` | any shipper user |
| GET, GET `/:id`, POST / PATCH `/:id` | `/carriers` | logistics head. The shipper's carrier master: contact person and mobile, email, city, address, GSTIN, PAN, notes, in use. POST adds a carrier not on DigitRell as *invited*, or lists one already on DigitRell as is (`alreadyOnDigitRell`). Name and owner's mobile can be changed only while the carrier is invited and listed by this shipper alone. A carrier on an active lane can't be set *not in use* |
| GET (`?carrierId=`), GET / PUT / DELETE `/:carrierId` | `/rate-cards` | logistics head. One card per carrier: `{ validFrom, validTo, notes, lines: [{ origin, destination, truckType, rate, detentionPerDay, transitDays }] }`. PUT creates (201) or replaces (200) the card and all its lines; line errors come back as `lines.<n>.<field>`. A reference only: nothing is priced or awarded from it |
| GET, POST / PATCH `/:id` | `/lanes` | logistics head. Lane details, award rule and approved carriers (from the carrier master, in use). No budget: it is entered on each booking (a `budget` sent here is ignored) |
| GET, POST / PATCH `/:id`, POST `/:id/invite` | `/users` | logistics head (email is required) |
| GET, PUT | `/policies` | logistics head |

## Booking, quotes and award

| Method | Path | Notes |
|---|---|---|
| GET | `/bookings/lane-info` | `pickupAddressId`, `dropAddressId`, `truckType` → `{ lane, carriers: [{ id, name, rate, transitDays }], lastBudget }` (agreed rates from current rate cards, lowest first), or `{ lane: null }` |
| POST | `/bookings/preview` | Validates; returns lane, `budget`, carriers to ask (with their agreed `rate`), close time. Creates nothing |
| POST | `/bookings` | Creates the trip and the quote requests. `budget` (₹ per trip) is optional, but required on a lane whose award rule is *lowest within budget, automatic* |
| GET | `/bookings/recent` | Last 3 different bookings (for *Repeat*) |
| GET | `/trips` | `tab` (all, action, transit, delivered, closed), `q`, `laneId`, `days`, `page` → `{ trips, total, counts }` |
| GET | `/trips/:id` | Everything about one trip: quotes with scores, recommendation, documents, claims, invoice and checks, exception, cancel/edit rules, activity |
| POST | `/trips/:id/award` | `{ quoteId }`; approval limit applies |
| POST | `/trips/:id/undo-award` | Within 10 minutes |
| POST | `/trips/:id/retender` | `{ reason }`: reject all quotes, ask the same carriers again |
| POST | `/trips/:id/extend` | `{ hours }` (1–24) |
| POST | `/trips/:id/carriers` | `{ carrierIds }`: lane carriers not asked yet |
| PATCH | `/trips/:id` | Edit booking; returns `{ requoted }` |
| POST | `/trips/:id/cancel` | `{ reason, note? }` |

## Execution, POD, claims and billing

| Method | Path | Notes |
|---|---|---|
| POST | `/trips/:id/pod/accept` | Accept a POD that needed review |
| POST | `/trips/:id/pod/hard-copy` | Original LR received |
| POST | `/trips/:id/claims` | `{ kind: DAMAGE \| SHORTAGE, qty, unitValue, description }` |
| POST | `/trips/:id/claims/:claimId/withdraw` | While raised or disputed |
| POST | `/trips/:id/exception/approve` · `/reject` | Fix billed to the shipper; reject needs `{ reason }` |
| POST | `/trips/:id/invoice/approve` · `/query` · `/pay` | Query needs `{ reason }`; pay needs `{ mode: UPI \| BANK, reference }` |

## Approvals, dashboard, reports and activity

| Method | Path | Notes |
|---|---|---|
| GET | `/approvals` | Pending awards, payments and exception fixes, with reasons |
| POST | `/approvals/:id/approve` · `/reject` | Reject needs `{ reason }` |
| GET | `/insights/dashboard` | Home: setup state, top 3 approvals, active trips, this month |
| GET | `/insights/reports?period=month\|last-month\|90d` | KPIs, by lane, carrier scorecard |
| GET | `/insights/reports/trips.csv?period=` | CSV export |
| GET | `/activity` · `/activity/export.csv` | `q`, `who` (all, people, agents), `type` (decisions, money, changes, settings), `days`, `page` |

## Integration endpoints (stand-ins for modules not built yet)

Header `X-Integration-Key: <INTEGRATION_KEY>`. Not used by the web app. In production they need the
key set; the two test tools are disabled.

| Method | Path | Plays the part of |
|---|---|---|
| POST | `/integration/quotes` | Carrier quote agent: `{ tripNumber, carrierId, amount \| null }` |
| POST | `/integration/trips/:number/truck` | Carrier + documents agent: truck, driver, LR, e-way bill |
| POST | `/integration/trips/:number/events` | Driver / tracking: `REACHED_PICKUP`, `LOADED` (+ `eta`), `LOCATION`, `REACHED_DROP` |
| POST | `/integration/trips/:number/delivered` | Receiver code: `{ goodQty, damagedQty, remarks? }` |
| POST | `/integration/trips/:number/pod` | Driver POD photo: `{ qrMatched, remarks?, photoUrl? }` |
| POST | `/integration/claims/:number/response` | Carrier: `{ accept, note? }` |
| POST | `/integration/trips/:number/invoice` | Carrier billing: `{ number, freight, detention?, claimDeduction?, dueDate? }` |
| POST | `/integration/trips/:number/exceptions` | Driver / exception agent: `{ kind, description, proposal? }` |
| POST | `/integration/exceptions/:id/proposal` · `/resolve` | New fix proposal; fix carried out |
| POST | `/integration/trips/:number/expire-quotes` · `/age-award` | **Test tools, non-production only** |
