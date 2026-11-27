import { API_URL } from '../test-env';
import { expect, test } from '@playwright/test';
import { USERS, asUser, uniq } from './helpers';
import { tomorrow, ownLane } from './trips.helpers';
import { HEAD, csvFile, xlsxFile, mobile, readXlsx, type RowRes } from './bulk.helpers';

type Client = Awaited<ReturnType<typeof asUser>>;
const ok = async (res: { status(): number; text(): Promise<string>; json(): Promise<any> }, code = 200) => {
  expect(res.status(), await res.text()).toBe(code);
  return res.json();
};
const check = async (c: Client, kind: string, file: Buffer) => (await ok(await c.upload(`/${kind}/bulk/check`, file))) as { total: number; counts: Record<string, number>; rows: RowRes[] };
const imp = async (c: Client, kind: string, file: Buffer) => (await ok(await c.upload(`/${kind}/bulk/import`, file))) as { summary: { created: number; updated: number; skipped: number; failed: number }; rows: RowRes[] };
const cols = (r: RowRes) => r.errors.map((e) => e.column);
const carrierNames = async (c: Client) => ((await (await c.get('/carriers')).json()).carriers as { name: string }[]).map((x) => x.name);
const days = (n: number) => new Date(Date.now() + 5.5 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);

test.describe('Bulk upload: templates', () => {
  const screens: [string, string, string[]][] = [
    ['carriers', 'Carriers', HEAD.carriers],
    ['rate-cards', 'Rate cards', HEAD.rateCards],
    ['lanes', 'Lanes', HEAD.lanes],
    ['addresses', 'Addresses', HEAD.addresses],
    ['bookings', 'Bookings', HEAD.bookings],
  ];
  for (const [kind, title, heads] of screens) {
    test(`${kind}: xlsx template has data sheet headings and Instructions; csv has headings`, async ({ request }) => {
      const c = await asUser(request, USERS.shipperHead);
      const x = await c.get(`/${kind}/bulk/template?format=xlsx`);
      expect(x.status()).toBe(200);
      expect(x.headers()['content-disposition']).toContain('.xlsx');
      const { sheets } = await readXlsx(await x.body());
      expect(sheets[title][0]).toEqual(heads);
      expect(sheets.Instructions.length).toBeGreaterThan(heads.length);
      expect(sheets.Instructions.flat().join(' ')).toContain(heads[0]);
      const v = await c.get(`/${kind}/bulk/template?format=csv`);
      expect(v.headers()['content-type']).toContain('text/csv');
      expect((await v.text()).replace(/^﻿/, '').trim()).toBe(heads.join(','));
    });
  }

  test('lanes template has a truck-type drop-down and a Lists sheet of carriers', async ({ request }) => {
    const c = await asUser(request, USERS.shipperHead);
    const { wb, sheets } = await readXlsx(await (await c.get('/lanes/bulk/template?format=xlsx')).body());
    const dv = wb.getWorksheet('Lanes')!.getCell('C2').dataValidation;
    expect(dv?.type).toBe('list');
    expect(sheets.Lists.flat()).toContain('Kaveri Roadlines');
  });

  test('bookings template Lists sheet has saved addresses', async ({ request }) => {
    const c = await asUser(request, USERS.shipperExec);
    const { sheets } = await readXlsx(await (await c.get('/bookings/bulk/template?format=xlsx')).body());
    expect(sheets.Lists.flat()).toContain('Ambattur DC');
  });
});

