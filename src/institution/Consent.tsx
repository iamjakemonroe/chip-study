import { Check, Eye, EyeOff, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Spinner } from '../components/ui.tsx';
import { CAN_SEE, CANT_SEE } from '../content/institutions.ts';
import { aRole } from '../lib/institutions.ts';
import type { InstitutionRole } from '../lib/types.ts';

/** What an institution's staff can and can't see, side by side (or one above the other). */
export function SeeLists({
  who = 'you',
  seeTitle = 'They can see',
  cantTitle = 'They can’t see',
  stack = false,
}: {
  who?: 'you' | 'students';
  seeTitle?: string;
  cantTitle?: string;
  stack?: boolean;
}) {
  return (
    <div className={`grid gap-3 ${stack ? '' : 'sm:grid-cols-2'}`}>
      <div className="rounded-2xl bg-paper p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Eye size={15} className="text-iris" /> {seeTitle}
        </p>
        <ul className="mt-2.5 space-y-2 text-sm leading-snug text-ink-2">
          {CAN_SEE[who].map((t) => (
            <li key={t} className="flex gap-2">
              <Check size={15} className="mt-px flex-none text-mint" strokeWidth={2.4} />
              {t}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl bg-paper p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <EyeOff size={15} className="text-rose" /> {cantTitle}
        </p>
        <ul className="mt-2.5 space-y-2 text-sm leading-snug text-ink-2">
          {CANT_SEE[who].map((t) => (
            <li key={t} className="flex gap-2">
              <X size={15} className="mt-px flex-none text-rose" strokeWidth={2.4} />
              {t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** What joining means, told plainly before anyone joins: for a student, what the institution's
 * staff will see and that Pro comes with it; for a teacher or admin, what they'll see and won't.
 * [name] is the institution's, when it's known (a class code doesn't say whose it is). */
export function ConsentBody({ name, role = 'student', className, stack = false }: { name?: string | null; role?: InstitutionRole; className?: string | null; stack?: boolean }) {
  const who = name ? <strong className="font-semibold text-ink">{name}</strong> : 'the school, college or university that runs it';
  if (role !== 'student') {
    return (
      <div className="space-y-4 text-[0.9375rem] leading-relaxed text-ink-2">
        <p>
          You’re invited to {name ? who : 'an institution'} as {aRole(role)}
          {className ? (
            <>
              , for <strong className="font-semibold text-ink">{className}</strong>
            </>
          ) : null}
          . You’ll see {role === 'admin' ? 'every student there' : 'the students in your classes'}: how they’re getting on, and each assignment’s AI-use record.
        </p>
        <SeeLists who="students" seeTitle="You’ll see" cantTitle="You won’t see" stack={stack} />
        <p className="text-sm text-ink-3">Students are told this before they join. Your own studying stays private: nobody there sees it.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4 text-[0.9375rem] leading-relaxed text-ink-2">
      <p>
        {name ? who : 'The school, college or university that runs this class'} gives you Chip Study Pro while you’re part of it
        {className ? (
          <>
            , and you’ll be in <strong className="font-semibold text-ink">{className}</strong>
          </>
        ) : null}
        . Before you join, here’s what {name ? 'its' : 'their'} admins and your teachers will be able to see.
      </p>
      <SeeLists who="you" stack={stack} />
      <p className="text-sm text-ink-3">
        Joining is your choice. You can leave at any time in Settings, and leaving stops the Pro that comes from {name ? who : 'them'}.
      </p>
    </div>
  );
}

/** Asks before joining, with what joining means. Errors stay in the dialog to try again. */
export function ConsentModal({
  open,
  onClose,
  title,
  name,
  role = 'student',
  className,
  yes,
  onYes,
  back,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  name?: string | null;
  role?: InstitutionRole;
  className?: string | null;
  yes: string;
  onYes: () => Promise<void>;
  /** A way back instead of "Not now" (an earlier step). */
  back?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) setError('');
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={560}
      footer={
        <>
          {back ?? (
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              Not now
            </button>
          )}
          <button
            className="btn btn-iris btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await onYes();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : yes}
          </button>
        </>
      }
    >
      <ConsentBody name={name} role={role} className={className} stack />
      {error && (
        <p className="mt-4 rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
