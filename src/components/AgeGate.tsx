import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { site } from '../content/site.ts';
import type { AgeAnswer } from '../lib/types.ts';
import { useAge } from '../store/age.ts';
import { useAuth } from '../store/auth.ts';
import { Modal, Spinner } from './ui.tsx';

type Choice = AgeAnswer | 'under13';

const CHOICES: { value: Choice; title: string; body: string }[] = [
  { value: 'adult', title: 'I’m 18 or over', body: '' },
  {
    value: 'guardian',
    title: 'I’m under 18, and a parent or guardian agrees',
    body: 'You can use Chip Study. You can join a school, college or university here only if it has said students under 18 will join.',
  },
  { value: 'under13', title: 'I’m under 13', body: '' },
];

/** The age question, once after signing in (if it hasn't been answered) and before joining an
 * institution. Under 13 can't use Chip Study: it says so, kindly, and signs out. */
export function AgeGate() {
  const session = useAuth((s) => s.session);
  const answer = useAge((s) => s.answer);
  const asking = useAge((s) => s.asking);
  const later = useAge((s) => s.later);

  useEffect(() => {
    if (session) void useAge.getState().load();
  }, [session]);

  const open = !!session && (asking || (answer === null && !later));
  return <AgeSheet open={open} onClose={() => useAge.getState().close()} />;
}

export function AgeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setChoice(null);
      setError('');
    }
  }, [open]);

  const tooYoung = choice === 'under13';

  const go = async () => {
    if (!choice || choice === 'under13') return;
    setBusy(true);
    setError('');
    try {
      await useAge.getState().confirm(choice);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tooYoung ? 'Chip Study is for 13 and over' : 'One question first'}
      width={500}
      footer={
        tooYoung ? (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setChoice(null)}>
              Back
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={async () => {
                onClose();
                await useAuth.getState().signOut();
                navigate('/', { replace: true });
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <button className="btn btn-primary btn-sm" disabled={!choice || busy} onClick={() => void go()}>
            {busy ? <Spinner /> : 'Continue'}
          </button>
        )
      }
    >
      {tooYoung ? (
        <div className="space-y-3 text-[0.9375rem] leading-relaxed text-ink-2">
          <p>Sorry, you can’t use Chip Study until you’re 13. We’d love to see you then.</p>
          <p>
            If you made this account by mistake, a parent or guardian can write to <strong className="font-semibold text-ink">{site.email}</strong> and we’ll delete it.
          </p>
        </div>
      ) : (
        <>
          <p className="text-[0.9375rem] leading-relaxed text-ink-2">How old are you? Chip Study is for people 13 and over, and under 18 with a parent or guardian’s agreement.</p>
          <div role="radiogroup" aria-label="Your age" className="mt-4 space-y-2">
            {CHOICES.map((c) => (
              <button
                key={c.value}
                role="radio"
                aria-checked={choice === c.value}
                onClick={() => setChoice(c.value)}
                className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${choice === c.value ? 'border-iris bg-iris-soft/60' : 'border-line bg-white hover:bg-paper'}`}
              >
                <span className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full border-2 ${choice === c.value ? 'border-iris' : 'border-line-2'}`}>
                  {choice === c.value && <span className="h-2.5 w-2.5 rounded-full bg-iris" />}
                </span>
                <span>
                  <span className="block font-semibold text-ink">{c.title}</span>
                  {c.body && <span className="mt-0.5 block text-sm leading-snug text-ink-3">{c.body}</span>}
                </span>
              </button>
            ))}
          </div>
          {error && (
            <p className="mt-4 rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