test.describe('Bulk upload: carriers', () => {
  test('excel and csv upload, repeat is all duplicates, whole-file and row errors', async ({ request }) => {
    const c = await asUser(request, USERS.shipperHead);
    const t = uniq();
    const [a, b, d] = [`Bulk Xl ${t}`, `Bulk Csv ${t}`, `Bulk Dup ${t}`];
    const before = (await carrierNames(c)).length;

    // Excel
    const x = await xlsxFile(HEAD.carriers, [[a, mobile(), 'R Kumar', mobile(), 'ops@bulk.test', 'Chennai', '12 Estate', '33AABCK1234F1Z5', 'AABCK1234F', 'note']]);
    const chk = await check(c, 'carriers', x);
    expect(chk.counts).toEqual({ NEW: 1 });
    expect((await carrierNames(c)).length).toBe(before); // check saves nothing
    const r1 = await imp(c, 'carriers', x);
    expect(r1.summary).toEqual({ created: 1, updated: 0, skipped: 0, failed: 0 });
    expect(r1.rows[0].status).toBe('CREATED');
    expect(await carrierNames(c)).toContain(a);

    // CSV
    const v = csvFile(HEAD.carriers, [[b, mobile()]]);
    expect((await imp(c, 'carriers', v)).summary.created).toBe(1);
    expect(await carrierNames(c)).toContain(b);

    // Repeat of both: everything DUPLICATE, counts unchanged
    const after = (await carrierNames(c)).length;
    for (const f of [x, v]) {
      const again = await imp(c, 'carriers', f);
      expect(again.summary).toEqual({ created: 0, updated: 0, skipped: 1, failed: 0 });
      expect(again.rows[0].status).toBe('DUPLICATE');
    }
    expect((await carrierNames(c)).length).toBe(after);

    // Missing mandatory column: whole-file error
    const noCol = await c.upload('/carriers/bulk/check', await xlsxFile(['Carrier name', 'City'], [['X', 'Y']]));
    expect(noCol.status()).toBe(400);
    expect((await noCol.json()).error.message).toContain("Owner's mobile");

    // Empty file, headings only, old .xls
    expect((await c.upload('/carriers/bulk/check', Buffer.alloc(0))).status()).toBe(400);
    expect((await c.upload('/carriers/bulk/check', csvFile(HEAD.carriers, []))).status()).toBe(400);
    const xls = await c.upload('/carriers/bulk/check', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]));
    expect(xls.status()).toBe(400);
    expect((await xls.json()).error.message).toContain('.xls');

    // Row errors, in-file duplicate, mixed
    const mixed = csvFile(HEAD.carriers, [
      [d, mobile()], // 2 valid
      ['', mobile()], // 3 missing name
      [`Bad Mob ${t}`, '12345'], // 4 bad mobile
      [`Bad Gst ${t}`, mobile(), '', '', '', '', '', 'NOTAGSTIN', 'BADPAN'], // 5 gstin + pan
      [`Bad Mail ${t}`, mobile(), '', '', 'not-an-email'], // 6 email
      [d.toUpperCase(), mobile()], // 7 same name as row 2
      [a, mobile()], // 8 already in list
    ]);
    const m = await check(c, 'carriers', mixed);
    expect(m.counts).toEqual({ NEW: 1, INVALID: 5, DUPLICATE: 1 });
    const byRow = (n: number) => m.rows.find((r) => r.row === n)!;
    expect(cols(byRow(3))).toEqual(['Carrier name']);
    expect(cols(byRow(4))).toEqual(["Owner's mobile"]);
    expect(cols(byRow(5)).sort()).toEqual(['GSTIN', 'PAN']);
    expect(cols(byRow(6))).toEqual(['Email']);
    expect(byRow(7).errors[0].message).toContain('Same carrier as row 2');
    expect(byRow(8).status).toBe('DUPLICATE');

    // Import imports only valid; problems report has the invalid rows
    const done = await imp(c, 'carriers', mixed);
    expect(done.summary).toEqual({ created: 1, updated: 0, skipped: 1, failed: 5 });
    expect(await carrierNames(c)).toContain(d);
    const bad = done.rows.filter((r) => r.status === 'INVALID' || r.status === 'FAILED');
    const rep = await c.post('/carriers/bulk/report?format=xlsx', { rows: bad });
    const { sheets } = await readXlsx(await rep.body());
    const sheet = sheets.Carriers;
    expect(sheet[0].slice(-3)).toEqual(['Row in your file', 'Status', 'Problems']);
    expect(sheet.length).toBe(1 + bad.length);
    expect(sheet[1].at(-1)).toContain('Carrier name');
    const repCsv = await (await c.post('/carriers/bulk/report?format=csv', { rows: bad })).text();
    expect(repCsv).toContain('Problems');
    expect(repCsv).toContain("Owner's mobile: Enter a 10-digit");
  });

  test('owner mobile that belongs to another carrier is refused', async ({ request }) => {
    const c = await asUser(request, USERS.shipperHead);
    const list = (await (await c.get('/carriers')).json()).carriers as { name: string; phone: string }[];
    const k = list.find((x) => x.name === 'Kaveri Roadlines')!;
    const res = await check(c, 'carriers', csvFile(HEAD.carriers, [[`Other Name ${uniq()}`, String(k.phone).replace('+91', '')]]));
    expect(res.rows[0].status).toBe('INVALID');
    expect(cols(res.rows[0])).toEqual(["Owner's mobile"]);
  });
});

