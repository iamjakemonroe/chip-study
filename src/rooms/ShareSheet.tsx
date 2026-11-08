import { ArrowRight, Check, ClipboardCopy, GraduationCap, Link2, RefreshCw, Search, Share2, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Segmented, Spinner } from '../components/ui.tsx';
import { institutionMembers, listClasses } from '../lib/api.ts';
import type { InstitutionMember, StudyClass } from '../lib/types.ts';
import { useAuth } from '../store/auth.ts';
import { useInstitutions } from '../store/institutions.ts';
import { toast } from '../store/toast.ts';
import { inviteToRoom, newRoomLink, roomLink, roomSettings, uninviteFromRoom, type RoomInfo } from './api.ts';

/** Asking people in: a personal room's link (copy it, share it, or make a new one so the old one
 * stops working), and for a class room, the classes and students it's for. */
export function ShareSheet({ open, onClose, info, onChange, onGo }: { open: boolean; onClose: () => void; info: RoomInfo; onChange: (r: RoomInfo) => void; onGo?: () => void }) {
  const link = roomLink(info.token);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const classRoom = !!info.institution_id;

  const act = async (key: string, fn: () => Promise<RoomInfo>, done?: string) => {
    setBusy(key);
    try {
      const next = await fn();
      // In the room, the parent tells the room server to read the roster again.
      onChange(next);
      if (done) toast(done, 'good');
    } catch (e) {
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      toast('Couldn’t copy. Select the link and copy it.', 'warn');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={classRoom ? 'Invite your class' : 'Invite people to study with you'} width={560}>
      <div className="space-y-6">
        <section>
          <label className="label" htmlFor="room-link">
            {classRoom ? 'The room’s link (for those invited)' : 'The room’s link'}
          </label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Link2 size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
              <input id="room-link" className="field truncate pl-9 font-mono text-[0.8125rem]" value={link} readOnly onFocus={(e) => e.currentTarget.select()} />
            </div>
            <button className="btn btn-primary flex-none" data-autofocus onClick={() => void copy()}>
              {copied ? <Check size={16} /> : <ClipboardCopy size={16} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void navigator.share({ title: info.title, text: `Study with me in Chip Study: ${info.title}`, url: link }).catch(() => undefined)}
              >
                <Share2 size={14} /> Share
              </button>
            )}
            <button
              className="btn btn-quiet btn-sm"
              disabled={busy === 'link'}
              onClick={() => void act('link', () => newRoomLink(info.id), 'New link made. The old one no longer lets anyone new in.')}
            >
              {busy === 'link' ? <Spinner size={14} /> : <RefreshCw size={14} />} New link
            </button>
            <span className="text-xs text-ink-3">A new link stops the old one letting anyone new in.</span>
          </div>
        </section>

        {!classRoom && (
          <section>
            <p className="label">How people join</p>
            <Segmented
              label="How people join"
              size="sm"
              value={info.admission === 'ask' ? 'ask' : 'link'}
              onChange={(v) => void act('admission', () => roomSettings(info.id, { admission: v }))}
              options={[
                { value: 'link', label: 'Anyone with the link' },
                { value: 'ask', label: 'I let each person in' },
              ]}
            />
            <ul className="mt-3 space-y-1 text-sm leading-relaxed text-ink-3">
              <li>
                {info.ends_at
                  ? `Up to ${info.max_people} people, until ${new Date(info.ends_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} (an hour on the free plan). Pro rooms take 10, with no time limit.`
                  : `Up to ${info.max_people} people, with no time limit.`}
              </li>
              <li>Personal rooms are for people 18 and over. Nothing is recorded.</li>
            </ul>
          </section>
        )}

        {classRoom && <ClassInvites info={info} busy={busy} act={act} />}

        {onGo && (
          <div className="flex justify-end border-t border-line pt-4">
            <button className="btn btn-iris" onClick={onGo}>
              Go to the room <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ClassInvites({ info, busy, act }: { info: RoomInfo; busy: string | null; act: (key: string, fn: () => Promise<RoomInfo>, done?: string) => Promise<void> }) {
  const me = useAuth((s) => s.session?.user.id ?? '');
  const mine = useInstitutions((s) => s.mine);
  const role = mine?.find((m) => m.id === info.institution_id)?.role ?? 'teacher';
  const [classes, setClasses] = useState<StudyClass[] | null>(null);
  const [students, setStudents] = useState<InstitutionMember[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void useInstitutions.getState().load();
    let live = true;
    const inst = info.institution_id!;
    listClasses(inst)
      .then((all) => live && setClasses(all.filter((c) => !c.archived && (role === 'admin' || c.teachers.some((t) => t.user_id === me)))))
      .catch(() => live && setClasses([]));
    institutionMembers(inst)
      .then((all) => live && setStudents(all.filter((m) => m.role === 'student')))
      .catch(() => live && setStudents([]));
    return () => {
      live = false;
    };
  }, [info.institution_id, role, me]);

  const invitedClass = new Set(info.invited_classes.map((c) => c.id));
  const invitedPerson = useMemo(() => new Set(info.invited_people.map((p) => p.user_id)), [info.invited_people]);
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !students) return [];
    return students.filter((s) => !invitedPerson.has(s.user_id) && s.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, students, invitedPerson]);

  return (
    <>
      <section>
        <p className="label flex items-center gap-1.5">
          <GraduationCap size={14} /> Classes
        </p>
        {classes === null ? (
          <div className="skeleton h-12" />
        ) : classes.length === 0 ? (
          <p className="text-sm text-ink-3">{role === 'admin' ? 'This institution has no classes yet.' : 'You don’t teach any classes here yet.'}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {classes.map((c) => {
              const on = invitedClass.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    className={`flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors ${on ? 'border-iris bg-iris-soft text-iris-2' : 'border-line bg-white text-ink-2 hover:border-line-2'}`}
                    aria-pressed={on}
                    disabled={busy === `c:${c.id}`}
                    onClick={() => void act(`c:${c.id}`, () => (on ? uninviteFromRoom(info.id, { classId: c.id }) : inviteToRoom(info.id, [c.id], [])), on ? undefined : `${c.name} is invited.`)}
                  >
                    {busy === `c:${c.id}` ? <Spinner size={13} /> : on ? <Check size={14} /> : null}
                    {c.name}
                    <span className="font-normal text-ink-3">· {c.students}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section>
        <p className="label flex items-center gap-1.5">
          <UserPlus size={14} /> Students
        </p>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
          <input className="field pl-9" placeholder="Find a student by name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a student" />
        </div>
        {found.length > 0 && (
          <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-white">
            {found.map((s) => (
              <li key={s.user_id} className="flex items-center gap-3 px-3.5 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                <button
                  className="btn btn-ghost btn-sm h-8"
                  disabled={busy === `p:${s.user_id}`}
                  onClick={() => {
                    setQuery('');
                    void act(`p:${s.user_id}`, () => inviteToRoom(info.id, [], [s.user_id]), `${s.name} is invited.`);
                  }}
                >
                  Invite
                </button>
              </li>
            ))}
          </ul>
        )}
        {info.invited_people.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Invited students">
            {info.invited_people.map((p) => (
              <li key={p.user_id} className="flex items-center gap-1 rounded-full bg-paper px-3 py-1 text-sm font-medium text-ink-2">
                {p.name}
                <button
                  className="-mr-1.5 grid h-6 w-6 place-items-center rounded-full text-ink-4 hover:bg-white hover:text-ink"
                  onClick={() => void act(`p:${p.user_id}`, () => uninviteFromRoom(info.id, { userId: p.user_id }))}
                  aria-label={`Don’t invite ${p.name}`}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          Invited students find the room on their desk, or join with the link. Your institution’s admins and the teachers of an invited class join as co-hosts.
        </p>
      </section>
    </>
  );
}
