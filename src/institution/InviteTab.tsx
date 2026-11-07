import { Check, Copy, Download, FileUp, Link2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Segmented, Spinner } from '../components/ui.tsx';
import { inviteToInstitution, openInvites, revokeInvite } from '../lib/api.ts';
import { aRole, chunk, dayText, INVITE_BATCH, INVITE_STATUS, inviteLink, invitesCsv, invitesText, parseCsvEmails, parseEmails } from '../lib/institutions.ts';
import type { InstitutionRole, InviteResult, OpenInvite } from '../lib/types.ts';
import { toast } from '../store/toast.ts';
import { copyText, downloadCsv } from './copy.ts';
import type { InstitutionView } from './InstitutionPage.tsx';

/** Invite links for a list of emails: pasted, or from a CSV. Admins invite students, teachers or
 * admins, into a class or not; teachers invite students into one of their classes. Each link is
 * for one email, works once, and lasts 30 days. Links still waiting to be used are listed under,
 * to copy again or cancel (a teacher sees their own classes'). */
export function InviteTab({ view, initialClass }: { view: InstitutionView; initialClass: string | null }) {
  const { ov, classes } = view;
  const admin = ov.role === 'admin';
  const inst = ov.institution;
  const live = (classes ?? []).filter((c) => !c.archived);
  const [role, setRole] = useState<InstitutionRole>('student');
  const [classId, setClassId] = useState(() => initialClass ?? '');
  const [text, setText] = useState('');
  const [fromFile, setFromFile] = useState<{ name: string; emails: string[]; invalid: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<{ rows: InviteResult[]; role: InstitutionRole; className: string | null } | null>(null);
  const [cancelled, setCancelled] = useState<Set<string>>(new Set());
  const [waiting, setWaiting] = useState<OpenInvite[] | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const loadWaiting = useCallback(async () => {
    try {
      setWaiting(await openInvites(inst.id));
    } catch {
      setWaiting((w) => w ?? []);
    }
  }, [inst.id]);
  useEffect(() => {
    void loadWaiting();
  }, [loadWaiting]);

  const cancel = async (token: string, email: string) => {
    try {
      await revokeInvite(token);
      setCancelled((c) => new Set(c).add(token));
      toast(`The link for ${email} won’t work now.`, 'info');
      void Promise.all([view.reload(), loadWaiting()]);
    } catch (e) {
      toast((e as Error).message, 'warn');
    }
  };

  const typed = useMemo(() => parseEmails(text), [text]);
  const emails = useMemo(() => [...new Set([...typed.emails, ...(fromFile?.emails ?? [])])], [typed, fromFile]);
  const invalid = [...typed.invalid, ...(fromFile?.invalid ?? [])];
  const className = live.find((c) => c.id === classId)?.name ?? null;

  const closed = inst.status === 'rejected' || inst.status === 'suspended';
  const studentsWait = role === 'student' && !inst.active;
  const needsClass = !admin && !classId;
  const noClasses = !admin && classes !== null && live.length === 0;

  const readFile = async (f: File) => {
    try {
      const parsed = parseCsvEmails(await f.text());
      setFromFile({ name: f.name, ...parsed });
      setError(parsed.emails.length ? '' : `No emails found in ${f.name}.`);
    } catch {
      setError('Couldn’t read that file. Save it as a CSV and try again.');
    }
  };

  const send = async () => {
    if (!emails.length || closed || studentsWait || needsClass) return;
    setBusy(true);
    setError('');
    try {
      const rows: InviteResult[] = [];
      for (const part of chunk(emails, INVITE_BATCH)) rows.push(...(await inviteToInstitution(inst.id, part, admin ? role : 'student', classId || null)));
      setResults({ rows, role: admin ? role : 'student', className });
      setCancelled(new Set());
      setText('');
      setFromFile(null);
      if (file.current) file.current.value = '';
      void Promise.all([view.reload(), loadWaiting()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (noClasses) {
    return (
      <div className="rounded-[1.5rem] border border-dashed border-line-2 bg-white/50 px-6 py-12 text-center">
        <p className="font-semibold">Make a class first</p>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-3">Teachers invite students into one of their own classes.</p>
        <button className="btn btn-primary btn-sm mt-4" onClick={() => view.go('classes')}>
          Make a class
        </button>
      </div>
    );
  }

  const ready = results?.rows.filter((r) => r.token && !cancelled.has(r.token)) ?? [];

  const stillOpen = (waiting ?? []).filter((w) => !cancelled.has(w.token));

  return (
    <div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card p-5 sm:p-6" aria-label="Invite people">
          <h2 className="font-semibold">Invite people</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-3">You’ll get a link for each person to send them yourself.</p>

          {admin && (
            <div className="mt-5">
              <span className="label">Invite them as</span>
              <Segmented
                label="Invite them as"
                value={role}
                onChange={setRole}
                options={[
                  { value: 'student', label: 'Students' },
                  { value: 'teacher', label: 'Teachers' },
                  { value: 'admin', label: 'Admins' },
                ]}
              />
            </div>
          )}

          <div className="mt-5">
            <label className="label" htmlFor="invite-class">
              Class {admin && <span className="font-normal text-ink-4">(optional)</span>}
            </label>
            <select id="invite-class" className="field" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">{admin ? 'No class' : 'Pick a class'}</option>
              {live.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {admin && role !== 'student' && classId && <p className="mt-1.5 text-xs text-ink-3">They’ll teach this class once they join.</p>}
          </div>

          <div className="mt-5">
            <label className="label" htmlFor="invite-emails">
              Emails
            </label>
            <textarea
              id="invite-emails"
              className="field min-h-36 resize-y font-mono text-sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'ada@school.edu\ngrace@school.edu, alan@school.edu'}
              spellCheck={false}
              autoCapitalize="none"
            />
            <p className="mt-1.5 text-xs text-ink-3">One per line, or separated by commas.</p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              aria-label="Upload a CSV of emails"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
              }}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => file.current?.click()}>
              <FileUp size={15} /> Upload a CSV
            </button>
            {fromFile && (
              <span className="chip-tag max-w-full bg-paper-2 text-ink-2">
                <span className="truncate">
                  {fromFile.name}: {fromFile.emails.length} email{fromFile.emails.length === 1 ? '' : 's'}
                </span>
                <button
                  className="-mr-1 grid h-5 w-5 flex-none place-items-center rounded-full hover:bg-white"
                  aria-label={`Remove ${fromFile.name}`}
                  onClick={() => {
                    setFromFile(null);
                    if (file.current) file.current.value = '';
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            )}
          </div>

          {invalid.length > 0 && (
            <p className="mt-3 text-sm leading-relaxed text-[#9a4a1b]">
              {invalid.length === 1 ? 'This doesn’t look like an email' : 'These don’t look like emails'}: <span className="break-all font-mono text-xs">{invalid.slice(0, 6).join(', ')}{invalid.length > 6 ? ` and ${invalid.length - 6} more` : ''}</span>
            </p>
          )}

          <div className="mt-5 rounded-2xl bg-paper px-4 py-3 text-sm leading-relaxed text-ink-2">
            <p className="flex items-start gap-2">
              <Link2 size={16} className="mt-0.5 flex-none text-iris" />
              <span>Each link is for one person and works once, for 30 days. It only works when it’s opened by the email it’s for, so send each person their own link.</span>
            </p>
          </div>

          {closed ? (
            <p className="mt-4 text-sm text-[#9a4a1b]">{inst.name} isn’t open right now, so nobody can be invited.</p>
          ) : studentsWait ? (
            <p className="mt-4 text-sm text-[#9a4a1b]">
              {inst.status === 'pending' ? `Students can join once Kaivon has approved ${inst.name}. You can invite teachers and admins now.` : `${inst.name} isn’t open to students right now.`}
            </p>
          ) : null}
          {error && (
            <p className="mt-4 rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary mt-5 w-full sm:w-auto" disabled={busy || !emails.length || closed || studentsWait || needsClass} onClick={() => void send()}>
            {busy ? <Spinner /> : emails.length ? `Make ${emails.length} invite link${emails.length === 1 ? '' : 's'}` : 'Make invite links'}
          </button>
          {needsClass && <p className="mt-2 text-xs text-ink-3">Pick a class to invite students into.</p>}
        </section>

        <section className={`card p-5 sm:p-6 ${results ? 'self-start' : ''}`} aria-label="Invite links" aria-live="polite">
          {!results ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-iris-soft text-iris">
                <Link2 size={20} />
              </span>
              <p className="mt-3 font-semibold">Your links show up here</p>
              <p className="mt-1 max-w-xs text-sm leading-relaxed text-ink-3">Copy them one by one, all at once, or download them as a CSV for a mail merge.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">
                    {ready.length} link{ready.length === 1 ? '' : 's'} ready
                  </h2>
                  <p className="text-sm text-ink-3">
                    For {results.role === 'student' ? 'students' : results.role === 'teacher' ? 'teachers' : 'admins'}
                    {results.className ? `, in ${results.className}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-ghost btn-sm" disabled={!ready.length} onClick={() => void copyText(invitesText(ready), `Copied ${ready.length} link${ready.length === 1 ? '' : 's'}.`)}>
                    <Copy size={15} /> Copy all
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => downloadCsv(invitesCsv(results.rows.filter((r) => !r.token || !cancelled.has(r.token)), results.role, results.className), `${inst.name} invites.csv`)}
                  >
                    <Download size={15} /> Download CSV
                  </button>
                </div>
              </div>
              <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
                {results.rows.map((r) => {
                  const gone = !!r.token && cancelled.has(r.token);
                  return (
                    <li key={r.email} className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="min-w-0 break-all text-sm font-semibold">{r.email}</span>
                        <span className={`chip-tag ${gone ? 'bg-paper-2 text-ink-3' : r.status === 'invited' ? 'bg-mint-soft text-[#16795f]' : r.status === 'member' ? 'bg-sky-soft text-[#1f6d9e]' : 'bg-peach-soft text-[#9a4a1b]'}`}>
                          {gone ? 'Cancelled' : r.status === 'invited' ? <><Check size={12} /> {INVITE_STATUS.invited}</> : INVITE_STATUS[r.status]}
                        </span>
                      </div>
                      {r.token && !gone && (
                        <div className="mt-2 flex items-center gap-2">
                          <code className="min-w-0 flex-1 truncate rounded-lg bg-paper px-2.5 py-1.5 font-mono text-xs text-ink-2">{inviteLink(r.token)}</code>
                          <button className="btn btn-ghost btn-sm flex-none" onClick={() => void copyText(inviteLink(r.token!), `Copied the link for ${r.email}.`)} aria-label={`Copy the link for ${r.email}`}>
                            <Copy size={14} />
                          </button>
                          <button className="btn btn-quiet btn-sm flex-none" onClick={() => void cancel(r.token!, r.email)}>
                            Cancel
                          </button>
                        </div>
                      )}
                      {r.status === 'member' && <p className="mt-1 text-xs text-ink-3">Already part of {inst.name}.</p>}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="card mt-5 p-5 sm:p-6" aria-labelledby="waiting-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="waiting-title" className="font-semibold">
            Waiting to be used{waiting ? ` (${stillOpen.length})` : ''}
          </h2>
          <p className="text-sm text-ink-3">{admin ? 'Every open invite link' : 'Open invite links for your classes'}</p>
        </div>
        {waiting === null ? (
          <div className="skeleton mt-4 h-16" />
        ) : stillOpen.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">No links waiting. Once someone uses theirs, they’re in, and it leaves this list.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
            {stillOpen.map((w) => (
              <li key={w.token} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="break-all text-sm font-semibold">{w.email}</p>
                  <p className="text-xs text-ink-3">
                    {admin ? `As ${aRole(w.role)}` : 'Student'}
                    {w.class ? ` · ${w.class}` : ''} · works until {dayText(w.expires_at)}
                  </p>
                </div>
                <div className="flex flex-none gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => void copyText(inviteLink(w.token), `Copied the link for ${w.email}.`)} aria-label={`Copy the link for ${w.email}`}>
                    <Copy size={14} /> Copy link
                  </button>
                  <button className="btn btn-quiet btn-sm" onClick={() => void cancel(w.token, w.email)} aria-label={`Cancel the link for ${w.email}`}>
                    Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
