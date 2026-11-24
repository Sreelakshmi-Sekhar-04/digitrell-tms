import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

const inputBase =
  'w-full min-h-[44px] rounded-btn border bg-white px-3 text-sm text-ink placeholder:text-[#7B8794] focus:border-brand focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-brand disabled:bg-[#F1F4F3] disabled:text-ink-muted';

interface FieldShellProps {
  label: string;
  required?: boolean;
  optional?: boolean;
  help?: ReactNode;
  error?: string;
  id: string;
  children: ReactNode;
}

function FieldShell({ label, required, optional, help, error, id, children }: FieldShellProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-ink-soft">
        {label}
        {/* Required is announced by the input's `required`; the asterisk is visual only. */}
        {required && <span aria-hidden="true" className="text-attention"> *</span>}
        {optional && <span className="font-normal text-ink-muted"> (optional)</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1.5 text-xs font-semibold text-tone-danger">{error}</p>
      ) : help ? (
        <p id={`${id}-help`} className="mt-1.5 text-xs text-ink-muted">{help}</p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  help?: ReactNode;
  error?: string;
  optional?: boolean;
  trailing?: ReactNode;
}

/** Label on top, help or error below. Errors keep what the user typed. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, help, error, optional, required, id, className = '', trailing, ...rest },
  ref,
) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <FieldShell label={label} required={required} optional={optional} help={help} error={error} id={fid}>
      <div className="relative">
        <input
          ref={ref}
          id={fid}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fid}-err` : help ? `${fid}-help` : undefined}
          className={`${inputBase} ${error ? 'border-[#B91C1C] bg-[#FFFBFB]' : 'border-line-strong'} ${trailing ? 'pr-20' : ''} ${className}`}
          {...rest}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
    </FieldShell>
  );
});

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  help?: ReactNode;
  error?: string;
  optional?: boolean;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, help, error, optional, required, id, className = '', children, ...rest },
  ref,
) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <FieldShell label={label} required={required} optional={optional} help={help} error={error} id={fid}>
      <select
        ref={ref}
        id={fid}
        aria-invalid={error ? true : undefined}
        className={`${inputBase} ${error ? 'border-[#B91C1C]' : 'border-line-strong'} ${className}`}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});
