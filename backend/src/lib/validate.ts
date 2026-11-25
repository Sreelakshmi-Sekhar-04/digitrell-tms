import { badRequest } from './errors';

/**
 * Tiny field validator: collects every field error, then throws one 400 with all of them,
 * so the form can show each message next to its field.
 */
export class Validator {
  fields: Record<string, string> = {};
  constructor(private body: Record<string, unknown>) {}

  private raw(key: string) {
    return this.body?.[key];
  }

  has(key: string) {
    return Object.prototype.hasOwnProperty.call(this.body ?? {}, key);
  }

  text(key: string, label: string, opts: { required?: boolean; max?: number } = {}): string | null {
    const v = this.raw(key);
    const s = v == null ? '' : String(v).trim().replace(/\s+/g, ' ');
    if (!s) {
      if (opts.required) this.fields[key] = `Enter ${label}.`;
      return null;
    }
    if (s.length > (opts.max ?? 120)) this.fields[key] = `Keep ${label} under ${opts.max ?? 120} characters.`;
    return s;
  }

  oneOf<T extends string>(key: string, label: string, options: readonly T[], opts: { required?: boolean } = { required: true }): T | null {
    const v = this.raw(key);
    if (v == null || v === '') {
      if (opts.required) this.fields[key] = `Choose ${label}.`;
      return null;
    }
    if (!options.includes(v as T)) {
      this.fields[key] = `Choose a valid ${label}.`;
      return null;
    }
    return v as T;
  }

  /** Indian mobile: accepts spaces, dashes, 0 or +91 prefix; returns +91XXXXXXXXXX. */
  phone(key: string, label: string, opts: { required?: boolean } = {}): string | null {
    const v = this.raw(key);
    const s = v == null ? '' : String(v).replace(/[\s()-]/g, '');
    if (!s) {
      if (opts.required) this.fields[key] = `Enter ${label}.`;
      return null;
    }
    const digits = s.replace(/^\+?91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(digits)) {
      this.fields[key] = 'Enter a 10-digit Indian mobile number, e.g. 98765 43210.';
      return null;
    }
    return `+91${digits}`;
  }

  email(key: string, label: string, opts: { required?: boolean } = {}): string | null {
    const s = this.text(key, label, { required: opts.required, max: 160 });
    if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      this.fields[key] = 'Enter a valid email, like name@company.com.';
      return null;
    }
    return s ? s.toLowerCase() : null;
  }

  /** Rupee amount: digits with optional commas; > 0 and at most ₹10 crore. */
  money(key: string, label: string, opts: { required?: boolean } = {}): number | null {
    const v = this.raw(key);
    if (v == null || v === '') {
      if (opts.required) this.fields[key] = `Enter ${label}.`;
      return null;
    }
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, ''));
    if (!Number.isFinite(n) || n <= 0) {
      this.fields[key] = `Enter ${label} as an amount in rupees, e.g. 46000.`;
      return null;
    }
    if (n > 100_000_000) {
      this.fields[key] = `${label[0].toUpperCase()}${label.slice(1)} looks too large. Check the amount.`;
      return null;
    }
    return Math.round(n * 100) / 100;
  }

  int(key: string, label: string, min: number, max: number): number | null {
    const v = this.raw(key);
    const n = typeof v === 'number' ? v : Number(v);
    if (v == null || v === '' || !Number.isInteger(n) || n < min || n > max) {
      this.fields[key] = `Enter ${label} between ${min} and ${max}.`;
      return null;
    }
    return n;
  }

  fail(key: string, message: string) {
    this.fields[key] = message;
  }

  /** Throws a 400 listing every field error, if any. */
  done() {
    if (Object.keys(this.fields).length) throw badRequest('Please fix the highlighted fields.', this.fields);
  }
}

export const toNumber = (d: { toString(): string } | null | undefined) => (d == null ? null : Number(d.toString()));
