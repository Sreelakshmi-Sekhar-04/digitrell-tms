# Carrier module — implementation tracker

| Phase | Branch | Status | PR | Tests |
|---|---|---|---|---|
| 1 Foundation | `feature/carrier-phase-1-foundation` | Built, not yet pushed | — | 149 / 149 passed (26 carrier + 123 shipper regression) |
| 2 Fleet and rates | `feature/carrier-phase-2-fleet-rates` | Built on the phase 1 branch, not yet pushed | — | 183 / 183 passed (60 carrier + 123 shipper regression) |
| 3 Quotes (+ Home) | `feature/carrier-phase-3-quotes` | Built on the phase 1 branch, not yet pushed | — | 204 / 204 passed (81 carrier + 123 shipper regression) |
| 4 Accept and assign | `feature/carrier-phase-4-accept-assign` | Pending | — | — |
| 5 Execution | `feature/carrier-phase-5-execution` | Pending | — | — |
| 6 Billing | `feature/carrier-phase-6-billing` | Pending | — | — |
| 7 Reports (Home done in phase 3) | `feature/carrier-phase-7-home-reports` | Pending | — | — |
| 8 Integration and final validation | `feature/carrier-phase-8-integration` | Pending | — | — |

Design: `docs/design/ui-prototype` (open `Main.dc.html` through a local web server, switch to *Carrier*).
Open business questions: see `IMPLEMENTATION_PLAN.md` §7.

## Flow alignment, Phase A (carrier side), branch `feature/contract-rate-offers`

Built (not committed, not yet type-checked against the shipper services, which land in parallel): C1 spot quote request and C1A allocation or award on the carrier load page (`components/carrier/AllocationPanels.tsx`), loads list labels, Home "Needs your OK" cards, hard document block on truck assignment (owner override removed), demo loads for every state. Access: spot quotes Owner only (Traffic Manager views); accept or decline Owner or Traffic Manager; assign truck Traffic Manager only.
Open: Phase B onwards (carrier LR, reported, gate-out, bills, advances) not started. Swap truck (`onroad.service.ts`) still allows an owner override for expired papers; spec section 6 names only assignment.
