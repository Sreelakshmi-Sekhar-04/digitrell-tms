'use client';

import { useId } from 'react';

interface Option {
  value: string;
  label: string;
  help?: string;
  disabled?: boolean;
  title?: string;
}

/** Single choice shown as chips (design: truck type). Real radios underneath for keyboard and screen readers. */
export function ChoiceChips({ label, options, value, onChange, required, error }: { label: string; options: Option[]; value: string; onChange: (v: string) => void; required?: boolean; error?: string }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-semibold text-ink-soft">
        {label}
        {required && <span aria-hidden="true" className="text-attention"> *</span>}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <label key={o.value} title={o.title} className={`relative flex min-h-[44px] cursor-pointer items-center rounded-btn px-4 text-sm font-semibold ${on ? 'border-2 border-brand bg-brand-tint text-brand' : 'border border-line-strong bg-white text-ink-soft'} ${o.disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
              <input type="radio" name={name} value={o.value} checked={on} disabled={o.disabled} onChange={() => onChange(o.value)} className="sr-only" />
              {o.label}
            </label>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs font-semibold text-tone-danger">{error}</p>}
    </fieldset>
  );
}

/** Single choice shown as cards with a line of help (design: invite role). */
export function RadioCards({ label, options, value, onChange, required, error }: { label: string; options: Option[]; value: string; onChange: (v: string) => void; required?: boolean; error?: string }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-semibold text-ink-soft">
        {label}
        {required && <span aria-hidden="true" className="text-attention"> *</span>}
      </legend>
      <div className="flex flex-col gap-2">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <label key={o.value} className={`flex cursor-pointer items-start gap-3 rounded-xl px-3.5 py-3 text-sm ${on ? 'border-2 border-brand bg-[#F3F8F8]' : 'border border-line-strong'} ${o.disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
              <input type="radio" name={name} value={o.value} checked={on} disabled={o.disabled} onChange={() => onChange(o.value)} className="mt-0.5 h-[18px] w-[18px] accent-brand" />
              <span>
                <strong>{o.label}</strong>
                {o.help && <span className="block text-[13px] text-ink-muted">{o.help}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs font-semibold text-tone-danger">{error}</p>}
    </fieldset>
  );
}

/** Formats a rupee input as the user types (Indian grouping) and returns the plain number string. */
export function toRupeeInput(raw: string) {
  const digits = raw.replace(/[^\d]/g, '').slice(0, 10);
  return digits ? Number(digits).toLocaleString('en-IN') : '';
}
export const fromRupeeInput = (s: string) => (s ? Number(s.replace(/,/g, '')) : null);
