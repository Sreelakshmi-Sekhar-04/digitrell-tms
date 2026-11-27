# Carrier phase 2 report — Fleet, rates, profile and policies

**Objective:** the carrier keeps its trucks, drivers, rate cards, users and company details in
DigitRell, and sets its pricing and approval rules (carrier spec C3, C5, C6). These are what the
quote, truck-assignment and billing agents read from phase 3 on.

## Features implemented

### Fleet and rates (`/carrier/fleet`, tabs)
- **Trucks**: number (normalised, shown as `TN 09 BX 4471`), type, own or attached (attached needs the
  owner's name), make, capacity, usual driver, and five document dates (RC, insurance, permit, fitness, PUC).
  Status comes from the documents and trips, never stored:
  **Blocked** (any document expired or missing, with the reason) · **Expiring** (within 15 days) ·
  **On trip** · **Ready** · Deactivated. Problems are listed first. The drawer shows each date's state as you type it.
  Vahan lookup is not connected (needs ULIP access), so the drawer says to type the dates from the papers.
- **Drivers**: mobile, licence number, class (LMV, HMV, HGMV, HTV) and expiry; a licence that is expired or
  missing blocks the driver. Language for WhatsApp.
  **UPI for advances, with maker-checker:** the first UPI ID is saved directly (unverified). Changing it waits
  for a *second person* (traffic manager or owner) to approve; the requester can't. An approved change starts
  unverified. *Mark verified* records the bank reference of a ₹1 test payment sent from the bank app (DigitRell
  doesn't send money until a payment provider is connected). A UPI ID can be changed but not removed.
- **Rate cards**: for one shipper (from those who approved this carrier on a lane) or any shipper; lane, truck
  type, rate, band (±%), trip cost, validity. Shows the band range in rupees and the margin. Status
  Active / Starts later / Expired / Deactivated. Two active rates for the same shipper, lane and truck may not
  overlap in dates.
- **Users and roles**: owner invites colleagues with one or more roles (checkboxes) and gets an invite link.
  Guards: you can't remove your own owner role or deactivate yourself; the company always keeps an active owner.
- **Company profile**: address, GSTIN, PAN (must match GSTIN characters 3–12), GST on freight (forward or
  reverse charge), TDS declaration (needs PAN, date stored), bank account and IFSC, LR prefix. The prefix
  locks once LRs have been issued (numbers are never reused). A banner lists anything still missing.

### Policies (`/carrier/policies`)
- Autonomy for the four carrier agents from the design (Quote, Truck assignment, Documents, Billing).
- Rate band, margin floor, invoice approval limit, backup approver. Owner edits; others see it read-only.

### Who can change what (spec §3.2)
| Tab | Edit | View |
|---|---|---|
| Trucks, drivers | Traffic manager | Everyone |
| UPI change approval | Traffic manager or owner (not the requester) | — |
| UPI verification | Traffic manager, owner, accounts | — |
| Rate cards, users, profile, policies | Owner | Everyone |

## APIs and database changes

| Endpoint | Purpose |
|---|---|
| `GET/POST /api/carrier/trucks`, `PATCH /trucks/:id` | Trucks with computed status |
| `GET/POST /api/carrier/drivers`, `PATCH /drivers/:id` | Drivers; UPI change becomes a pending request |
| `POST /api/carrier/drivers/:id/upi/approve` · `/reject` · `/verify` | Maker-checker and ₹1 verification |
| `GET/POST /api/carrier/rate-cards`, `PATCH /rate-cards/:id` | Rate cards with band, margin, status |
| `GET /api/carrier/shippers` | Shippers that approved this carrier on a lane |
| `GET/PUT /api/carrier/profile` | Company, tax, bank, LR series |
| `GET/PUT /api/carrier/policies` | Band, margin floor, limits, backup approver, autonomy |
| `GET/POST /api/carrier/users`, `PATCH /users/:id` | Users with several roles; invites |

Migration `20261126120000_carrier_fleet_rates`: truck (ownership, make, capacity, owner, PUC, usual driver,
active), driver (licence class, language, UPI + pending change, active), rate card (origin/destination,
trip cost, validity, active; lane now optional), company (GSTIN, PAN, address, GST option, TDS, bank).
Every change is audited with who and the old values. `Validator` gained `date()` and `decimal()`.

**Seed (from the design):** Kaveri has 5 trucks (TN 09 BX 4471 expiring, TN 10 AZ 2210 attached with
Murugan V, MH 12 QW 8841, KA 22 TT 5120, TN 11 CC 9087 blocked), drivers Ramesh K (UPI verified),
Murugan V (not verified) and Selvam P (licence expired), 4 rate cards (one expired), profile and LR
series KR from 482. NorthStar has one truck and driver for isolation tests. Dates are relative to the
seed day so the states stay right.

## Tests

| Suite | Count | Covers |
|---|---|---|
| `carrier.fleet.api.spec.ts` | 21 | seeded statuses; isolation between carriers; add/normalise/duplicate trucks; every validation; expired → blocked → renewed → expiring; role checks; deactivate/reactivate; drivers validation and duplicates; UPI first save, verify needs a reference, change pending, requester can't approve, approve resets verification, reject, can't remove; accounts' limits; rate band/margin maths; overlap refused, back-to-back allowed; rate validation; owner-only rates; profile seed and locked LR prefix; GSTIN/PAN/IFSC/account checks; policies defaults, validation, save; users with several roles and owner guards |
| `carrier.fleet.ui.spec.ts` | 13 | trucks list and order; add truck with errors, live document state, attached owner; edit clears a block, unsaved-changes guard; accounts read-only; drivers list; add driver → UPI change → owner approves in another session → verify with reference; rate cards with live band and margin; traffic manager read-only rates; invite with two roles; profile PAN check and undo; policies save, reload, validation, read-only |

**Full run:** 183 / 183 passed (60 carrier + 123 shipper regression).

Test ports can now be overridden (`E2E_API_PORT`, `E2E_WEB_PORT`) for when 4100/3100 are taken.

## Not done / notes

- Vahan / Sarathi lookup and real PAN / GSTIN / bank verification need ULIP access or a provider (plan §7 Q5).
- Expiry alerts at 15 and 1 days are shown as status now; the messages go out with the bot module.
- Licence class vs truck type is enforced when a truck is assigned (phase 4).