test.describe('Bulk upload: rate cards', () => {
  test('new, update, duplicate, bad references and values', async ({ request }) => {
    const c = await asUser(request, USERS.shipperHead);
    const t = uniq();
    const name = `Rate Carrier ${t}`;
    await imp(c, 'carriers', csvFile(HEAD.carriers, [[name, mobile()]]));
    const card = async () => ((await (await c.get('/rate-cards')).json()).rateCards as any[]).find((x) => x.carrier.name === name);
    expect(await card()).toBeUndefined();

    const file = await xlsxFile(HEAD.rateCards, [
      [name, 'Chennai', 'Bengaluru', '32ft MXL', 46000, 1500, 2, '2026-01-01', '2027-12-31'],
      [name, 'Pune', 'Hyderabad', '20ft SXL', 52000],
    ]);
    const chk = await check(c, 'rate-cards', file);
    expect(chk.counts).toEqual({ NEW: 2 });
    expect(chk.rows[0].note).toContain('Creates a rate card');
    const r = await imp(c, 'rate-cards', file);
    expect(r.summary.created).toBe(2);
    const saved = await card();
    expect(saved.lines).toHaveLength(2);
    expect(saved.validFrom).toBe('2026-01-01');
    expect(saved.lines.find((l: any) => l.origin === 'Chennai').rate).toBe(46000);

    // Repeat: duplicates only
    const again = await imp(c, 'rate-cards', file);
    expect(again.summary).toEqual({ created: 0, updated: 0, skipped: 2, failed: 0 });

    // UPDATE changes a rate (blank optional cells leave saved values)
    const upd = await xlsxFile(HEAD.rateCards, [[name, 'chennai', 'bengaluru', '32ft MXL', 47500]]);
    const uc = await check(c, 'rate-cards', upd);
    expect(uc.rows[0].status).toBe('UPDATE');
    expect(uc.rows[0].note).toContain('46,000');
    expect((await imp(c, 'rate-cards', upd)).summary).toEqual({ created: 0, updated: 1, skipped: 0, failed: 0 });
    const s2 = await card();
    const line = s2.lines.find((l: any) => l.origin === 'Chennai');
    expect(line.rate).toBe(47500);
    expect(line.detentionPerDay).toBe(1500);
    expect(s2.lines).toHaveLength(2);

    // Bad data
    const bad = await check(c, 'rate-cards', csvFile(HEAD.rateCards, [
      [`Nobody ${t}`, 'Chennai', 'Bengaluru', '32ft MXL', 1000], // 2 unknown carrier
      [name, 'Chennai', 'Bengaluru', '99ft', 1000], // 3 truck type
      [name, 'Chennai', 'Bengaluru', '32ft MXL', 'abc'], // 4 number
      [name, 'Chennai', 'Bengaluru', '', 1000], // 5 missing truck
      [name, 'Chennai', 'Chennai', '17ft', 1000], // 6 same city
      [name, 'Chennai', 'Madurai', '17ft', 1000, '', '', 'not-a-date'], // 7 date
      [name, 'Chennai', 'Salem', '17ft', 1000], // 8 ok
      [name, 'Chennai', 'Salem', '17ft', 2000], // 9 same key as 8
    ]));
    const row = (n: number) => bad.rows.find((x) => x.row === n)!;
    expect(cols(row(2))).toEqual(['Carrier']);
    expect(row(2).errors[0].message).toContain('not in your carrier list');
    expect(cols(row(3))).toEqual(['Truck type']);
    expect(cols(row(4))).toEqual(['Freight per trip (₹)']);
    expect(cols(row(5))).toEqual(['Truck type']);
    expect(row(6).status).toBe('INVALID');
    expect(cols(row(7))).toEqual(['Valid from']);
    expect(row(8).status).toBe('NEW');
    expect(row(9).errors[0].message).toContain('Same rate as row 8');
    const mixed = await imp(c, 'rate-cards', csvFile(HEAD.rateCards, [[name, 'Chennai', 'Salem', '17ft', 1000], [name, 'Chennai', 'Bengaluru', '99ft', 1000]]));
    expect(mixed.summary).toEqual({ created: 1, updated: 0, skipped: 0, failed: 1 });
  });
});

