'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/useApi';
import { LANGUAGE_LABELS, prettyPhone } from '@/lib/masters';
import { CARRIER_ROLE_OPTIONS, carrierRoleLabel, type CarrierUser } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState, Skeleton } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { DataTable, td } from '@/components/masters/Table';
import { FormError, useDrawerForm } from './useDrawerForm';

type Form = { name: string; phone: string; email: string; roles: string[]; language: string };
const EMPTY: Form = { name: '', phone: '', email: '', roles: [], language: 'en' };
const fromUser = (u: CarrierUser): Form => ({ name: u.name, phone: u.phone ? prettyPhone(u.phone) : '', email: u.email ?? '', roles: u.roles, language: u.language });

const statusChip = (u: CarrierUser) =>
  u.status === 'ACTIVE' ? <Chip tone="success">Active</Chip> : u.status === 'INVITED' ? <Chip tone="neutral">Invited</Chip> : <Chip tone="neutral">Deactivated</Chip>;

export function CarrierUsersTab({ canManage, addSignal }: { canManage: boolean; addSignal: number }) {
  const { user: me } = useAuth();
  const toast = useToast();
  const list = useApi<{ users: CarrierUser[] }>('/carrier/users');
  const d = useDrawerForm<CarrierUser, Form>(EMPTY, fromUser);
  const [invite, setInvite] = useState<{ name: string; url: string } | null>(null);

  useEffect(() => {
    if (addSignal > 0) {
      setInvite(null);
      d.open('new');
    }
  }, [addSignal]);

  const toggleRole = (r: string) => d.set('roles', d.form.roles.includes(r) ? d.form.roles.filter((x) => x !== r) : [...CARRIER_ROLE_OPTIONS.map((o) => o.value).filter((v) => v === r || d.form.roles.includes(v))]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (d.isNew) {
      const res = await d.send<{ invitePath: string }>('/carrier/users', 'POST', d.form, `Invite ready for ${d.form.name}.`, true);
      if (res) {
        setInvite({ name: d.form.name, url: `${window.location.origin}${res.invitePath}` });
        list.reload();
      }
    } else if (await d.send(`/carrier/users/${d.current!.id}`, 'PATCH', d.form, 'User saved.')) list.reload();
  };

  if (list.loading && !list.data) return <div className="p-5"><Skeleton /></div>;
  if (list.error) return <EmptyState title="Couldn't load users" action={<Button variant="secondary" onClick={list.reload}>Try again</Button>}>{list.error}</EmptyState>;
  const rows = list.data?.users ?? [];
  const cur = d.current;
  const self = cur?.id === me?.id;

  return (
    <>
      <DataTable label="Users and roles" headers={['Name', 'Roles', 'Mobile and email', 'Language', 'Status', '']}>
        {rows.map((u) => (
          <tr key={u.id} className={u.isActive ? '' : 'text-ink-muted'}>
            <td className={`${td} font-semibold`}>{u.name}{u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-ink-muted">(you)</span>}</td>
            <td className={td}>{u.roles.map(carrierRoleLabel).join(', ')}</td>
            <td className={td}><div className="whitespace-nowrap">{prettyPhone(u.phone)}</div><div className="text-xs text-ink-muted">{u.email ?? 'No web login'}</div></td>
            <td className={td}>{LANGUAGE_LABELS[u.language] ?? u.language}</td>
            <td className={td}>{statusChip(u)}</td>
            <td className={`${td} text-right`}>{canManage && <Button size="sm" variant="ghost" onClick={() => { setInvite(null); d.open(u); }} aria-label={`Edit ${u.name}`}>Edit</Button>}</td>
          </tr>
        ))}
      </DataTable>

      <Drawer
        open={d.editing !== null}
        title={invite ? 'Invite ready' : d.isNew ? 'Invite a colleague' : `Edit ${cur?.name ?? ''}`}
        subtitle={invite ? undefined : 'One person can hold several roles. Only the owner adds people or changes roles.'}
        dirty={!invite && d.dirty}
        onClose={d.close}
        onSubmit={save}
        footer={
          invite ? (
            <Button onClick={d.close}>Done</Button>
          ) : (
            <>
              <Button type="submit" loading={d.busy}>{d.isNew ? 'Create invite' : 'Save changes'}</Button>
              {cur && !self && (
                <Button
                  variant={cur.isActive ? 'danger' : 'secondary'}
                  disabled={d.busy}
                  onClick={async () => {
                    if (await d.send(`/carrier/users/${cur.id}`, 'PATCH', { isActive: !cur.isActive }, cur.isActive ? `${cur.name} deactivated.` : `${cur.name} reactivated.`)) list.reload();
                  }}
                >
                  {cur.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              )}
            </>
          )
        }
      >
        {invite ? (
          <div className="flex flex-col gap-4 text-sm leading-relaxed">
            <p className="rounded-xl bg-tone-success-bg px-4 py-3 text-[#14532D]"><strong>{invite.name} can now join.</strong> Send them this link on WhatsApp or email. It works once and expires in 7 days.</p>
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
            <FormError message={d.formError} />
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <TextField label="Name" required value={d.form.name} onChange={(e) => d.set('name', e.target.value)} error={d.errors.name} />
              <TextField label="Mobile" required inputMode="tel" value={d.form.phone} onChange={(e) => d.set('phone', e.target.value)} error={d.errors.phone} help="Used to recognise them on WhatsApp." placeholder="98765 43210" />
            </div>
            <TextField label="Email" optional type="email" value={d.form.email} onChange={(e) => d.set('email', e.target.value)} error={d.errors.email} help="Needed to sign in to this web app." placeholder="name@company.com" />
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-semibold text-ink-soft">Roles<span aria-hidden="true" className="text-attention"> *</span></legend>
              <div className="flex flex-col gap-2">
                {CARRIER_ROLE_OPTIONS.map((o) => {
                  const on = d.form.roles.includes(o.value);
                  const locked = self && o.value === 'OWNER';
                  return (
                    <label key={o.value} className={`flex cursor-pointer items-start gap-3 rounded-xl px-3.5 py-3 text-sm ${on ? 'border-2 border-brand bg-[#F3F8F8]' : 'border border-line-strong'} ${locked ? 'cursor-not-allowed opacity-70' : ''}`}>
                      <input type="checkbox" checked={on} disabled={locked} onChange={() => toggleRole(o.value)} className="mt-0.5 h-[18px] w-[18px] accent-brand" />
                      <span>
                        <strong>{o.label}</strong>
                        <span className="block text-[13px] text-ink-muted">{o.help}{locked ? ' You cannot remove your own owner role.' : ''}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {d.errors.roles && <p role="alert" className="mt-1.5 text-xs font-semibold text-tone-danger">{d.errors.roles}</p>}
            </fieldset>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <SelectField label="Message language" value={d.form.language} onChange={(e) => d.set('language', e.target.value)}>
                {Object.entries(LANGUAGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </SelectField>
            </div>
          </>
        )}
      </Drawer>
    </>
  );
}
