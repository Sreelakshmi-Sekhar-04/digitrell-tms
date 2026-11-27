import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL } from '../test-env';
import { USERS, apiLogin, asUser } from './helpers';

const day = (n: number) => {
  const d = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const validDocs = { rcExpiry: day(900), insuranceExpiry: day(300), permitExpiry: day(300), fitnessExpiry: day(300), pucExpiry: day(100) };
const truckNo = () => `TN${String(10 + Math.floor(Math.random() * 89))}DC${String(1000 + Math.floor(Math.random() * 8999))}`;

// Tiny but real files: a 1x1 PNG and a minimal PDF.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

async function newTruck(request: APIRequestContext) {
  const divya = await asUser(request, USERS.carrierTraffic);
  const res = await divya.post('/carrier/trucks', { number: truckNo(), truckType: '20ft SXL', ownership: 'OWN', ...validDocs });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).truck as { id: string };
}
async function upload(request: APIRequestContext, user: { email: string; password: string }, truckId: string, docKey: string, file?: { name: string; mimeType: string; buffer: Buffer }) {
  const token = await apiLogin(request, user);
  return request.post(`${API_URL}/carrier/trucks/${truckId}/documents/${docKey}`, { headers: { Authorization: `Bearer ${token}` }, multipart: file ? { file } : { other: 'x' } });
}
const listed = async (request: APIRequestContext, id: string) => {
  const trucks = (await (await (await asUser(request, USERS.carrierTraffic)).get('/carrier/trucks')).json()).trucks as { id: string; docs: { key: string; file: { fileName: string; uploadedAt: string } | null }[] }[];
  return trucks.find((t) => t.id === id)!;
};