test.describe('Bulk upload: lanes', () => {
  test('new lane, add carrier on update, duplicate, bad references; seeded lanes unchanged', async ({ request }) => {
    const c = await asUser(request, USERS.shipperHead);
    const t = uniq();
    const [c1, c2] = [`Lane Bulk A ${t}`, `Lane Bulk B ${t}`];
    await imp(c, 'carriers', csvFile(HEAD.carriers, [[c1, mobile()], [c2, mobile()]]));
    const origin = `Origin${t}`, dest = `Dest${t}`;
    const lanes = async () => (await (await c.get('/lanes')).json()).lanes as any[];
    const mine = async () => (await lanes()).find((l) => l.origin.toLowerCase() === origin.toLowerCase());
    const seededBefore = (await lanes()).find((l) => l.origin === 'Chennai')!.carriers.length;

    const f1 = csvFile(HEAD.lanes, [[origin, dest, '17ft', 'Ask me', c1]]);
    expect((await check(c, 'lanes', f1)).counts).toEqual({ NEW: 1 });
    expect((await imp(c, 'lanes', f1)).summary.created).toBe(1);
    expect((await mine()).carriers.map((x: any) => x.name)).toEqual([c1]);
    expect((await mine()).awardRule).toBe('ASK');

    // repeat: duplicate
    expect((await imp(c, 'lanes', f1)).summary).toEqual({ created: 0, updated: 0, skipped: 1, failed: 0 });

    // UPDATE adds c2, keeps c1, rule unchanged even if the row says automatic
    const f2 = csvFile(HEAD.lanes, [[origin.toUpperCase(), dest, '17ft', 'Lowest within budget, automatic', `${c1}; ${c2}`]]);
    const u = await check(c, 'lanes', f2);
    expect(u.rows[0].status).toBe('UPDATE');
    expect(u.rows[0].note).toContain(c2);
    expect((await imp(c, 'lanes', f2)).summary.updated).toBe(1);
    const l = await mine();
    expect(l.carriers.map((x: any) => x.name).sort()).toEqual([c1, c2].sort());
    expect(l.awardRule).toBe('ASK');
    expect((await imp(c, 'lanes', f2)).summary.skipped).toBe(1);

    // new automatic lane with a carrier, and invalid rows
    const mixed = csvFile(HEAD.lanes, [
      [`${origin}2`, dest, '22ft', 'Lowest within budget, automatic', c1], // 2 ok
      [`${origin}3`, dest, '22ft', 'Lowest within budget, automatic', ''], // 3 auto needs carrier
      [`${origin}4`, dest, '22ft', '', `Ghost ${t}`], // 4 unknown carrier
      [`${origin}5`, dest, '99ft', '', c1], // 5 truck
      ['', dest, '22ft', '', c1], // 6 missing city
      [`${origin}7`, dest, '22ft', 'Whenever', c1], // 7 award rule
      [`${origin}2`, dest, '22ft', '', c2], // 8 same as row 2
      [`${origin}9`, `${origin}9`, '22ft', '', c1], // 9 same cities
    ]);
    const m = await check(c, 'lanes', mixed);
    const row = (n: number) => m.rows.find((x) => x.row === n)!;
    expect(row(2).status).toBe('NEW');
    expect(cols(row(3))).toEqual(['Approved carriers']);
    expect(cols(row(4))).toEqual(['Approved carriers']);
    expect(row(4).errors[0].message).toContain('not in your carrier list');
    expect(cols(row(5))).toEqual(['Truck type']);
    expect(cols(row(6))).toEqual(['Pickup city']);
    expect(cols(row(7))).toEqual(['Award rule']);
    expect(row(8).errors[0].message).toContain('Same lane as row 2');
    expect(row(9).status).toBe('INVALID');
    const done = await imp(c, 'lanes', mixed);
    expect(done.summary).toEqual({ created: 1, updated: 0, skipped: 0, failed: 7 });
    expect((await lanes()).find((x) => x.origin.toLowerCase() === `${origin}2`.toLowerCase()).awardRule).toBe('AUTO_LOWEST');

    expect((await lanes()).find((x) => x.origin === 'Chennai')!.carriers.length).toBe(seededBefore);
  });
});

