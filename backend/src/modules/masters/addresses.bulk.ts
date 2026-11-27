import type { Address } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { conflict } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { type BulkSpec, type Checked, fieldsOf } from '../../lib/bulk';
import { assertUniqueName, readAddress } from './addresses.routes';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const KIND_LABELS = { PICKUP: 'Pickup', DROP: 'Drop', BOTH: 'Pickup and drop' } as const;

/** "Pickup" / "Drop" / "Pickup and drop" (or the codes) to PICKUP / DROP / BOTH; anything else is left for the form's check. */
function kindCode(s: string) {
  const t = norm(s).replace(/&/g, 'and');
  if (['pickup', 'pick up', 'pick-up', 'pickup', 'pickup only'].includes(t)) return 'PICKUP';
  if (['drop', 'drop only', 'delivery'].includes(t)) return 'DROP';
  if (['pickup and drop', 'pickup/drop', 'pickup or drop', 'both'].includes(t)) return 'BOTH';
  return s.trim().toUpperCase();
}

type AddressData = Omit<Address, 'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'isActive'>;

/** Bulk upload for Master data > Addresses (any shipper user, as for the single form). */
export const addressesBulk: BulkSpec<AddressData> = {
  kind: 'addresses',
  title: 'Addresses',
  noun: 'address',
  columns: [
    { key: 'name', header: 'Short name', required: true, example: 'Ambattur DC', help: 'A short name you will recognise when booking. Must be different for each address.' },
    { key: 'city', header: 'City', required: true, example: 'Chennai', help: 'City of the address.' },
    { key: 'line1', header: 'Street address', required: true, example: 'Plot 14, Industrial Estate, Ambattur', help: 'Street address (up to 200 characters).' },
    { key: 'kind', header: 'Type', required: true, example: 'Pickup and drop', help: 'Whether trucks load here, unload here, or both.', options: Object.values(KIND_LABELS) },
    { key: 'contactName', header: 'Contact name', example: 'S. Rao', help: 'Who the driver should ask for.' },
    { key: 'contactPhone', header: 'Contact mobile', example: '98765 43210', help: '10-digit Indian mobile.' },
    { key: 'hours', header: 'Working hours', example: '9am-6pm', help: 'When the site receives or releases trucks.' },
  ],

  async check(rows, ctx) {
    const companyId = ctx.user.companyId;
    const saved = await prisma.address.findMany({ where: { companyId }, select: { name: true } });
    const exists = new Set(saved.map((a) => norm(a.name)));
    return Promise.all(rows.map(async (r): Promise<Checked<AddressData>> => {
      const name = r.name.trim();
      if (name && exists.has(norm(name))) return { status: 'DUPLICATE', errors: {}, key: norm(name), note: 'You already have an address with this name' };
      const res = await fieldsOf(() => readAddress({ ...r, kind: kindCode(r.kind) }, false) as unknown as AddressData);
      if (!res.value) return { status: 'INVALID', errors: res.errors };
      return { status: 'NEW', errors: {}, key: norm(res.value.name), data: res.value };
    }));
  },

  async apply(row, ctx) {
    const data = row.data!;
    await assertUniqueName(ctx.user.companyId, data.name);
    try {
      const a = await prisma.address.create({ data: { ...data, companyId: ctx.user.companyId } });
      await audit(ctx.user.id, 'ADDRESS_CREATED', { id: a.id, name: a.name, bulk: true });
      return { ref: a.id };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict(`You already have an address called "${data.name}".`, { name: 'This name is already used. Pick another or edit the existing one.' });
      }
      throw err;
    }
  },
};
