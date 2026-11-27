# Bulk upload (shipper module)

Every screen that creates records also takes a spreadsheet, so many records can be created at once. Manual creation stays as it is.

| Screen | Endpoint base | Who | One row is |
|---|---|---|---|
| Master data → Carriers | `/api/carriers/bulk` | logistics head | a carrier in your carrier list |
| Master data → Rate cards | `/api/rate-cards/bulk` | logistics head | one rate (carrier + city pair + truck type) |
| Master data → Lanes | `/api/lanes/bulk` | logistics head | a lane with its approved carriers |
| Master data → Addresses | `/api/addresses/bulk` | any shipper user | a saved pickup/drop address |
| New booking | `/api/bookings/bulk` | any shipper user | a booking (quote requests go out as for a single booking) |

**Users and roles** has no bulk upload on purpose: each invite produces a one-time sign-in link that has to be handed to that person, and each approval limit is a decision about one person.

## Flow

1. **Bulk upload** button next to the screen's *+ Add* button opens a wide drawer.
2. Download the template (Excel, with an *Instructions* sheet, drop-downs for fixed choices and a *Lists* sheet of your carriers/addresses; or CSV with the headings only).
3. Choose the filled file (.xlsx or .csv). It is checked straight away; nothing is saved.
4. Preview: every row with its status and problems (row number and column).
5. Fix and choose the file again, or **Import N rows** to save the valid ones now. Rows that need fixing are kept out and can be downloaded as a problems report (Excel or CSV) with a *Problems* column.
6. Summary: added, updated, skipped (already existed), not imported, with the report for the rows not imported.

## Row statuses

| Status | Meaning | Imported? |
|---|---|---|
| `NEW` | will be created | yes |
| `UPDATE` | changes an existing record (only where noted below) | yes |
| `DUPLICATE` | already exists exactly; nothing to do | no (skipped) |
| `INVALID` | has problems (`errors`: field, column, message) | no |
| after import: `CREATED`, `UPDATED`, `FAILED` | outcome of saving the row | |

A second row with the same key in one file is `INVALID` ("Same … as row N"). Uploading the same file again gives `DUPLICATE` for everything already saved, so repeated uploads never create copies.

## API (same for every screen)

- `GET …/bulk/template?format=xlsx|csv` → file
- `POST …/bulk/check` body: the file as raw bytes (`Content-Type: application/octet-stream`) → `{ kind, total, counts: { NEW, UPDATE, DUPLICATE, INVALID }, rows: RowResult[] }`
- `POST …/bulk/import` body: the same file → rows are checked again on current data, then valid rows saved one by one (a failing row doesn't block the others) → `{ kind, total, summary: { created, updated, skipped, failed }, rows: RowResult[] }`
- `POST …/bulk/report?format=xlsx|csv` JSON `{ rows: RowResult[] }` → file of those rows with *Row in your file*, *Status* and *Problems* columns

`RowResult = { row, values: { [columnKey]: string }, status, errors: [{ field, column, message }], note?, ref? }`. `row` is the spreadsheet row number (headings are row 1). `ref` is the created record's id (the trip id for bookings).

File rules: .xlsx or .csv (comma or semicolon), at most 500 rows and 5 MB; headings are matched ignoring case, spaces and "(₹)"-style suffixes; blank lines are ignored; Excel dates and numbers are read as values. An old .xls, a missing required column or an empty file is refused with a clear message.

Implementation: `backend/src/lib/bulk.ts` (reading files, templates, reports, the four routes). Each screen has a `*.bulk.ts` spec next to its routes, with its columns, `check` (calls the same validation as the single-record form) and `apply` (the same create logic as the form).

## Columns and rules per screen

### Carriers
Carrier name\*, Owner's mobile\*, Contact person, Contact mobile, Email, City, Office address, GSTIN, PAN, Notes.
- Key: carrier name. Already in your list (same name or owner's mobile) → `DUPLICATE`.
- On DigitRell but not in your list → `NEW`, note "Already on DigitRell: added to your list as is".
- Owner's mobile belongs to a carrier with another name → `INVALID`.
- Same validation as the form (Indian mobile, GSTIN, PAN, email).

### Rate cards
Carrier\*, Pickup city\*, Drop city\*, Truck type\*, Freight per trip (₹)\*, Detention per day (₹), Transit days, Valid from, Valid till.
- Key: carrier + pickup + drop + truck type. Carrier must be in your carrier list.
- The rate exists with the same values → `DUPLICATE`; with different values → `UPDATE`; otherwise `NEW` (the card is created if the carrier has none). Other rates on the card are never removed.
- Valid from / till, if given, set the carrier's card dates; all rows of one carrier must agree.

### Lanes
Pickup city\*, Drop city\*, Truck type\*, Award rule (*Ask me* or *Lowest within budget, automatic*; default *Ask me*), Approved carriers (names separated by `;`).
- Key: pickup + drop + truck type. Carriers must be in your carrier list and in use.
- Lane exists and the row lists carriers not yet approved on it → `UPDATE` (adds them; never removes; award rule unchanged). Otherwise an existing lane → `DUPLICATE`.
- New lane: same rules as the form (automatic award needs at least one carrier).

### Addresses
Short name\*, City\*, Street address\*, Type\* (*Pickup*, *Drop* or *Pickup and drop*), Contact name, Contact mobile, Working hours.
- Key: short name. A saved address with that name → `DUPLICATE`.

### Bookings
Your reference, Pickup address\*, Drop address\*, Pickup date\*, Truck type\*, Material\*, Weight (tonnes)\*, Budget per trip (₹), Receiver contact, Notes for carrier, Quote window (hours).
- Pickup/drop are names of saved addresses (see the *Lists* sheet). The lane comes from their cities and the truck type, as in the form; quote requests go to its approved carriers. There is no carrier column: carriers are chosen by quoting, not at booking.
- Dates: `YYYY-MM-DD`, `DD-MM-YYYY`, `DD/MM/YYYY` or an Excel date.
- Key: your reference if given, otherwise pickup + drop + date + truck type + material + weight. A trip that is not cancelled with the same key → `DUPLICATE`.
- Same rules as the form (date not in the past and within 60 days, weight 0.1–60 t, budget required on automatic-award lanes).
