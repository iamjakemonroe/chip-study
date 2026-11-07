import { Archive, ChevronDown, Copy, MailPlus, MoreHorizontal, PenLine, Plus, Undo2, UserCog } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChipLoader } from '../components/ChipLoader.tsx';
import { Menu, MenuItem, Modal, Spinner } from '../components/ui.tsx';
import { site } from '../content/site.ts';
import { createClass, institutionMembers, setClassMember, updateClass } from '../lib/api.ts';
import type { InstitutionMember, StudyClass } from '../lib/types.ts';
import { toast } from '../store/toast.ts';
import { copyText } from './copy.ts';
import type { InstitutionView } from './InstitutionPage.tsx';

/** What a student does with a class code, to paste into a message to a class. */
export function joinInstructions(c: Pick<StudyClass, 'name' | 'code'>): string {
  return `Join ${c.name} on Chip Study: go to ${site.host}, sign in, and choose Join a class (on your desk, or in Settings). The class code is ${c.code}.`;
}

/** Classes, each with its join code: making them, renaming, archiving, and (for admins) who
 * teaches each one. Teachers see the classes they teach. */
export function ClassesTab({ view }: { view: InstitutionView }) {
  const { ov, classes, reloadClasses, go } = view;
  const admin = ov.role === 'admin';
  const inst = ov.institution;
  const closed = inst.status === 'rejected' || inst.status === 'suspended';
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ id: string; name: string; code: string } | null>(null);
  const [renaming, setRenaming] = useState<StudyClass | null>(null);
  const [teachersOf, setTeachersOf] = useState<StudyClass | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const live = (classes ?? []).filter((c) => !c.archived);
  const archived = (classes ?? []).filter((c) => c.archived);

  const make = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const c = await createClass(inst.id, name.trim());
      setName('');
      setMade(c);
      await Promise.all([reloadClasses(), view.reload()]);
    } catch (err) {
      toast((err as Error).message, 'warn');
    } finally {
      setBusy(false);
    }
  };

  const archive = async (c: StudyClass, archived: boolean) => {
    try {
      await updateClass(c.id, { archived });
      toast(archived ? `${c.name} is archived. Its code stops working.` : `${c.name} is back, and its code works again.`, 'info');
      await Promise.all([reloadClasses(), view.reload()]);
    } catch (e) {
      toast((e as Error).message, 'warn');
    }
  };

  return (
    <div>
      {closed ? (
        <p className="rounded-2xl bg-peach-soft px-4 py-3 text-sm text-[#9a4a1b]">{inst.name} isn’t open right now, so new classes can’t be made.</p>
      ) : (
        <form className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:p-5" onSubmit={make}>
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="class-name">
              New class
            </label>
            <input id="class-name" className="field" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Biology 101, Year 10 History" />
          </div>
          <button className="btn btn-primary flex-none" disabled={busy || !name.trim()}>
            {busy ? (
              <Spinner />
            ) : (
              <>
                <Plus size={16} /> Make class
              </>
            )}
          </button>
        </form>
      )}

      {classes === null ? (
        <div className="mt-6 h-48">
          <ChipLoader page={false} label="Finding your classes" />
        </div>
      ) : live.length === 0 ? (
        <div className="mt-5 rounded-[1.5rem] border border-dashed border-line-2 bg-white/50 px-6 py-12 text-center">
          <p className="font-semibold">No classes yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-3">
            Each class gets a code. Students type it in Chip Study to join{admin ? '' : ', and you’ll see how they’re getting on'}.
          </p>
        </div>
      ) : (
        <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {live.map((c) => (
            <li key={c.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="break-words font-semibold leading-snug">{c.name}</h3>
                  <p className="mt-0.5 text-sm text-ink-3">
                    {c.students.toLocaleString()} student{c.students === 1 ? '' : 's'}
                    {c.teachers.length > 0 && <> · {c.teachers.map((t) => t.name).join(', ')}</>}
                  </p>
                </div>
                <Menu label={`More for ${c.name}`} button={<MoreHorizontal size={18} />}>
                  {(close) => (
                    <>
                      <MenuItem icon={<Copy size={15} />} onClick={() => (close(), void copyText(joinInstructions(c), 'Copied, ready to send to your class.'))}>
                        Copy how to join
                      </MenuItem>
                      <MenuItem icon={<MailPlus size={15} />} onClick={() => (close(), go('invite', c.id))}>
                        Invite by email
                      </MenuItem>
                      {admin && (
                        <MenuItem icon={<UserCog size={15} />} onClick={() => (close(), setTeachersOf(c))}>
                          Teachers
                        </MenuItem>
                      )}
                      <MenuItem icon={<PenLine size={15} />} onClick={() => (close(), setRenaming(c))}>
                        Rename
                      </MenuItem>
                      <MenuItem icon={<Archive size={15} />} onClick={() => (close(), void archive(c, true))}>
                        Archive
                      </MenuItem>
                    </>
                  )}
                </Menu>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-paper px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-ink-3">Join code</p>
                  <p className="font-mono text-2xl font-semibold tracking-[0.18em] text-ink">{c.code}</p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => void copyText(c.code, `Copied ${c.code}.`)} aria-label={`Copy the code for ${c.name}`}>
                  <Copy size={15} /> Copy
                </button>
              </div>
              {admin && c.teachers.length === 0 && (
                <button className="mt-3 self-start text-sm font-semibold text-iris hover:text-iris-2" onClick={() => setTeachersOf(c)}>
                  Add a teacher
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <section className="mt-8">
          <button className="flex items-center gap-1.5 text-sm font-semibold text-ink-3 hover:text-ink" onClick={() => setShowArchived((s) => !s)} aria-expanded={showArchived}>
            <ChevronDown size={16} className={`transition-transform ${showArchived ? '' : '-rotate-90'}`} /> Archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="mt-3 space-y-2">
              {archived.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white/60 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block text-xs text-ink-3">
                      {c.students.toLocaleString()} student{c.students === 1 ? '' : 's'} · code {c.code} doesn’t work while it’s archived
                    </span>
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => void archive(c, false)}>
                    <Undo2 size={15} /> Bring back
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Modal open={!!made} onClose={() => setMade(null)} title="Your class is ready" width={480}>
        {made && (
          <div className="text-center">
            <p className="text-ink-2">
              Students join <strong className="font-semibold text-ink">{made.name}</strong> with this code:
            </p>
            <p className="mt-4 rounded-2xl bg-iris-soft py-5 pl-[0.25em] font-mono text-4xl font-semibold tracking-[0.25em] text-ink sm:text-5xl" aria-label={`Class code ${made.code.split('').join(' ')}`}>
              {made.code}
            </p>
            <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-ink-3">In Chip Study they choose Join a class, on their desk or in Settings, and type it in. They see what you’ll see before they join.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <button className="btn btn-primary btn-sm" onClick={() => void copyText(made.code, `Copied ${made.code}.`)}>
                <Copy size={15} /> Copy code
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => void copyText(joinInstructions(made), 'Copied, ready to send to your class.')}>
                Copy how to join
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => (setMade(null), go('invite', made.id))}>
                <MailPlus size={15} /> Invite by email
              </button>
            </div>
          </div>
        )}
      </Modal>
      <RenameClass target={renaming} onClose={() => setRenaming(null)} onDone={reloadClasses} />
      <ClassTeachers institutionId={inst.id} target={teachersOf} onClose={() => setTeachersOf(null)} onDone={reloadClasses} />
    </div>
  );
}

function RenameClass({ target, onClose, onDone }: { target: StudyClass | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (target) setName(target.name);
  }, [target]);
  const save = async () => {
    if (!target || !name.trim()) return;
    setBusy(true);
    try {
      await updateClass(target.id, { name: name.trim() });
      await onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title="Rename the class"
      width={440}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy || !name.trim()} onClick={() => void save()}>
            {busy ? <Spinner /> : 'Save'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="label" htmlFor="rename-class">
          Name
        </label>
        <input id="rename-class" className="field" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-autofocus />
        <p className="mt-2 text-xs text-ink-3">The code stays the same.</p>
      </form>
    </Modal>
  );
}

/** Who teaches a class: any of the institution's teachers and admins, ticked on or off. */
function ClassTeachers({ institutionId, target, onClose, onDone }: { institutionId: string; target: StudyClass | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [staff, setStaff] = useState<InstitutionMember[] | null>(null);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setStaff(null);
    setOn(new Set(target.teachers.map((t) => t.user_id)));
    institutionMembers(institutionId)
      .then((rows) => setStaff(rows.filter((r) => r.role !== 'student')))
      .catch((e) => {
        toast((e as Error).message, 'warn');
        setStaff([]);
      });
  }, [institutionId, target]);

  const flip = async (m: InstitutionMember) => {
    if (!target) return;
    const was = on.has(m.user_id);
    setBusy(m.user_id);
    try {
      await setClassMember(target.id, m.user_id, was ? null : 'teacher');
      setOn((s) => {
        const next = new Set(s);
        if (was) next.delete(m.user_id);
        else next.add(m.user_id);
        return next;
      });
      await onDone();
    } catch (e) {
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={target ? `Who teaches ${target.name}` : ''}
      width={480}
      footer={
        <button className="btn btn-primary btn-sm" onClick={onClose}>
          Done
        </button>
      }
    >
      <p className="text-sm leading-relaxed text-ink-3">Teachers of a class see its students. To add someone who isn’t here yet, invite them as a teacher first.</p>
      {staff === null ? (
        <div className="h-28">
          <ChipLoader page={false} label="" size={40} />
        </div>
      ) : staff.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">No teachers or admins yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
          {staff.map((m) => (
            <li key={m.user_id}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
                <input type="checkbox" className="h-4 w-4 flex-none accent-[var(--color-iris)]" checked={on.has(m.user_id)} disabled={busy === m.user_id} onChange={() => void flip(m)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {m.email} · {m.role === 'admin' ? 'Admin' : 'Teacher'}
                  </span>
                </span>
                {busy === m.user_id && <Spinner size={14} />}
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
