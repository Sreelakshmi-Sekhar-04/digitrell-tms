import { prisma } from '../../lib/prisma';
import { Validator } from '../../lib/validate';
import { type BulkSpec, type Checked, fieldsOf } from '../../lib/bulk';
import { addToCarrierList, readDetails } from './carriers.routes';

interface CarrierData {
  name: string;
  phone: string;
  details: Record<string, string | null | boolean>;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Bulk upload for Master data > Carriers. Same validation and create logic as the single form. */
export const carriersBulk: BulkSpec<CarrierData> = {
  kind: 'carriers',
  title: 'Carriers',
  noun: 'carrier',
  roles: ['LOGISTICS_HEAD'],
  columns: [
    { key: 'name', header: 'Carrier name', required: true, example: 'NorthStar Logistics', help: 'The carrier company name. A carrier already on DigitRell is added to your list as is.' },
    { key: 'phone', header: "Owner's mobile", required: true, example: '98765 43210', help: "10-digit Indian mobile of the owner. It identifies the carrier on DigitRell." },
    { key: 'contactName', header: 'Contact person', example: 'R. Kumar', help: 'Who you deal with at the carrier.' },
    { key: 'contactPhone', header: 'Contact mobile', example: '98765 00000', help: "Contact person's 10-digit mobile." },
    { key: 'email', header: 'Email', example: 'ops@northstar.example', help: 'Contact email.' },
    { key: 'city', header: 'City', example: 'Chennai', help: "The carrier's city." },
    { key: 'address', header: 'Office address', example: '12 Industrial Estate, Ambattur', help: 'Office address.' },
    { key: 'gstin', header: 'GSTIN', example: '33AABCK1234F1Z5', help: '15-character GSTIN.' },
    { key: 'pan', header: 'PAN', example: 'AABCK1234F', help: '10-character PAN.' },
    { key: 'notes', header: 'Notes', example: 'Prefers morning loading', help: 'Anything worth remembering (up to 300 characters).' },
  ],

  async check(rows, ctx) {
    const shipperId = ctx.user.companyId;
    const parsed = await Promise.all(
      rows.map((r) =>
        fieldsOf(() => {
          const v = new Validator(r);
          const name = v.text('name', 'the carrier company name', { required: true, max: 80 });
          const phone = v.phone('phone', "the owner's mobile", { required: true });
          const details = readDetails(v, r, false);
          v.done();
          return { name: name!, phone: phone!, details };
        }),
      ),
    );

    // One lookup for every name and mobile in the file.
    const valid = parsed.flatMap((p) => (p.value ? [p.value] : []));
    const companies = valid.length
      ? await prisma.company.findMany({
          where: {
            type: 'CARRIER',
            OR: [...new Set(valid.map((x) => x.name))].map((n) => ({ name: { equals: n, mode: 'insensitive' as const } })),
          },
          include: { listedBy: { where: { shipperId } } },
        })
      : [];
    const phones = valid.length
      ? await prisma.company.findMany({
          where: { type: 'CARRIER', phone: { in: [...new Set(valid.map((x) => x.phone))] } },
          include: { listedBy: { where: { shipperId } } },
        })
      : [];
    const byName = new Map(companies.map((c) => [norm(c.name), c]));
    const byPhone = new Map(phones.map((c) => [c.phone ?? '', c]));

    return parsed.map((p): Checked<CarrierData> => {
      if (!p.value) return { status: 'INVALID', errors: p.errors };
      const { name, phone } = p.value;
      const nameHit = byName.get(norm(name));
      const phoneHit = byPhone.get(phone);
      const key = norm(name);
      if (nameHit?.listedBy.length) return { status: 'DUPLICATE', errors: {}, key, note: 'Already in your carrier list' };
      if (phoneHit && phoneHit.id !== nameHit?.id) {
        const message = phoneHit.listedBy.length
          ? `This number belongs to ${phoneHit.name}, already in your list.`
          : `This number belongs to ${phoneHit.name}. Use that name to add them.`;
        return { status: 'INVALID', errors: { phone: message } };
      }
      return {
        status: 'NEW', errors: {}, key, data: p.value,
        note: nameHit ? 'Already on DigitRell: added to your list as is' : undefined,
      };
    });
  },

  async apply(row, ctx) {
    const { name, phone, details } = row.data!;
    // Re-checks the name and mobile against current data, so a concurrent add fails just this row.
    const { carrierId } = await addToCarrierList(ctx.user, name, phone, details);
    return { ref: carrierId };
  },
};
