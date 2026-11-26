# Demo data

A fictional shipper for demos, manual testing and screenshots. Everything in it is made up: company
and people names, `.test` email addresses, phone numbers starting `+91 90000`, truck numbers, LR,
e-way bill, invoice and payment references.

## Load, reset, remove

```bash
cd backend
npm run demo:load     # adds the demo company once; running it again does nothing
npm run demo:reset    # removes it and loads it again, with dates relative to today
npm run demo:remove   # removes it
```

- Runs against the database in `backend/.env` (`DATABASE_URL`).
- Refuses to run when `NODE_ENV=production`, and nothing loads it automatically. The one exception is
  the separate e2e test database, which gets it on every test run.
- Touches only its own company, its users and its five carriers. A company with the same name but
  other users is left alone. A carrier that some other shipper now uses is kept.
- Use reset to refresh the dates: "on the road" or "waiting for quotes" trips are only current on the
  day you load them.
- If a load stops half-way, run `npm run demo:reset`.

Code: `backend/prisma/demo/data.ts` (the dataset) and `backend/prisma/demo/index.ts` (the loader).

## Sign in

All passwords are `Demo@123`.

| Person | Email | Role |
|---|---|---|
| Lakshmi Menon | lakshmi.menon@vasudhafoods.test | Logistics head, approves up to ₹2,50,000 |
| Deepa Iyer | deepa.iyer@vasudhafoods.test | Approver, up to ₹60,000 |
| Suresh Babu | suresh.babu@vasudhafoods.test | Accounts payable, up to ₹1,50,000 |
| Arjun Reddy | arjun.reddy@vasudhafoods.test | Booking executive (books, can't approve) |
| Farhan Sheikh | farhan.sheikh@vasudhafoods.test | Invited, has not set a password yet |

## What is in it

**Vasudha Agro Foods Pvt Ltd** ships packaged foods from Chennai, Bengaluru and Mumbai.

- **Addresses:**
  - Sriperumbudur Plant
  - Whitefield DC
  - Bhiwandi Warehouse
  - Hinjewadi DC
  - Kompally DC
  - Coimbatore Depot
- **Lanes:**

  | Lane | Truck | Budget | Award rule | Carriers |
  |---|---|---|---|---|
  | Chennai → Bengaluru | 32ft MXL | ₹45,000 | ask me | 4 |
  | Mumbai → Pune | 20ft SXL | ₹16,000 | auto-award the lowest quote | 2 |
  | Chennai → Hyderabad | 32ft SXL | ₹52,000 | ask me | 3 |
  | Bengaluru → Coimbatore | 19ft | ₹21,000 | ask me | 2 |
- **Carriers, each with a track record:**
  - Thirumala Roadways
  - Godavari Freight Lines
  - Nilgiri Logistics
  - Shivam Transport Co
  - Konkan Cargo Movers
- **Policy:** payments above ₹75,000 need approval; quote window 2 hours; POD rule digital.

**31 trips over the last 12 weeks.**

| Stage | Trips | Scenarios |
|---|---|---|
| Closed (paid) | 16 | See the list below |
| Cancelled | 2 | One before award (order on hold); one after award (wrong drop point) |
| Invoiced | 3 | Two waiting for payment approval (one has a detention charge that fails a check); one queried for wrong freight |
| POD received | 1 | Waiting for the carrier's invoice |
| Delivered | 1 | Damaged cartons; POD needs review; claim raised, waiting for the carrier |
| On the road | 2 | One with a delay notice and a later ETA; one on time |
| On hold | 1 | Breakdown; the fix costs the shipper ₹4,500 and waits in Approvals |
| Ready for pickup | 1 | Truck and driver confirmed |
| Awarded | 1 | Waiting for the carrier's truck |
| Quotes received | 2 | One with every quote over budget (needs a decision); one still open |
| Quotes requested | 1 | Booked half an hour before the data was loaded |

The 16 closed trips include:
- late deliveries
- a damage claim the carrier accepted and deducted from the invoice
- a shortage claim the carrier disputed
- a breakdown repaired on the road
- a detention charge
- a re-tender after every quote came in over budget
- trips the Mumbai → Pune lane rule awarded by itself

People's actions (awards, approvals, payments) fall in office hours, India time.

**Approvals inbox:** 2 carrier awards, 2 payments and 1 exception fix waiting.

## How it is built

Trips are not written straight into tables. The loader starts the API in-process and drives each trip
through the same endpoints the app and the carrier stand-ins use:
- booking, quotes and award
- truck, tracking and delivery
- POD, claims and invoices
- approval and payment

Each step runs on a past date. A settable clock makes the app stamp it then, and the rows the step
wrote are moved back to that time. So statuses, scores, approvals, invoice checks and the activity log
are exactly what the app itself produces. A change to a business rule shows up in the demo data on the
next `demo:reset`.
