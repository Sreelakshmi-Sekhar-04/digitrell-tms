# Carrier phase 1 report — Foundation

**Objective:** carrier users get their own desk: they can sign in, see the carrier menu from the
design, and every carrier screen has a route, while shipper and carrier data stay apart.

## Features implemented

- **Carrier sign-in.** The same login page serves both. Carriers land on `/carrier`, shippers on `/`.
  The old "This workspace is for shippers" block for carriers is gone.
- **Separate workspaces.** Shipper screens stay at `/…`, carrier screens live at `/carrier/…`.
  Opening the other side's screen takes you to your own Home. A `next` link to the other side is ignored
  after sign-in. External `next` targets are still ignored.
- **Carrier app shell** (shared `AppShell`, now driven by company type): header with company, user and
  role, a 6-item sidebar in design order (**Home · Loads · Approvals · Fleet and rates · Reports ·
  Policies**), and a carrier version of the WhatsApp hint. On phones: Home, Loads and Approvals as bottom
  tabs, the rest plus sign out under *More*. The approvals badge reads the carrier's own inbox.
- **Carrier roles** (spec §3.1): `OWNER`, `TRAFFIC_MANAGER`, `ACCOUNTS`. One user can hold several
  (`User.roles`). The session returns `roles`, main role first. The header shows the main role.
- **Carrier policy row** (`CarrierPolicy`) with defaults: rate band ±5%, margin floor 8%, invoice
  approval above ₹25,000, autonomy quote 1 / truck assignment 1 / documents 2 / billing 0. Screens come in phase 2.
- **Placeholders** for every carrier screen. Each says which phase brings it and has no dead buttons.

## APIs and database changes

| Endpoint | Purpose |
|---|---|
| `GET /api/carrier/me` | The signed-in carrier user and their company |
| `GET /api/carrier/approvals` | Pending decisions for this carrier (count + items); empty until phase 3 |

- All `/api/carrier/*` routes need a session **and** a carrier company (`requireCarrier`). Shippers get 403.
  Carriers still get 403 on shipper routes.
- `requireCarrierRole([...])` is ready for role checks from phase 2.
- Migration `20261126084017_carrier_foundation`: `User.roles TEXT[]` and the `CarrierPolicy` table.
- Seed: Kaveri gets Vijay (Owner + Traffic Manager), Divya (Traffic Manager), Suresh (Accounts) and a
  deactivated user. NorthStar gets Arjun (Owner) for isolation tests. All four carriers get a policy row.

| Test login | Password | Role |
|---|---|---|
| vijay@kaveri.test | Carrier@123 | Owner + Traffic Manager, Kaveri Roadlines |
| divya@kaveri.test | Carrier@123 | Traffic Manager, Kaveri Roadlines |
| suresh@kaveri.test | Carrier@123 | Accounts, Kaveri Roadlines |
| arjun@northstar.test | Carrier@123 | Owner, NorthStar Logistics |

## Tests

| Suite | Count | Covers |
|---|---|---|
| `carrier.foundation.api.spec.ts` | 10 | carrier sign-in with roles; single-role user; deactivated user refused; 401 without or with a bad token; shippers 403 on carrier routes; carriers 403 on shipper routes; `/me` scoped to own company; empty inbox per company; standard 404 |
| `carrier.foundation.ui.spec.ts` | 14 | lands on carrier Home with name, role, company; sign-in returns to the wanted carrier screen; cross-workspace `next` ignored both ways; shipper bounced from carrier screens; reload keeps the session; sign out protects screens; deactivated user error; 6 nav items in order; each opens its screen with one current item; logo goes to carrier Home; placeholders name their phase with no buttons; no badge when empty; design tokens and 44 px targets; branded 404 |
| `carrier.foundation.phone.spec.ts` | 2 | 3 bottom tabs + More (rest + sign out); no sideways scroll on any carrier screen |

**Changed shipper test:** `foundation.ui.spec.ts` "carrier users are told this workspace is for shippers"
became "carrier users opening a shipper screen are taken to the carrier desk".

**Full run:** 149 / 149 passed (26 carrier + 123 shipper regression).

## Not done / notes

- Fleet, rates, profile and policies screens: phase 2. Loads, quotes and approvals: phase 3.
- Inviting carrier users from the desk comes with *Users and roles* in phase 2.
- The design export now lives in `docs/design/ui-prototype` (open through a local web server).
