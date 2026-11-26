'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formErrors, useApi } from '@/lib/useApi';
import { LANGUAGE_LABELS, ROLE_OPTIONS, ROLES_WITH_LIMIT, prettyPhone, rupees } from '@/lib/masters';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState, Skeleton } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextField } from '@/components/ui/Field';
import { RadioCards, fromRupeeInput, toRupeeInput } from '@/components/ui/Choice';
import { useToast } from '@/components/ui/Toast';
import { DataTable, td } from './Table';
import type { TeamUser } from './types';

type Form = { name: string; phone: string; email: string; role: string; approvalLimit: string; language: string };
const EMPTY: Form = { name: '', phone: '', email: '', role: '', approvalLimit: '', language: 'en' };
const fromUser = (u: TeamUser): Form => ({
  name: u.name, phone: u.phone ? prettyPhone(u.phone) : '', email: u.email ?? '', role: u.role,
  approvalLimit: u.approvalLimit ? toRupeeInput(String(u.approvalLimit)) : '', language: u.language,
});
const roleLabel = (r: string) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;

function statusChip(u: TeamUser) {
  if (u.status === 'INACTIVE') return <Chip tone="neutral">Deactivated</Chip>;
  if (u.status === 'INVITED') return <Chip tone="action">Invited</Chip>;
  return <Chip tone="success">Active</Chip>;
}

