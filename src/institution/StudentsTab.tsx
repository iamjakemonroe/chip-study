import { BookMarked, ClipboardCheck, Compass, EyeOff, FileText, Lightbulb, ListChecks, MessageSquareQuote, MoreHorizontal, PenLine, Replace, Search, TextCursorInput, UserMinus, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChipLoader } from '../components/ChipLoader.tsx';
import { Confirm, Menu, MenuItem, Modal, Segmented } from '../components/ui.tsx';
import { institutionMembers, institutionStudent, setClassMember, setInstitutionMember } from '../lib/api.ts';
import { ago, minutesLabel } from '../lib/dates.ts';
import { aRole, dayText, ROLE_LABEL } from '../lib/institutions.ts';
import type { InstitutionMember, InstitutionRole, LogAction, StudentDetail } from '../lib/types.ts';
import { toast } from '../store/toast.ts';
import type { InstitutionView } from './InstitutionPage.tsx';

type Change = { member: InstitutionMember; role: InstitutionRole | null } | { member: InstitutionMember; leaveClass: { id: string; name: string } };

/** The students this viewer can see (for an admin, everyone: students, teachers and admins), with
 * the last 30 days in numbers. Search, a class to narrow it to, and a student's own page. Admins
 * change roles and take people out; a class's teacher can take a student out of the class. */
