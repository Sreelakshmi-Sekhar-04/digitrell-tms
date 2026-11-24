import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'md' | 'sm';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-btn border font-semibold leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-60';
const variants: Record<Variant, string> = {
  primary: 'border-transparent bg-brand text-white hover:bg-brand-dark',
  secondary: 'border-line-strong bg-white text-ink hover:bg-[#F1F5F4]',
  danger: 'border-[#E9B8B8] bg-white text-tone-danger hover:bg-tone-danger-bg',
  ghost: 'border-transparent bg-transparent px-2.5 text-brand-dark hover:bg-brand-tint',
};
const sizes: Record<Size, string> = { md: 'min-h-[44px] px-[18px] text-sm', sm: 'min-h-[36px] px-3 text-[13px] rounded-lg' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

/** Design-system button: height 44 px (36 px inside tables), radius 10 px, one primary per area. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {children}
    </button>
  );
});