test.describe('Bulk upload: addresses', () => {
  test('excel + csv, kinds, duplicates, bad values; executive may upload', async ({ request }) => {
    const c = await asUser(request, USERS.shipperExec);
    const t = uniq();
    const names = async () => ((await (await c.get('/addresses')).json()).addresses as any[]);
    const before = (await names()).length;
    const x = await xlsxFile(HEAD.addresses, [
      [`Bulk Pick ${t}`, 'Salem', 'Plot 1 Industrial Estate', 'Pickup', 'S Rao', mobile(), '9am-6pm'],
      [`Bulk Drop ${t}`, 'Erode', 'Plot 2', 'Drop'],
      [`Bulk Both ${t}`, 'Trichy', 'Plot 3', 'Pickup and drop'],
    ]);
    expect((await imp(c, 'addresses', x)).summary).toEqual({ created: 3, updated: 0, skipped: 0, failed: 0 });
    const list = await names();
    expect(list.length).toBe(before + 3);
    expect(list.find((a) => a.name === `Bulk Pick ${t}`).kind).toBe('PICKUP');
    expect(list.find((a) => a.name === `Bulk Drop ${t}`).kind).toBe('DROP');
    expect(list.find((a) => a.name === `Bulk Both ${t}`).kind).toBe('BOTH');
    expect((await imp(c, 'addresses', x)).summary).toEqual({ created: 0, updated: 0, skipped: 3, failed: 0 });
    expect((await names()).length).toBe(before + 3);

    const v = csvFile(HEAD.addresses, [
      [`Csv Ok ${t}`, 'Madurai', 'Plot 9', 'Pickup'], // 2
      ['', 'Madurai', 'Plot 9', 'Pickup'], // 3 name
      [`Csv NoCity ${t}`, '', 'Plot 9', 'Pickup'], // 4 city
      [`Csv NoLine ${t}`, 'Madurai', '', 'Pickup'], // 5 street
      [`Csv BadType ${t}`, 'Madurai', 'Plot 9', 'Sideways'], // 6 type
      [`Csv BadMob ${t}`, 'Madurai', 'Plot 9', 'Drop', '', '123'], // 7 mobile
      [`csv ok ${t}`, 'Madurai', 'Plot 9', 'Drop'], // 8 same as row 2
    ]);
    const m = await check(c, 'addresses', v);
    const row = (n: number) => m.rows.find((r) => r.row === n)!;
    expect(row(2).status).toBe('NEW');
    expect(cols(row(3))).toEqual(['Short name']);
    expect(cols(row(4))).toEqual(['City']);
    expect(cols(row(5))).toEqual(['Street address']);
    expect(cols(row(6))).toEqual(['Type']);
    expect(cols(row(7))).toEqual(['Contact mobile']);
    expect(row(8).errors[0].message).toContain('row 2');
    expect((await imp(c, 'addresses', v)).summary).toEqual({ created: 1, updated: 0, skipped: 0, failed: 6 });
  });
});

