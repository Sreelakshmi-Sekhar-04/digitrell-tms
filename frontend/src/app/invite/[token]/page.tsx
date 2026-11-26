'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth, type SessionUser } from '@/lib/auth';
import { ROLE_OPTIONS } from '@/lib/masters';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';

interface Invite {
  name: string;
  email: string | null;
  companyName: string;
  role: string;
}

export default function AcceptInvitePage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const { adoptSession } = useAuth();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loadError, setLoadError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ invite: Invite }>(`/invites/${params.token}`)
      .then((r) => setInvite(r.invite))
      .catch((err) => setLoadError(err instanceof ApiError ? err.body.message : "Can't open this invite right now."));
  }, [params.token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) errs.password = 'Use at least 8 characters with a letter and a number.';
    if (!errs.password && confirm !== password) errs.confirm = "The two passwords don't match.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFormError('');
    try {
      const res = await api<{ token: string; user: SessionUser }>(`/invites/${params.token}`, { method: 'POST', json: { password } });
      adoptSession(res.token, res.user);
      router.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.body.fields) setErrors(err.body.fields);
      setFormError(err instanceof ApiError ? err.body.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const role = ROLE_OPTIONS.find((r) => r.value === invite?.role)?.label.toLowerCase();

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-btn bg-brand font-display text-lg font-bold text-white">D</span>
          <div className="font-display text-lg font-bold">DigitRell TMS</div>
        </div>
        <section className="rounded-card border border-line bg-white p-6 sm:p-7">
          {loadError ? (
            <>
              <h1 className="text-[22px] font-bold">This link doesn&apos;t work any more</h1>
              <p className="mt-2 text-sm text-ink-muted">{loadError}</p>
            </>
          ) : !invite ? (
            <Skeleton />
          ) : !invite.email ? (
            <>
              <h1 className="text-[22px] font-bold">Hello {invite.name}</h1>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">To sign in, ask your logistics head to add your email, then open a new invite link.</p>
            </>
          ) : (
            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              <div>
                <h1 className="text-[22px] font-bold">Join {invite.companyName}</h1>
                <p className="mt-1 text-sm text-ink-muted">Hello {invite.name}. You&apos;re joining as {role}. Set a password to finish.</p>
              </div>
              {formError && <p role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]">{formError}</p>}
              <TextField label="Your sign-in email" value={invite.email} readOnly disabled />
              <TextField label="New password" type="password" autoComplete="new-password" required value={password} onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: undefined })); }} error={errors.password} help="At least 8 characters, with a letter and a number." />
              <TextField label="Type it again" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => { setConfirm(e.target.value); setErrors((x) => ({ ...x, confirm: undefined })); }} error={errors.confirm} />
              <Button type="submit" loading={busy} className="w-full">{busy ? 'Setting up…' : 'Set password and continue'}</Button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
