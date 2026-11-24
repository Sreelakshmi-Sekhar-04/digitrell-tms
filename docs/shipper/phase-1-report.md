# Phase 1 report — Foundation

**Objective:** the base every shipper screen builds on: design system, app shell and navigation,
routing, sign-in and shipper-only access, API structure, and the Playwright harness.

## Features implemented

- **Design tokens** from the approved design system in `frontend/tailwind.config.js` (teal primary, amber attention, 6 status tones, ink and surface colours, 10/14 px radii, Inter + Space Grotesk).
- **UI components** (`frontend/src/components/ui`): Button (primary, secondary, danger, ghost; 44/36 px; loading state), TextField and SelectField (label on top, help or error below, visual-only asterisk), Chip and TripStatusChip (all 16 trip statuses mapped to the design's labels and tones), Card, PageHeader, EmptyState, Skeleton, Toast.
- **App shell**: header with company and user, 7-item sidebar in design order with current-page highlight, WhatsApp hint card; on phones, 4 bottom tabs with a More sheet (rest of menu + sign out).
- **Routing**: `/login`, `/`, `/trips`, `/bookings/new`, `/approvals`, `/masters`, `/reports`, `/policies`, branded 404. Screens for later phases say which phase brings them and contain no dead controls.
- **Authentication**: email + password, sessions as bearer tokens (12 h), passwords hashed with Node's scrypt (no new dependency), case-insensitive email, same message for unknown email and wrong password, deactivated users blocked, logout deletes the session, every login written to the audit log.
- **Access**: signed-out users are sent to login and returned to the page they wanted; only same-site return paths are honoured; carrier users see "This workspace is for shippers". API has `requireShipper` middleware ready for phase 2 routes.
- **API structure**: `createApp()` in `backend/src/app.ts`, JSON error format `{ error: { code, message, fields? } }`, async handler wrapper, JSON 404 for unknown routes, 400 for malformed JSON.

## Screens completed

Login (full), app shell (desktop and phone), 404. Other routes are placeholders by design.

## APIs and database changes

| Change | Detail |
|---|---|
| `POST /api/auth/login` | 200 token + user · 400 field errors · 401 wrong credentials or inactive |
| `GET /api/auth/me` | 200 user · 401 |
| `POST /api/auth/logout` | 204 |
| Migration `20261124104750_auth_sessions` | `User.passwordHash`, `User.isActive`, new `Session` table |
| Seed `backend/prisma/seed.ts` | Sunrise Foods (shipper) with 2 active users and 1 inactive; Kaveri Roadlines (carrier) with 1 user. Test passwords are documented in the file header |

Run `npx prisma migrate dev` then `npm run seed` in `backend/`.

## Playwright tests (e2e/)

Own test database (`digitrell_tms_test`, rebuilt each run) and own ports (API 4100, web 3100). Every UI test fails on any browser console error.

| Suite | Cases |
|---|---|
| `auth.api.spec.ts` (11) | health; valid login; email case/trim; missing fields 400; bad email 400; wrong password vs unknown email same 401; inactive user; malformed JSON; `/me` with no/bad/good token; logout ends session; unknown route JSON 404 |
| `foundation.ui.spec.ts` (16) | empty-field errors and focus; bad email; wrong password keeps email, clears password; show/hide password; login lands on Home with user and company; redirect to login and back to the wanted page; external `next` ignored; carrier blocked; sign out protects screens; session survives reload; 7 nav items in order; every item opens its screen with exactly one current item; placeholders have no dead controls; design tokens (colours, fonts); 44 px touch targets; branded 404 |
| `foundation.phone.spec.ts` (3) | login fits 390 px; bottom tabs, More menu, navigation and sign out; no sideways scroll |

**Result: 30 passed, 0 failed** (Chrome, 1440×900 and 390×844). Frontend `next build` and backend `tsc` pass.

## Bugs found and fixed during the phase

1. Required-field asterisk was part of the accessible name ("Password *"). Now `aria-hidden`; the input's `required` carries it.
2. Browser requested `/favicon.ico` and logged a 404. Added `app/icon.svg`.
3. Default Next.js 404 replaced with a branded page that links home.

## Remaining issues and dependencies

- Header search from the design is not shown yet; it arrives with trip search in phase 6 rather than as a control that does nothing.
- Web login method (password vs phone OTP) is an open question — see plan §7.1.
- No password reset flow yet; the login page says to ask the logistics head. Proposed for phase 2 with user management.
