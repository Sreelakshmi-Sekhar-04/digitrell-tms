# Modules — Release 1 (shipper ↔ carrier)

| # | Module | Folder | Owner | BRD |
|---|---|---|---|---|
| 1 | Masters & settings | `masters` | Junior | §3 |
| 4 | Coordinator & approvals | `coordinator`, `approvals` | Lead | §4, §4.12, §6 |
| 5 | Booking (web form) | `trips` | Lead | §4.1 |
| 6 | Tender, quote & award | `tender` | Lead + Junior (rate-card lookup) | §4.2–4.4 |
| 7 | Truck assignment & document check | `fleet` | Junior | §4.5–4.6 |
| 8 | Documents (LR, PDF, QR) | `documents` | Junior | §4.7 |
| 9 | Tracking & POD | `tracking` | Junior (flows) + Lead (QR/photo check) | §4.8–4.10 |
| 10 | Billing, payment & reports | `billing`, `reports` | Lead (money) + Junior (reports, screens) | §4.11 |

## Phases

| Phase | Lead | Junior |
|---|---|---|
| 1 Foundation | Data model, trip statuses | Masters & settings APIs + screens, seed data |
| 2 Coordination | Approvals, coordinator | Approvals screens |
| 3 Booking & tender | Tender timers, bid scoring | Rate-card lookup, quotes comparison screen |
| 4 Execution | POD QR/photo matching | Truck assignment, LR/PDF, status and POD flows |
| 5 Money | Invoice, UPI, Tally | Trip board, reports |

## Definition of done (every task)

- Linked to its BRD section in the PR description
- Tests for rules (numbering, calculations, status changes)
- No change to shared contracts without lead review
