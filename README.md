# DigitRell TMS

Agent-driven transport management system for domestic full-truck-load road freight.
Agents do the operational work; people approve decisions that cost money or carry risk.
Shippers and carriers work through a bot on WhatsApp, SMS and email; desk users use the web app.

**Release 1 scope:** shipper ↔ carrier, carrier's own/attached trucks (no vendors yet).

**Status:** the **Shipper module** (web app + API) is complete: booking, quotes and award, trip
tracking, POD, claims, invoices and payment, exceptions, dashboard, reports and activity log. Carrier,
driver and messaging steps are reached through key-protected integration endpoints until those
modules exist. See `docs/shipper/FINAL_REPORT.md`.

## Repository layout

| Path | What |
|---|---|
| `backend/` | Express + TypeScript + Prisma API |
| `backend/src/modules/` | One folder per module (auth, masters, users, policies, trips, approvals, insights, activity, integration) |
| `backend/src/shared/` | Shared contracts: trip statuses, bot message format, master lists |
| `backend/prisma/` | Schema, migrations and seed |
| `frontend/` | Next.js 14 + Tailwind web app |
| `e2e/` | Playwright tests (API, desktop, phone, tablet) and screenshot capture |
| `docs/` | BRD, module plan; `docs/shipper/` has the shipper plan, phase reports, API reference, final report and screenshots |

## Getting started

```bash
cd backend
npm install
cp .env.example .env      # set DATABASE_URL
npx prisma migrate deploy # apply migrations (use deploy; `migrate dev` writes a no-op migration for the number sequences)
npm run seed              # test users: see the header of prisma/seed.ts
npm run dev               # http://localhost:4000/health

cd ../frontend
npm install
npm run dev               # http://localhost:3000  (NEXT_PUBLIC_API_URL defaults to http://localhost:4000/api)
```

Production settings (`backend/.env`): `DATABASE_URL`, `CORS_ORIGIN` (the web app's origin) and
`INTEGRATION_KEY` (for the integration endpoints). See `docs/shipper/FINAL_REPORT.md` → Deployment.

## End-to-end tests (Playwright)

```bash
cd e2e
npm install
npm test                  # API + desktop + phone + tablet
npm run test:api          # API only (no web app started)
npm run capture           # screenshots of key screens → docs/shipper/screenshots
```

Tests start their own API (port 4100) and web app (port 3100) against a separate database,
`<your database>_test`, which is rebuilt from the migrations and seeded on every run. Your dev
database is never touched. They use the Chrome installed on the machine.

## Working rules

- One module per branch: `feature/<module>-<short-task>`. Merge to `main` through a PR only.
- Changes to `prisma/schema.prisma` or `src/shared/` need review by the lead.
- Money and numbering logic (LR series, invoices, balances) must have tests.
- AI is used only to read messages; amounts and award rules are plain code.
- Bot flows start with a flow spec (`docs/flow-spec-template.md`) reviewed before coding.