test.describe('Truck paper uploads API', () => {
  test('upload a PNG and a PDF: 201 with the document, listed as docs[].file, streamed back inline', async ({ request }) => {
    const t = await newTruck(request);
    expect((await listed(request, t.id)).docs.every((d) => d.file === null)).toBe(true);

    const png = await upload(request, USERS.carrierTraffic, t.id, 'rcExpiry', { name: 'rc.png', mimeType: 'image/png', buffer: PNG });
    expect(png.status(), await png.text()).toBe(201);
    expect((await png.json()).document).toMatchObject({ docKey: 'rcExpiry', fileName: 'rc.png', mimeType: 'image/png', size: PNG.length, url: `/carrier/trucks/${t.id}/documents/rcExpiry/file` });
    const pdf = await upload(request, USERS.carrier, t.id, 'pucExpiry', { name: 'puc.pdf', mimeType: 'application/pdf', buffer: PDF });
    expect(pdf.status(), await pdf.text()).toBe(201);

    const after = await listed(request, t.id);
    expect(after.docs.find((d) => d.key === 'rcExpiry')!.file).toMatchObject({ fileName: 'rc.png', uploadedAt: expect.any(String) });
    expect(after.docs.find((d) => d.key === 'pucExpiry')!.file).toMatchObject({ fileName: 'puc.pdf' });
    expect(after.docs.find((d) => d.key === 'permitExpiry')!.file).toBeNull();

    // Any user of the owning company can read it, including accounts.
    const token = await apiLogin(request, USERS.carrierAccounts);
    const got = await request.get(`${API_URL}/carrier/trucks/${t.id}/documents/rcExpiry/file`, { headers: { Authorization: `Bearer ${token}` } });
    expect(got.status()).toBe(200);
    expect(got.headers()['content-type']).toContain('image/png');
    expect(got.headers()['content-disposition']).toContain('inline');
    expect(Buffer.compare(await got.body(), PNG)).toBe(0);
  });

  test('errors: wrong type, too large, no file, bad document key', async ({ request }) => {
    const t = await newTruck(request);
    const txt = await upload(request, USERS.carrierTraffic, t.id, 'rcExpiry', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    expect(txt.status()).toBe(400);
    expect((await txt.json()).error.code).toBe('FILE_TYPE');
    const big = await upload(request, USERS.carrierTraffic, t.id, 'rcExpiry', { name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5 * 1024 * 1024 + 1024, 0x20) });
    expect(big.status()).toBe(400);
    expect((await big.json()).error.code).toBe('FILE_TOO_LARGE');
    const none = await upload(request, USERS.carrierTraffic, t.id, 'rcExpiry');
    expect(none.status()).toBe(400);
    expect((await none.json()).error.code).toBe('NO_FILE');
    expect((await upload(request, USERS.carrierTraffic, t.id, 'nopeExpiry', { name: 'a.png', mimeType: 'image/png', buffer: PNG })).status()).toBe(404);
    expect((await listed(request, t.id)).docs.every((d) => d.file === null)).toBe(true); // nothing stored
  });

  test('re-upload replaces; delete removes; the file is then 404', async ({ request }) => {
    const t = await newTruck(request);
    await upload(request, USERS.carrierTraffic, t.id, 'permitExpiry', { name: 'first.png', mimeType: 'image/png', buffer: PNG });
    const second = await upload(request, USERS.carrierTraffic, t.id, 'permitExpiry', { name: 'second.pdf', mimeType: 'application/pdf', buffer: PDF });
    expect(second.status()).toBe(201);
    expect((await listed(request, t.id)).docs.find((d) => d.key === 'permitExpiry')!.file).toMatchObject({ fileName: 'second.pdf' });
    const token = await apiLogin(request, USERS.carrierTraffic);
    const got = await request.get(`${API_URL}/carrier/trucks/${t.id}/documents/permitExpiry/file`, { headers: { Authorization: `Bearer ${token}` } });
    expect(got.headers()['content-type']).toContain('application/pdf');

    const divya = await asUser(request, USERS.carrierTraffic);
    const del = await divya.delete(`/carrier/trucks/${t.id}/documents/permitExpiry`);
    expect(del.status()).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    expect((await listed(request, t.id)).docs.find((d) => d.key === 'permitExpiry')!.file).toBeNull();
    expect((await request.get(`${API_URL}/carrier/trucks/${t.id}/documents/permitExpiry/file`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(404);
    expect((await divya.delete(`/carrier/trucks/${t.id}/documents/permitExpiry`)).status()).toBe(404); // nothing left to remove
  });

  test('roles and company isolation: accounts cannot upload or delete (403); another carrier cannot read (404) or change (403)', async ({ request }) => {
    const t = await newTruck(request);
    await upload(request, USERS.carrierTraffic, t.id, 'fitnessExpiry', { name: 'fit.png', mimeType: 'image/png', buffer: PNG });
    const png = { name: 'x.png', mimeType: 'image/png', buffer: PNG };
    expect((await upload(request, USERS.carrierAccounts, t.id, 'rcExpiry', png)).status()).toBe(403);
    expect((await (await asUser(request, USERS.carrierAccounts)).delete(`/carrier/trucks/${t.id}/documents/fitnessExpiry`)).status()).toBe(403);
    expect((await upload(request, USERS.shipperHead, t.id, 'rcExpiry', png)).status()).toBe(403);

    // NorthStar has no traffic manager, so its owner is refused by role (403) before the truck lookup; reading and a traffic manager of another company are the 404 cases.
    expect((await upload(request, USERS.otherCarrier, t.id, 'rcExpiry', png)).status()).toBe(403);
    const arjun = await asUser(request, USERS.otherCarrier);
    expect((await arjun.get(`/carrier/trucks/${t.id}/documents/fitnessExpiry/file`)).status()).toBe(404);
    expect((await arjun.delete(`/carrier/trucks/${t.id}/documents/fitnessExpiry`)).status()).toBe(403);
    expect((await listed(request, t.id)).docs.find((d) => d.key === 'fitnessExpiry')!.file).toMatchObject({ fileName: 'fit.png' }); // untouched
    const theirs = (await (await arjun.get('/carrier/trucks')).json()).trucks as { id: string }[];
    expect(theirs.some((x) => x.id === t.id)).toBe(false);
  });
});
