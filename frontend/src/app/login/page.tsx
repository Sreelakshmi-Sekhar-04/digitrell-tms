'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only same-site paths are allowed as the return target. */
function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function LoginForm() {
  const { status, login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === 'signed-in') router.replace(next);
  }, [status, next, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    const errs: typeof errors = {};
    if (!email.trim()) errs.email = 'Enter your work email.';
    else if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter a valid email, like name@company.com.';
    if (!password) errs.password = 'Enter your password.';
    setErrors(errs);
    if (errs.email) return emailRef.current?.focus();
    if (errs.password) return pwRef.current?.focus();

    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace(next);
    } catch (err) {
      if (err instanceof ApiError && err.body.fields) setErrors(err.body.fields);
      setFormError(err instanceof ApiError ? err.body.message : 'Something went wrong. Please try again.');
      setPassword('');
      pwRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-describedby={formError ? 'form-error' : undefined}>
      {params.get('next') && !formError && (
        <p className="rounded-xl bg-tone-progress-bg px-4 py-3 text-sm text-[#0B3F60]">Please sign in to continue.</p>
      )}
      {formError && (
        <p id="form-error" role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]">
          {formError}
        </p>
      )}
      <TextField
        ref={emailRef}
        label="Work email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (errors.email) setErrors((x) => ({ ...x, email: undefined }));
        }}
        error={errors.email}
        placeholder="name@company.com"
      />
      <TextField
        ref={pwRef}
        label="Password"
        type={showPw ? 'text' : 'password'}
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          if (errors.password) setErrors((x) => ({ ...x, password: undefined }));
        }}
        error={errors.password}
        trailing={
          <button type="button" onClick={() => setShowPw((s) => !s)} className="min-h-[36px] rounded-lg px-3 text-[13px] font-semibold text-brand-dark hover:bg-brand-tint" aria-pressed={showPw}>
            {showPw ? 'Hide' : 'Show'}
          </button>
        }
      />
      <Button type="submit" loading={busy} className="mt-1 w-full">
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-center text-xs text-ink-muted">Forgot your password? Ask your logistics head to reset it.</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-btn bg-brand font-display text-lg font-bold text-white">D</span>
          <div>
            <div className="font-display text-lg font-bold leading-tight">DigitRell TMS</div>
            <div className="text-xs text-ink-muted">Shipper workspace</div>
          </div>
        </div>
        <section className="rounded-card border border-line bg-white p-6 sm:p-7">
          <h1 className="text-[22px] font-bold">Sign in</h1>
          <p className="mb-5 mt-1 text-sm text-ink-muted">Book trucks, approve awards and track trips.</p>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