test.describe('Bulk upload: bookings', () => {
  test('valid excel and csv bookings create trips; duplicates, bad refs, dates, budget rule', async ({ request }) => {
    const head = await asUser(request, USERS.shipperHead);
    const own = await ownLane(head, 2);
    const addr = ((await (await head.get('/addresses')).json()).addresses as any[]);
    const pick = addr.find((a) => a.id === own.booking.pickupAddressId).name as string;
    const drop = addr.find((a) => a.id === own.booking.dropAddressId).name as string;
    const t = uniq();
    const trips = async (q: string) => ((await (await head.get(`/trips?q=${encodeURIComponent(q)}`)).json()).trips as any[]);

    const d1 = tomorrow();
    const x = await xlsxFile(HEAD.bookings, [[`PO-${t}-1`, pick, drop, d1, '17ft', 'Rice bags', 7, 20000, 'Ravi 9876543210', 'Call first', 3]]);
    const chk = await check(head, 'bookings', x);
    expect(chk.counts).toEqual({ NEW: 1 });
    expect(chk.rows[0].note).toContain('2 carriers');
    expect(await trips(`PO-${t}`)).toHaveLength(0);
    const r = await imp(head, 'bookings', x);
    expect(r.summary).toEqual({ created: 1, updated: 0, skipped: 0, failed: 0 });
    expect(r.rows[0].ref).toBeTruthy();
    expect(await trips(`PO-${t}-1`)).toHaveLength(1);

    // csv with DD-MM-YYYY and DD/MM/YYYY dates
    const [y, mo, da] = d1.split('-');
    const csv = csvFile(HEAD.bookings, [
      [`PO-${t}-2`, pick, drop, `${da}-${mo}-${y}`, '17ft', 'Rice bags', 7, 20000],
      [`PO-${t}-3`, pick, drop, `${da}/${mo}/${y}`, '17ft', 'Rice bags', 7, 20000],
    ]);
    expect((await imp(head, 'bookings', csv)).summary.created).toBe(2);
    // repeat: all duplicates, no extra trips
    expect((await imp(head, 'bookings', csv)).summary).toEqual({ created: 0, updated: 0, skipped: 2, failed: 0 });
    expect((await imp(head, 'bookings', x)).summary.skipped).toBe(1);
    expect(await trips(`PO-${t}`)).toHaveLength(3);

    // Without a reference: key is the full booking details
    const noRef = csvFile(HEAD.bookings, [['', pick, drop, d1, '17ft', `Salt ${t}`, 5, 20000]]);
    expect((await imp(head, 'bookings', noRef)).summary.created).toBe(1);
    expect((await imp(head, 'bookings', noRef)).summary.skipped).toBe(1);

    // Mixed invalid
    const mixed = csvFile(HEAD.bookings, [
      [`PO-${t}-4`, pick, drop, days(2), '17ft', 'Tea', 3, 20000], // 2 ok
      [`PO-${t}-5`, `Nowhere ${t}`, drop, d1, '17ft', 'Tea', 3, 20000], // 3 unknown pickup
      [`PO-${t}-6`, pick, `Nowhere ${t}`, d1, '17ft', 'Tea', 3, 20000], // 4 unknown drop
      [`PO-${t}-7`, 'Hosur Plant', 'Medchal DC', d1, '17ft', 'Tea', 3, 20000], // 5 no lane
      [`PO-${t}-8`, pick, drop, days(-1), '17ft', 'Tea', 3, 20000], // 6 past
      [`PO-${t}-9`, pick, drop, days(90), '17ft', 'Tea', 3, 20000], // 7 too far
      [`PO-${t}-10`, pick, drop, 'soon', '17ft', 'Tea', 3, 20000], // 8 bad date
      [`PO-${t}-11`, pick, drop, d1, '17ft', 'Tea', 'heavy', 20000], // 9 weight
      [`PO-${t}-12`, pick, drop, d1, '17ft', 'Tea', 100, 20000], // 10 weight range
      [`PO-${t}-13`, pick, drop, d1, '99ft', 'Tea', 3, 20000], // 11 truck
      [`PO-${t}-14`, pick, drop, d1, '17ft', '', 3, 20000], // 12 material
      [`PO-${t}-15`, 'Chakan Warehouse', 'Medchal DC', d1, '20ft SXL', 'Tea', 3, ''], // 13 auto lane, no budget
      [`PO-${t}-4`, pick, drop, d1, '17ft', 'Tea', 3, 20000], // 14 same ref as row 2
    ]);
    const m = await check(head, 'bookings', mixed);
    const row = (n: number) => m.rows.find((rr) => rr.row === n)!;
    expect(row(2).status).toBe('NEW');
    expect(cols(row(3))).toContain('Pickup address');
    expect(cols(row(4))).toContain('Drop address');
    expect(row(5).status).toBe('INVALID');
    expect(row(5).errors[0].message).toContain('No approved carriers');
    expect(cols(row(6))).toContain('Pickup date');
    expect(cols(row(7))).toContain('Pickup date');
    expect(cols(row(8))).toEqual(['Pickup date']);
    expect(cols(row(9))).toContain('Weight (tonnes)');
    expect(cols(row(10))).toContain('Weight (tonnes)');
    expect(cols(row(11))).toContain('Truck type');
    expect(cols(row(12))).toContain('Material');
    expect(cols(row(13))).toContain('Budget per trip (₹)');
    expect(row(14).errors[0].message).toContain('Same booking as row 2');
    const done = await imp(head, 'bookings', mixed);
    expect(done.summary).toEqual({ created: 1, updated: 0, skipped: 0, failed: 12 });
    expect(await trips(`PO-${t}-4`)).toHaveLength(1);

    // Tidy up: cancel what we booked so no approvals are left waiting for other specs.
    for (const q of [`PO-${t}`, `Salt ${t}`]) {
      for (const tr of await trips(q)) expect((await head.post(`/trips/${tr.id}/cancel`, { reason: 'ORDER_CANCELLED' })).status()).toBe(200);
    }
  });

  test('missing mandatory columns is a whole-file error', async ({ request }) => {
    const c = await asUser(request, USERS.shipperExec);
    const res = await c.upload('/bookings/bulk/check', csvFile(['Pickup address', 'Drop address'], [['a', 'b']]));
    expect(res.status()).toBe(400);
    const msg = (await res.json()).error.message as string;
    for (const h of ['Pickup date', 'Truck type', 'Material', 'Weight (tonnes)']) expect(msg).toContain(h);
  });
});

