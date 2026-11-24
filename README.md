# DigitRell TMS

Agent-driven transport management system for domestic full-truck-load road freight.
Agents do the operational work; people approve decisions that cost money or carry risk.
Shippers and carriers work through a bot on WhatsApp, SMS and email; desk users use the web app.

**Release 1 scope:** shipper ↔ carrier, carrier's own/attached trucks (no vendors yet).

## Repository layout

| Path | What |
|---|---|
| `backend/` | Express + TypeScript + Prisma API, bot layer, coordinator and agents |
| `backend/src/modules/` | One folder per module (see `docs/MODULES.md`) |
| `backend/src/shared/` | Shared contracts: trip statuses, bot message format |
| `backend/prisma/` | Database schema and seeds |
| `frontend/` | Next.js + Tailwind web app for desk users |
| `docs/` | BRD, module plan, flow-spec template |

## Getting started

```bash
cd backend
npm install
cp .env.example .env      # set DATABASE_URL
npx prisma migrate dev
npm run dev               # http://localhost:4000/health

cd ../frontend
npm install
npm run dev               # http://localhost:3000
```

## Working rules

- One module per branch: `feature/<module>-<short-task>`. Merge to `main` through a PR only.
- Changes to `prisma/schema.prisma` or `src/shared/` need review by the lead.
- Money and numbering logic (LR series, invoices, balances) must have tests.
- AI is used only to read messages; amounts and award rules are plain code.
- Bot flows start with a flow spec (`docs/flow-spec-template.md`) reviewed before coding.
