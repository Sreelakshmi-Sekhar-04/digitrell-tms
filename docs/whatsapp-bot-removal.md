# WhatsApp bot removed, demo data added

The WhatsApp bot is not being built. This change removes it completely, without affecting the
shipper workflow, and adds a demo company so the app can be tested and shown with realistic data
(`docs/demo-data.md`).

## What the bot consisted of in this codebase

The bot itself was never built; Release 1 only prepared for it. What existed, and what happened to it:

| Piece | Where | Done |
|---|---|---|
| Bot gateway, conversation engine, intake agent module placeholders | `backend/src/modules/{bot-gateway,conversation,intake}` | Deleted |
| Bot message contract (`BotMessage`, channels, buttons, media) | `backend/src/shared/bot-message.ts` | Deleted (nothing imported it) |
| Message log table (bot messages in and out) | `MessageLog` | Table dropped (never written) |
| Each user's message channel (WhatsApp then SMS / WhatsApp and email / email) | `User.channel`, `CHANNELS` | Column dropped; removed from users API, My messages API, invite form and My messages page |
| Intake agent (reads bookings from WhatsApp, email and voice notes) | Policies → agent autonomy | Removed from policies (API and page); stored settings cleaned by the migration |
| WhatsApp Cloud API settings | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` in `.env.example` | Removed |
| Bot flow spec template | `docs/flow-spec-template.md` | Deleted |
| "WhatsApp" channel in the activity log | Activity log column and CSV export | Column removed (every entry was Web or System) |

There were no bot screens, routes, webhooks, scheduled jobs or npm packages to remove.

## Changes in other modules

| Module | Change |
|---|---|
| App shell | Removed the sidebar panel "Most work happens on WhatsApp". Navigation is unchanged |
| New booking | Removed the "Coming soon: book on WhatsApp" card |
| Home | First-time setup step and empty state no longer mention WhatsApp |
| Approvals | Notes say approvals are decided here, not "on WhatsApp too" |
| Trip page | Award-limit note, quote-waiting note and "driver taps on WhatsApp" text reworded |
| Carriers and lanes | Carrier mobile help no longer says "We'll invite them on WhatsApp" |
| Users | "Gets messages on" choice removed. Mobile help reworded. **Email is now required**: without WhatsApp it is the only way a person can sign in or get updates (API returns "Enter their email."). Invite text says to send the link by email |
| Invite page | A person with no email is told to ask for one (no WhatsApp alternative) |
| My messages | Now email updates: language, quiet hours and which updates; no "Send to" channel |
| Policies | Three agents: tender, bid evaluation, billing |
| Activity log | No Channel column (screen and CSV) |
| Integration endpoints | Unchanged. Comments say "driver / tracking" instead of "driver bot". They stand in for the carrier and driver modules, not the bot |
| Carrier sign-in notice | No longer says requests "still reach you on WhatsApp" |

Kept on purpose:
- **My messages** language and quiet hours, and **message language** on users: they apply to
  email updates.
- **Mobile numbers:** still how carriers and colleagues are called about trips.
- **"Booked on the web"** in the activity log.

## Database and configuration

- Migration `20261126090000_remove_whatsapp_bot`:
  - drops `MessageLog`
  - drops `User.channel`
  - removes the `intake` key from stored `ShipperPolicy.autonomy`
- Removed from `.env.example`: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`.
- No new dependencies. New npm scripts in `backend`: `demo:load`, `demo:reset`, `demo:remove`.

## Tests

New Playwright specs:
- `bot-removal.api` (5): no channel in My messages or users; email required; three agents; no
  Channel in the activity log; bot and WhatsApp addresses answer 404.
- `bot-removal.ui` (6):
  - no screen, drawer or the sign-in page mentions WhatsApp or the bot
  - no request goes to a bot endpoint
  - navigation is unchanged
  - My messages, the invite form, Policies and the activity log are checked
  - old bot addresses show the not-found page
- `demo.api` (5):
  - every stage is present; the dataset spans about 12 weeks with nothing in the future
  - a claim, its deduction and the paid invoice are linked correctly
  - demo users sign in with their roles
  - demo data stays inside its company
  - loading twice adds nothing; the loader refuses production
- `demo.ui` (7):
  - Home, Trips, Approvals and Reports show the demo data (counts compared with the API)
  - a closed trip shows its history
  - accounts approves and pays a waiting demo invoice, and the trip closes
  - the screens fit a phone

Updated: policies, My messages, activity CSV and duplicate-user tests (for the removed fields and
the required email).

**Result:** 171 passed, 0 failed, on two consecutive full runs (82 API, 78 desktop, 10 phone,
1 tablet). Before this change: 148.

## Not changed

- `docs/BRD.md`: it is the business's requirements document; the bot sections there need a decision
  from the business owner.
- The dated phase reports, which record what was built at the time.
