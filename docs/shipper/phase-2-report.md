# Phase 2 report — Master data and policies

**Objective:** everything a shipper must set up before booking: lanes with approved carriers and
budgets, saved addresses, users and roles (with invites), and the policies that limit what agents
may do alone.

## Features implemented

### Carriers and lanes (`/masters`, tab "Lanes and carriers")
- Table: lane, truck type, approved carriers, budget per trip, award rule, status (Active / Needs carriers / Inactive).
- Add/edit drawer: pickup and drop city (suggestions from saved addresses), truck type chips, budget (₹ formatted as you type), award rule ("Ask me" or "Lowest within budget, automatic"), approved-carrier checklist, deactivate.
- **Add a carrier not on the list** inside the lane drawer (name + owner's mobile). It's recorded as an *invited* carrier and ticked for the lane straight away.
- Rules: pickup ≠ drop; no duplicate lane (same cities and truck type, any case); city names tidied to title case; automatic award needs a budget and at least one carrier (BRD §7).

### Addresses (tab "Addresses")
- Table with contact and hours; add/edit drawer; deactivate/reactivate; "Show deactivated".
- Mobile numbers accept `98765 43210`, `098765-43210`, `+91…` and are stored as `+91XXXXXXXXXX`.
- Duplicate names refused (any case). Booking executives can manage addresses (they need them to book).

### Users and roles (tab "Users and roles")
- Roles: logistics head, approver, accounts payable, booking executive.
- Invite drawer as designed: name, mobile, optional email (needed for web sign-in), role cards, approval limit shown only for roles that approve, language, channel, live preview of the invite text.
- Rules: approver roles need a limit; booking executives can't have one; nobody can grant more than their own limit; duplicate email/mobile refused; you can't deactivate yourself or drop your own logistics-head role; deactivating someone ends their sessions.
- **Invite link**: one-time, 7 days. The drawer shows it with Copy. A new link replaces the old one.
- `/invite/[token]`: the invitee sets a password (8+ characters, letter and number, typed twice) and lands signed in. Used or expired links say so.

### Policies (`/policies`)
- Autonomy per agent (intake, tender, bid evaluation, billing): suggest only / ask first / act within limits. **Bid evaluation cannot be set to "act within limits"** in Release 1 (BRD §7); the button is disabled with an explanation, and the API refuses it.
- Payment approval threshold, quote window (1–48 h), POD rule (digital / hard copy / both).
- Save is enabled only when something changed; Discard restores saved values; invalid values show field errors.
- Booking executives see policies read-only.

### Cross-cutting
- New UI components: Drawer (Esc/Cancel, asks once before discarding changes, full-screen on phones), Tabs (arrow-key navigation, tab kept in the URL), ChoiceChips, RadioCards, rupee input formatting, data table.
- Every create/update/deactivate is written to the audit log with the user's id.
- All shipper APIs are scoped to the signed-in user's company; other companies' records return 404.

## APIs and database changes

| Endpoint | Who can write |
|---|---|
| `GET/POST /api/addresses`, `PATCH /api/addresses/:id` | any shipper user |
| `GET/POST /api/carriers` | logistics head (POST) |
| `GET/POST /api/lanes`, `PATCH /api/lanes/:id` | logistics head |
| `GET/POST /api/users`, `PATCH /api/users/:id`, `POST /api/users/:id/invite` | logistics head |
| `GET/POST /api/invites/:token` | public (one-time token) |
| `GET/PUT /api/policies` | logistics head (PUT) |

Errors: 400 with every field message at once, 403 for role, 404 for other companies' records, 409 for duplicates.

Migration `20261124130500_masters_policies`:
- `Company.status`, `Company.phone`
- `User.approvalLimit`, `User.inviteToken`, `User.inviteExpiresAt`
- `Lane.budget`, `Lane.awardRule`, `Lane.isActive`, timestamps, unique (shipper, origin, destination, truck type)
- New tables `Address`, `LaneCarrier`, `ShipperPolicy`

Seed adds 4 carriers, Sunrise Foods' 4 addresses, 2 lanes and its policy, and a second shipper (Coastal Paints) for isolation tests. After pulling: `cd backend && npx prisma migrate deploy && npm run seed`.

*Note:* `prisma migrate dev` refuses to add unique constraints in a non-interactive shell, so this migration's SQL was generated with `prisma migrate diff` and applied with `prisma migrate deploy`.

## Playwright tests

| Suite | Cases |
|---|---|
| `masters.api.spec.ts` (18) | auth required on all routes; carrier blocked; **cross-company isolation**; booking-executive permissions; address create/normalise/edit/deactivate; all field errors at once; duplicate address; lane create with carriers and tidy cities; duplicate lane; lane rule errors; auto-award rules; edit replaces carriers and keeps other fields; add carrier + duplicates by name/phone; full invite → accept → sign-in → link dead; role/limit rules; duplicate email/mobile; can't deactivate self; deactivation ends sessions; new link replaces old; policy defaults, save, Release 1 autonomy limit, invalid values |
| `masters.ui.spec.ts` (14) | seeded lane row; empty lane form errors; add lane with auto-award (rule errors, then budget formatting, new carrier with bad then good phone, saved row); duplicate lane; edit lane; unsaved-changes guard; address bad phone → fix → saved, duplicate keeps input; deactivate/reactivate with filter; invite with limit above own → fixed → link → invitee sets password (mismatch first) → signed in → link dead → row Active; own row protected; booking-executive read-only lanes/users and add address; read-only policies; policies save + persist after reload; invalid policy + Discard |
| `masters.phone.spec.ts` (2) | drawer full width with Save visible; no sideways scroll on masters and policies |
| Phase 1 suites (30) | re-run as regression |

**Result: 64 passed, 0 failed.** `next build` and backend `tsc` pass.

## Bugs found and fixed during the phase

1. Duplicate-record responses (409) were treated as console errors by the test guard. The app shows them correctly as field errors; the guard now allows 400/401/403/409, the same as for other deliberate negative cases.
2. Test helper looked for fields as plain textboxes; fields with city suggestions are comboboxes and optional fields include "(optional)" in their name. The helper now finds fields by their visible label.
3. Test data clash: API and UI tests both created "Rahul Menon" in the shared test database. The UI test now uses a unique name.
4. Added a 15-second action timeout so a wrong locator fails fast instead of after 90 seconds.

## Remaining issues and dependencies

- **Invites aren't sent automatically.** The link is shown to copy; WhatsApp sending arrives with the messaging module.
- **Invited carriers** are recorded on DigitRell, but the carrier onboarding itself belongs to the carrier module.
- Password reset is still not built (proposed: same one-time link flow, triggered by the logistics head).
- Open business questions in `IMPLEMENTATION_PLAN.md` §7 are unchanged; the approval-limit rule here ("can't grant more than your own limit") is an assumption to confirm.
- During this phase GitHub Desktop switched the local repo to `main` and stashed the work in progress. It was restored from the stash with nothing lost.