test.describe('Bulk upload: permissions', () => {
  test('executive is refused on carriers, rate cards and lanes, but may use addresses and bookings', async ({ request }) => {
    const exec = await asUser(request, USERS.shipperExec);
    const files: [string, string[]][] = [['carriers', HEAD.carriers], ['rate-cards', HEAD.rateCards], ['lanes', HEAD.lanes]];
    for (const [kind, heads] of files) {
      const f = csvFile(heads, [['x', 'y', 'z']]);
      expect((await exec.upload(`/${kind}/bulk/check`, f)).status(), kind).toBe(403);
      expect((await exec.upload(`/${kind}/bulk/import`, f)).status(), kind).toBe(403);
      expect((await exec.get(`/${kind}/bulk/template?format=csv`)).status(), `${kind} template`).toBe(200);
    }
    expect((await exec.upload('/addresses/bulk/check', csvFile(HEAD.addresses, [[`Exec ${uniq()}`, 'Salem', 'Plot', 'Drop']]))).status()).toBe(200);
    expect((await exec.upload('/bookings/bulk/check', csvFile(HEAD.bookings, [['', 'Ambattur DC', 'Hosur Plant', tomorrow(), '32ft MXL', 'Tea', 3, 20000]]))).status()).toBe(200);
  });

  test("another shipper's carrier list is separate, and anonymous calls are refused", async ({ request }) => {
    const other = await asUser(request, USERS.otherShipper);
    const res = await check(other, 'carriers', csvFile(HEAD.carriers, [['Kaveri Roadlines', mobile()]]));
    expect(res.rows[0].status).not.toBe('DUPLICATE'); // not in Coastal Paints' list
    const anon = await request.post(`${API_URL}/carriers/bulk/check`, { data: Buffer.from('x') });
    expect(anon.status()).toBe(401);
  });
});