export function StudentsTab({ view }: { view: InstitutionView }) {
  const { ov, classes, reload } = view;
  const admin = ov.role === 'admin';
  const inst = ov.institution;
  const [classId, setClassId] = useState('');
  const [role, setRole] = useState<InstitutionRole>('student');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<InstitutionMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<InstitutionMember | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const live = (classes ?? []).filter((c) => !c.archived);
  const picked = live.find((c) => c.id === classId) ?? null;

  const load = async (cls = classId) => {
    setFailed(false);
    try {
      setRows(await institutionMembers(inst.id, cls || null));
    } catch {
      setFailed(true);
      setRows((r) => r ?? []);
    }
  };

  useEffect(() => {
    setRows(null);
    void load(classId);
  }, [classId]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => (admin ? r.role === role : r.role === 'student') && (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)));
  }, [rows, query, role, admin]);
  const counts = useMemo(() => {
    const c = { admin: 0, teacher: 0, student: 0 };
    for (const r of rows ?? []) c[r.role] += 1;
    return c;
  }, [rows]);

  const actions = (m: InstitutionMember) => {
    const items: ReactNode[] = [];
    if (admin) {
      for (const r of ['student', 'teacher', 'admin'] as const) {
        if (r === m.role) continue;
        items.push(
          <MenuItem key={r} icon={<Users size={15} />} onClick={() => setChange({ member: m, role: r })}>
            Make {aRole(r)}
          </MenuItem>,
        );
      }
    }
    if (picked && (admin || m.role === 'student')) {
      items.push(
        <MenuItem key="class" icon={<UserMinus size={15} />} onClick={() => setChange({ member: m, leaveClass: { id: picked.id, name: picked.name } })}>
          Take out of {picked.name}
        </MenuItem>,
      );
    }
    if (admin) {
      items.push(
        <MenuItem key="remove" icon={<UserMinus size={15} />} danger onClick={() => setChange({ member: m, role: null })}>
          Remove from {inst.name}
        </MenuItem>,
      );
    }
    return items;
  };

  const menu = (m: InstitutionMember) => {
    const items = actions(m);
    if (!items.length) return null;
    return (
      <Menu label={`More for ${m.name}`} button={<MoreHorizontal size={18} />}>
        {(close) => <div onClick={close}>{items}</div>}
      </Menu>
    );
  };

  const who = admin ? { student: 'students', teacher: 'teachers', admin: 'admins' }[role] : 'students';

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4" />
          <input className="field pl-10" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email" aria-label="Search by name or email" />
        </div>
        <select className="field w-auto max-w-full flex-none sm:max-w-[16rem]" value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
          <option value="">{admin ? 'Every class' : 'All my classes'}</option>
          {live.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {admin && (
        <div className="mt-3">
          <Segmented
            label="Who"
            size="sm"
            value={role}
            onChange={setRole}
            options={[
              { value: 'student', label: `Students${rows ? ` · ${counts.student}` : ''}` },
              { value: 'teacher', label: `Teachers${rows ? ` · ${counts.teacher}` : ''}` },
              { value: 'admin', label: `Admins${rows ? ` · ${counts.admin}` : ''}` },
            ]}
          />
        </div>
      )}

      {failed && (
        <p className="mt-4 rounded-2xl bg-peach-soft px-4 py-3 text-sm text-[#9a4a1b]">
          Couldn’t load everyone.{' '}
          <button className="font-semibold underline" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}

      {rows === null ? (
        <div className="mt-6 h-48">
          <ChipLoader page={false} label="Finding your students" />
        </div>
      ) : shown.length === 0 ? (
        <div className="mt-5 rounded-[1.5rem] border border-dashed border-line-2 bg-white/50 px-6 py-12 text-center">
          <p className="font-semibold">{query ? `No ${who} match “${query.trim()}”` : picked ? `No ${who} in ${picked.name} yet` : `No ${who} yet`}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-3">
            {query ? 'Try part of their name or email.' : role === 'student' ? 'Students show up here once they join with a class code, an invite link or their school email.' : 'Invite them from the Invite tab.'}
          </p>
          {!query && (
            <button className="btn btn-ghost btn-sm mt-4" onClick={() => view.go('invite', classId || undefined)}>
              Invite people
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="mt-5 text-sm text-ink-3">
            {shown.length.toLocaleString()} {shown.length === 1 ? who.replace(/s$/, '') : who}
            {role === 'student' || !admin ? ' · numbers are for the last 30 days' : ''}
          </p>
          {/* Wider screens: a table. */}
          <div className="card mt-3 hidden overflow-hidden md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-paper/60 text-xs font-semibold text-ink-3">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Name
                  </th>
                  <th scope="col" className="w-px whitespace-nowrap px-3 py-3">
                    Last active
                  </th>
                  <th scope="col" className="w-px whitespace-nowrap px-3 py-3 text-right">
                    Study time
                  </th>
                  <th scope="col" className="w-px whitespace-nowrap px-3 py-3 text-right">
                    Practice
                  </th>
                  <th scope="col" className="w-px whitespace-nowrap hidden px-3 py-3 text-right lg:table-cell">
                    Chip questions
                  </th>
                  <th scope="col" className="w-px whitespace-nowrap px-3 py-3 text-right">
                    AI-use records
                  </th>
                  <th scope="col" className="w-12 px-2 py-3">
                    <span className="sr-only">More</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((m) => (
                  <tr key={m.user_id} className="transition-colors hover:bg-paper/60">
                    <td className="max-w-0 px-4 py-3">
                      <Person m={m} onOpen={m.role === 'student' ? () => setOpen(m) : undefined} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-2">{m.last_active ? ago(m.last_active) : 'Not yet'}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{minutesLabel(m.minutes_30d)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{m.practice_score_30d === null ? '–' : `${m.practice_score_30d}%`}</td>
                    <td className="hidden whitespace-nowrap px-3 py-3 text-right tabular-nums lg:table-cell">{m.asks_30d.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{m.ai_records.toLocaleString()}</td>
                    <td className="px-2 py-2">{menu(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Phones: a card each. */}
          <ul className="mt-3 space-y-3 md:hidden">
            {shown.map((m) => (
              <li key={m.user_id} className="card p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Person m={m} onOpen={m.role === 'student' ? () => setOpen(m) : undefined} />
                  </div>
                  <div className="-mr-1 -mt-1">{menu(m)}</div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <Stat label="Last active" value={m.last_active ? ago(m.last_active) : 'Not yet'} />
                  <Stat label="Study time" value={minutesLabel(m.minutes_30d)} />
                  <Stat label="Practice" value={m.practice_score_30d === null ? '–' : `${m.practice_score_30d}%`} />
                  <Stat label="AI-use records" value={m.ai_records.toLocaleString()} />
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}

      <StudentPanel institutionId={inst.id} institutionName={inst.name} member={open} onClose={() => setOpen(null)} />
      <Confirm
        open={!!change}
        title={change ? changeTitle(change, inst.name) : ''}
        body={change ? changeBody(change, inst.name) : ''}
        yes={change && 'role' in change && change.role === null ? 'Remove' : change && 'leaveClass' in change ? 'Take out' : 'Change'}
        danger={!!change && 'role' in change && change.role === null}
        onClose={() => setChange(null)}
        onYes={async () => {
          if (!change) return;
          try {
            if ('leaveClass' in change) {
              await setClassMember(change.leaveClass.id, change.member.user_id, null);
              toast(`${change.member.name} is out of ${change.leaveClass.name}.`, 'info');
            } else {
              await setInstitutionMember(inst.id, change.member.user_id, change.role);
              toast(change.role === null ? `${change.member.name} has left ${inst.name}.` : `${change.member.name} is ${aRole(change.role)} now.`, 'good');
            }
            await Promise.all([load(), reload(), view.reloadClasses()]);
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      />
    </div>
  );
}

function changeTitle(c: Change, inst: string): string {
  if ('leaveClass' in c) return `Take ${c.member.name} out of ${c.leaveClass.name}?`;
  if (c.role === null) return `Remove ${c.member.name} from ${inst}?`;
  return `Make ${c.member.name} ${aRole(c.role)}?`;
}

function changeBody(c: Change, inst: string): string {
  if ('leaveClass' in c) return 'They stay part of the institution, and can join the class again with its code.';
  if (c.role === null)
    return c.member.role === 'student'
      ? `They leave every class here and lose the Chip Study Pro that comes from ${inst}, which frees their seat. Their own work stays theirs.`
      : `They leave every class here and can’t open ${inst}’s dashboard any more.`;
  if (c.role === 'admin') return `Admins run everything at ${inst}: every student, class, invite and setting.`;
  if (c.role === 'teacher') return `Teachers run their own classes and see only the students in them.${c.member.role === 'student' ? ' They stop being a student here, which frees their seat.' : ''}`;
  return 'They take a seat and get Chip Study Pro, and stop seeing students’ activity.';
}

function Person({ m, onOpen }: { m: InstitutionMember; onOpen?: () => void }) {
  const name = (
    <>
      <span className="block truncate font-semibold text-ink">{m.name}</span>
      <span className="block truncate text-xs text-ink-3">{m.email}</span>
    </>
  );
  return (
    <div className="min-w-0">
      {onOpen ? (
        <button className="block w-full min-w-0 text-left hover:text-iris" onClick={onOpen} aria-label={`Open ${m.name}`}>
          {name}
        </button>
      ) : (
        name
      )}
      {m.classes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {m.classes.slice(0, 3).map((c) => (
            <span key={c} className="chip-tag max-w-full bg-paper-2 text-ink-3">
              <span className="truncate">{c}</span>
            </span>
          ))}
          {m.classes.length > 3 && <span className="chip-tag bg-paper-2 text-ink-3">+{m.classes.length - 3}</span>}
        </div>
      )}
      {m.role !== 'student' && <span className="mt-1.5 inline-block text-xs font-semibold text-iris-2">{ROLE_LABEL[m.role]}</span>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

const ICONS: Record<LogAction, ReactNode> = {
  guide: <Compass size={13} />,
  explain: <Lightbulb size={13} />,
  plan: <ListChecks size={13} />,
  write: <PenLine size={13} />,
  check: <ClipboardCheck size={13} />,
  cite: <BookMarked size={13} />,
  quiz: <MessageSquareQuote size={13} />,
  setup: <FileText size={13} />,
  inserted: <TextCursorInput size={13} />,
  replaced: <Replace size={13} />,
  added_tasks: <ListChecks size={13} />,
  added_sources: <BookMarked size={13} />,
};

/** One student, for their admin or teacher: each assignment with its study time, practice and
 * AI-use record. Their chats, notes and documents aren't here, and can't be. */
function StudentPanel({ institutionId, institutionName, member, onClose }: { institutionId: string; institutionName: string; member: InstitutionMember | null; onClose: () => void }) {
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [error, setError] = useState('');
  const [all, setAll] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!member) return;
    setDetail(null);
    setError('');
    setAll(new Set());
    let on = true;
    institutionStudent(institutionId, member.user_id)
      .then((d) => on && setDetail(d))
      .catch((e) => on && setError((e as Error).message));
    return () => {
      on = false;
    };
  }, [institutionId, member]);

  const first = member?.name.split(/\s+/)[0] ?? 'them';

  return (
    <Modal open={!!member} onClose={onClose} title={member?.name} width={760}>
      {member && (
        <>
          <p className="break-all text-sm text-ink-3">
            {member.email} · joined {dayText(member.joined_at)}
          </p>
          <div className="mt-4 flex gap-3 rounded-2xl bg-paper px-4 py-3 text-sm leading-relaxed text-ink-2">
            <EyeOff size={17} className="mt-0.5 flex-none text-ink-3" />
            <p>
              You see {first}’s activity and each assignment’s AI-use record. Their chats with Chip, notes and documents are private: nobody at {institutionName} can see them.
            </p>
          </div>
          {error ? (
            <p className="mt-5 rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
              {error}
            </p>
          ) : !detail ? (
            <div className="h-40">
              <ChipLoader page={false} label="Opening" />
            </div>
          ) : detail.assignments.length === 0 ? (
            <p className="mt-6 text-center text-sm text-ink-3">No assignments or topics yet.</p>
          ) : (
            <ul className="mt-5 space-y-3">
              {detail.assignments.map((a) => {
                const many = a.ai_use.length > 5 && !all.has(a.id);
                const record = many ? a.ai_use.slice(-5) : a.ai_use;
                return (
                  <li key={a.id} className="rounded-2xl border border-line p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold leading-snug">{a.title}</h3>
                        <p className="text-xs text-ink-3">
                          {[a.course, a.kind === 'topic' ? 'Learning' : 'Assignment', a.due_at ? `due ${dayText(a.due_at)}` : '', `${a.words.toLocaleString()} words`].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {a.status !== 'active' && <span className="chip-tag bg-mint-soft text-mint">{a.status === 'submitted' ? 'Handed in' : 'Archived'}</span>}
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                      <div className="rounded-xl bg-paper px-3 py-2">
                        <dt className="text-xs text-ink-3">Focus</dt>
                        <dd className="font-semibold">{minutesLabel(Number(a.focus_minutes))}</dd>
                      </div>
                      <div className="rounded-xl bg-paper px-3 py-2">
                        <dt className="text-xs text-ink-3">Practice</dt>
                        <dd className="font-semibold">{a.practice?.score == null ? '–' : `${a.practice.score}%`}</dd>
                      </div>
                      <div className="rounded-xl bg-paper px-3 py-2">
                        <dt className="text-xs text-ink-3">Sessions</dt>
                        <dd className="font-semibold">{(a.practice?.sessions ?? 0).toLocaleString()}</dd>
                      </div>
                    </dl>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">AI-use record</p>
                    {a.ai_use.length === 0 ? (
                      <p className="mt-1.5 text-sm text-ink-3">No help from Chip on this yet.</p>
                    ) : (
                      <>
                        {many && (
                          <button className="mt-1.5 text-sm font-semibold text-iris hover:text-iris-2" onClick={() => setAll((s) => new Set(s).add(a.id))}>
                            Show all {a.ai_use.length}
                          </button>
                        )}
                        <ol className="mt-2 space-y-2">
                          {record.map((e, n) => (
                            <li key={`${e.at}-${n}`} className="flex gap-2.5 text-sm">
                              <span className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full ${['inserted', 'replaced'].includes(e.action) ? 'bg-iris text-white' : 'bg-iris-soft text-iris-2'}`}>
                                {ICONS[e.action] ?? <FileText size={13} />}
                              </span>
                              <span className="min-w-0">
                                <span className="block leading-snug text-ink">{e.summary}</span>
                                <span className="block text-xs text-ink-4">
                                  {new Date(e.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                                  {e.words > 0 && ` · ${e.words} words`}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}
