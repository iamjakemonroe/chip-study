import { GraduationCap, Lock, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Modal, Spinner } from '../components/ui.tsx';
import { useAge } from '../store/age.ts';
import { useAuth } from '../store/auth.ts';
import { useInstitutions } from '../store/institutions.ts';
import { openRoom, type RoomInfo } from './api.ts';
import { ShareSheet } from './ShareSheet.tsx';

/** "Study together" on an assignment: opens a live room on it (or the one already open), with
 * friends or, for someone who teaches or runs an institution, for a class. Then the link to share,
 * and into the room. */
export function StudyTogether({ assignmentId, kind }: { assignmentId: string; kind: 'topic' | 'assignment' }) {
  const navigate = useNavigate();
  const tier = useAuth((s) => s.me?.tier);
  const age = useAge((s) => s.answer);
  const mine = useInstitutions((s) => s.mine);
  const teaching = (mine ?? []).filter((m) => m.active && (m.role === 'admin' || m.role === 'teacher'));
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>('personal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [room, setRoom] = useState<RoomInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    void useInstitutions.getState().load();
    void useAge.getState().load();
  }, [open]);

  const adult = age === 'adult';
  const minor = age === 'guardian';
  useEffect(() => {
    if (open && minor && teaching.length && choice === 'personal') setChoice(teaching[0].id);
  }, [open, minor, teaching.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async () => {
    setError('');
    const personal = choice === 'personal';
    if (personal) {
      // Personal rooms are for adults: the age question first, if it hasn't been answered.
      if (!(await useAge.getState().ensure(() => setOpen(true)))) {
        // The age question shows on its own; this comes back once it's answered.
        setOpen(false);
        return;
      }
      if (useAge.getState().answer !== 'adult') return setError('Personal study rooms are for people 18 and over. You can join rooms your school opens for your class.');
    }
    setBusy(true);
    try {
      const r = await openRoom(assignmentId, personal ? null : choice);
      setRoom(r);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const what = kind === 'topic' ? 'this topic' : 'this assignment';

  return (
    <>
      <button className="btn btn-ghost btn-sm flex-none px-2.5 sm:px-3.5" onClick={() => setOpen(true)} title="Study together, live">
        <Users size={15} /> <span className="hidden md:inline">Study together</span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Study together"
        width={520}
        footer={
          <button className="btn btn-iris btn-sm" disabled={busy || (choice === 'personal' && minor)} onClick={() => void go()}>
            {busy ? <Spinner /> : 'Open the room'}
          </button>
        }
      >
        <p className="text-[0.9375rem] leading-relaxed text-ink-2">
          Open a live room on {what}. Everyone edits the same work with you, with video, chat and one shared Chip. Nothing is recorded, and the work saves to {what} as you go.
        </p>
        <div role="radiogroup" aria-label="Who the room is for" className="mt-4 space-y-2">
          <Choice
            on={choice === 'personal'}
            onPick={() => setChoice('personal')}
            disabled={minor}
            icon={minor ? <Lock size={17} /> : <Users size={17} />}
            title="With friends"
            body={
              minor
                ? 'Personal rooms are for people 18 and over.'
                : tier === 'pro'
                  ? 'Anyone with the link, up to 10 people, with no time limit. For people 18 and over.'
                  : 'Anyone with the link, up to 4 people, for 60 minutes (Pro: 10, no time limit). For people 18 and over.'
            }
          />
          {teaching.map((t) => (
            <Choice
              key={t.id}
              on={choice === t.id}
              onPick={() => setChoice(t.id)}
              icon={<GraduationCap size={17} />}
              title={`For a class at ${t.name}`}
              body="Only the classes and students you invite, up to 50, with no time limit. You choose who edits."
            />
          ))}
        </div>
        {!adult && !minor && choice === 'personal' && <p className="mt-3 text-xs text-ink-3">We’ll ask your age first: personal rooms are for adults.</p>}
        {error && (
          <p className="mt-4 rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
            {error}
          </p>
        )}
      </Modal>
      {room && <ShareSheet open={!!room} onClose={() => setRoom(null)} info={room} onChange={setRoom} onGo={() => navigate(`/room/${room.token}`)} />}
    </>
  );
}

function Choice({ on, onPick, icon, title, body, disabled }: { on: boolean; onPick: () => void; icon: ReactNode; title: string; body: string; disabled?: boolean }) {
  return (
    <button
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onPick}
      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors disabled:opacity-60 ${on ? 'border-iris bg-iris-soft/60' : 'border-line bg-white hover:bg-paper'}`}
    >
      <span className={`mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full ${on ? 'bg-iris text-white' : 'bg-paper-2 text-ink-3'}`}>{icon}</span>
      <span>
        <span className="block font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-sm leading-snug text-ink-3">{body}</span>
      </span>
    </button>
  );
}