export function UsersTab({ canManage, addSignal }: { canManage: boolean; addSignal: number }) {
  const { user: me } = useAuth();
  const list = useApi<{ users: TeamUser[] }>('/users');
  const toast = useToast();
  const [editing, setEditing] = useState<TeamUser | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [initial, setInitial] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<{ name: string; url: string } | null>(null);

  const myLimit = list.data?.users.find((u) => u.id === me?.id)?.approvalLimit ?? null;

  const open = (u: TeamUser | 'new') => {
    const f = u === 'new' ? EMPTY : fromUser(u);
    setForm(f);
    setInitial(f);
    setErrors({});
    setFormError('');
    setInvite(null);
    setEditing(u);
  };
  useEffect(() => {
    if (addSignal > 0 && canManage) open('new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSignal]);

  const set = (k: keyof Form, v: string) => {
    setForm((f) => ({ ...f, [k]: v, ...(k === 'role' && !ROLES_WITH_LIMIT.includes(v) ? { approvalLimit: '' } : {}) }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const showInvite = (name: string, path: string) => setInvite({ name, url: `${window.location.origin}${path}` });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    const body = { ...form, email: form.email || null, approvalLimit: ROLES_WITH_LIMIT.includes(form.role) ? fromRupeeInput(form.approvalLimit) : null };
    try {
      if (editing === 'new') {
        const res = await api<{ user: TeamUser; invitePath: string }>('/users', { method: 'POST', json: body });
        showInvite(res.user.name, res.invitePath);
        setInitial(form);
      } else {
        await api(`/users/${(editing as TeamUser).id}`, { method: 'PATCH', json: body });
        toast({ tone: 'success', title: 'Changes saved.' });
        setEditing(null);
      }
      list.reload();
    } catch (err) {
      const { fields, message } = formErrors(err);
      setErrors(fields);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (u: TeamUser) => {
    setBusy(true);
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', json: { isActive: !u.isActive } });
      toast({ tone: 'success', title: u.isActive ? `${u.name} deactivated.` : `${u.name} reactivated.`, text: u.isActive ? 'They are signed out and get no more messages.' : '' });
      setEditing(null);
      list.reload();
    } catch (err) {
      setFormError(formErrors(err).message);
    } finally {
      setBusy(false);
    }
  };

  const newLink = async (u: TeamUser) => {
    setBusy(true);
    try {
      const res = await api<{ invitePath: string }>(`/users/${u.id}/invite`, { method: 'POST' });
      showInvite(u.name, res.invitePath);
    } catch (err) {
      setFormError(formErrors(err).message);
    } finally {
      setBusy(false);
    }
  };

  if (list.loading && !list.data) return <div className="p-5"><Skeleton /></div>;
  if (list.error) return <EmptyState title="Couldn't load users" action={<Button variant="secondary" onClick={list.reload}>Try again</Button>}>{list.error}</EmptyState>;
  const rows = list.data?.users ?? [];
  const current = editing && editing !== 'new' ? editing : null;
  const needsLimit = ROLES_WITH_LIMIT.includes(form.role);
  const roleText = form.role ? roleLabel(form.role).toLowerCase() : 'a member';

  return (
    <>
      <DataTable label="Users and roles" headers={['Name', 'Role', 'Mobile and email', 'Approves up to', 'Language', 'Status', '']}>
        {rows.map((u) => (
          <tr key={u.id} className={u.isActive ? '' : 'text-ink-muted'}>
            <td className={`${td} font-semibold`}>{u.name}{u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-ink-muted">(you)</span>}</td>
            <td className={td}>{roleLabel(u.role)}</td>
            <td className={td}><div>{prettyPhone(u.phone)}</div><div className="text-xs text-ink-muted">{u.email ?? 'No web login'}</div></td>
            <td className={`${td} tabular`}>{u.approvalLimit ? rupees(u.approvalLimit) : 'Cannot approve'}</td>
            <td className={td}>{LANGUAGE_LABELS[u.language] ?? u.language}</td>
            <td className={td}>{statusChip(u)}</td>
            <td className={`${td} text-right`}>{canManage && <Button size="sm" variant="ghost" onClick={() => open(u)} aria-label={`Edit ${u.name}`}>Edit</Button>}</td>
          </tr>
        ))}
      </DataTable>

      <Drawer
        open={editing !== null}
        title={invite ? 'Invite ready' : editing === 'new' ? 'Invite a colleague' : `Edit ${current?.name ?? ''}`}
        subtitle={invite ? undefined : 'Only the logistics head can add people or change roles.'}
        dirty={!invite && JSON.stringify(form) !== JSON.stringify(initial)}
        onClose={() => setEditing(null)}
        onSubmit={save}
        footer={
          invite ? (
            <Button onClick={() => setEditing(null)}>Done</Button>
          ) : (
            <>
              <Button type="submit" loading={busy}>{editing === 'new' ? 'Create invite' : 'Save changes'}</Button>
              {current && current.id !== me?.id && (
                <Button variant={current.isActive ? 'danger' : 'secondary'} disabled={busy} onClick={() => toggleActive(current)}>
                  {current.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              )}
              {current?.status === 'INVITED' && <Button variant="secondary" disabled={busy} onClick={() => newLink(current)}>New invite link</Button>}
            </>
          )
        }
      >
        {invite ? (
          <div className="flex flex-col gap-4 text-sm leading-relaxed">
            <p className="rounded-xl bg-tone-success-bg px-4 py-3 text-[#14532D]"><strong>{invite.name} can now join.</strong> Send them this link by email. It works once and expires in 7 days.</p>
            <TextField label="Invite link" readOnly value={invite.url} onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="secondary"
              className="self-start"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(invite.url);
                  toast({ tone: 'success', title: 'Link copied.' });
                } catch {
                  toast({ tone: 'info', title: 'Select the link and copy it.' });
                }
              }}
            >
              Copy link
            </Button>
          </div>
        ) : (
          <>
            {formError && <p role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]">{formError}</p>}
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <TextField label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
              <TextField label="Mobile" required inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} help="For calls about their trips." placeholder="98765 43210" />
            </div>
            <TextField label="Email" required type="email" value={form.email} onChange={(e) => set('email', e.target.value)} error={errors.email} help="They sign in with this and get updates here." placeholder="name@company.com" />
            <RadioCards
              label="Role"
              required
              options={ROLE_OPTIONS.map((r) => ({ value: r.value, label: r.label, help: r.help, disabled: current?.id === me?.id && r.value !== 'LOGISTICS_HEAD' }))}
              value={form.role}
              onChange={(v) => set('role', v)}
              error={errors.role}
            />
            {needsLimit && (
              <div className="rounded-xl bg-brand-soft p-3.5">
                <TextField
                  label="Can approve up to (₹ per decision)"
                  required
                  inputMode="numeric"
                  value={form.approvalLimit}
                  onChange={(e) => set('approvalLimit', toRupeeInput(e.target.value))}
                  error={errors.approvalLimit}
                  help={myLimit ? `Above this, it goes to you (${rupees(myLimit)}).` : undefined}
                  placeholder="e.g. 75,000"
                />
              </div>
            )}
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <SelectField label="Message language" value={form.language} onChange={(e) => set('language', e.target.value)}>
                {Object.entries(LANGUAGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </SelectField>
            </div>
            {editing === 'new' && (
              <div className="rounded-xl border border-dashed border-line-strong px-3.5 py-3 text-[13px] leading-relaxed">
                <strong>Preview of the invite</strong>
                <br />
                <span className="text-ink-muted">
                  {me?.name} added you to {me?.companyName} on DigitRell as {roleText}
                  {needsLimit && form.approvalLimit ? ` (up to ₹${form.approvalLimit})` : ''}. Open the link to set your password.
                </span>
              </div>
            )}
          </>
        )}
      </Drawer>
    </>
  );
}
